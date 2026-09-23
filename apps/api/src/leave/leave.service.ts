import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LeaveRequestStatus, PermissionScope, type Prisma } from '@prisma/client';

import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateLeaveRequestDto,
  QueryBalancesDto,
  QueryLeaveRequestsDto,
  SetBalanceDto,
} from './dto/leave.dto';
import { LeavePolicyService, type EntitlementBreakdownRow } from './leave-policy.service';
import { countWorkingDays, formatDate, leaveYearOf, toDateOnly } from './working-days';

/** Statuses that consume entitlement and block overlapping dates. */
const ACTIVE_STATUSES: LeaveRequestStatus[] = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
];

const REQUEST_INCLUDE = {
  employee: {
    select: { id: true, firstName: true, lastName: true, employeeNumber: true, workEmail: true },
  },
  leaveType: { select: { id: true, code: true, name: true, requiresBalance: true } },
  approver: { select: { id: true, firstName: true, lastName: true } },
  decidedBy: { select: { id: true, firstName: true, lastName: true } },
  appliedPolicy: {
    select: { id: true, quotaDays: true, effectiveFrom: true, effectiveTo: true },
  },
} satisfies Prisma.LeaveRequestInclude;

export interface BalanceSummary {
  leaveTypeId: string;
  code: string;
  name: string;
  requiresBalance: boolean;
  year: number;
  /** Straight from the effective-dated policy, unless overridden. */
  entitledDays: number;
  /** True when HR set an explicit figure instead of the policy calculation. */
  isOverridden: boolean;
  carriedForwardDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  /** How the entitlement was arrived at, period by period. */
  entitlementBreakdown: EntitlementBreakdownRow[];
}

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly policies: LeavePolicyService,
  ) {}

  private num(value: Prisma.Decimal | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    return typeof value === 'number' ? value : value.toNumber();
  }

  private async assertEmployeeVisible(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    employeeId: string,
  ): Promise<void> {
    const allowed = await this.permissions.canAccessEmployee(callerEmployeeId, scope, employeeId);
    // 404 rather than 403, matching the employees module: otherwise a manager
    // could discover who exists by probing ids.
    if (!allowed) throw new NotFoundException('Employee not found.');
  }

  // ---------------------------------------------------------------------------
  // Balances
  //
  // ENTITLEMENT COMES FROM POLICY, NOT FROM A STORED NUMBER.
  //
  // That is what makes a past year immune to a present-day policy change: 2026
  // resolves against the policies effective in 2026, so editing the current
  // policy cannot retroactively alter it.
  //
  // Used, pending, and remaining are likewise DERIVED by summing requests, so
  // cancelling a request frees its days with nothing to un-deduct.
  // ---------------------------------------------------------------------------

  async getBalances(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    query: QueryBalancesDto,
  ): Promise<{ employeeId: string; year: number; balances: BalanceSummary[] }> {
    const employeeId = query.employeeId ?? callerEmployeeId;
    if (!employeeId) throw new BadRequestException('No employee to show balances for.');
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    const year = query.year ?? new Date().getUTCFullYear();

    const [types, overrides, requests] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.leaveBalance.findMany({ where: { employeeId, year } }),
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId,
          status: { in: ACTIVE_STATUSES },
          startDate: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lte: new Date(Date.UTC(year, 11, 31)),
          },
        },
        select: { leaveTypeId: true, days: true, status: true },
      }),
    ]);

    const overrideByType = new Map(overrides.map((b) => [b.leaveTypeId, b]));

    const balances = await Promise.all(
      types.map(async (type) => {
        const forType = requests.filter((r) => r.leaveTypeId === type.id);
        const usedDays = forType
          .filter((r) => r.status === LeaveRequestStatus.APPROVED)
          .reduce((sum, r) => sum + this.num(r.days), 0);
        const pendingDays = forType
          .filter((r) => r.status === LeaveRequestStatus.PENDING)
          .reduce((sum, r) => sum + this.num(r.days), 0);

        const calculated = await this.policies.calculateEntitlement(type.id, year);
        const override = overrideByType.get(type.id);
        const isOverridden =
          override?.entitlementOverrideDays !== null &&
          override?.entitlementOverrideDays !== undefined;

        const entitledDays = isOverridden
          ? this.num(override.entitlementOverrideDays)
          : calculated.entitledDays;

        const carriedForwardDays = this.num(override?.carriedForwardDays);

        return {
          leaveTypeId: type.id,
          code: type.code,
          name: type.name,
          requiresBalance: type.requiresBalance,
          year,
          entitledDays,
          isOverridden,
          carriedForwardDays,
          usedDays,
          pendingDays,
          remainingDays: Number(
            (entitledDays + carriedForwardDays - usedDays - pendingDays).toFixed(2),
          ),
          entitlementBreakdown: isOverridden ? [] : calculated.breakdown,
        };
      }),
    );

    return { employeeId, year, balances };
  }

  /** HR records a per-employee deviation from the policy. */
  async setBalance(dto: SetBalanceDto) {
    const [employee, leaveType] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: dto.employeeId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.leaveType.findUnique({ where: { id: dto.leaveTypeId }, select: { id: true } }),
    ]);
    if (!employee) throw new BadRequestException('That employee does not exist.');
    if (!leaveType) throw new BadRequestException('That leave type does not exist.');

    const data = {
      entitlementOverrideDays: dto.entitlementOverrideDays ?? null,
      carriedForwardDays: dto.carriedForwardDays ?? 0,
      notes: dto.notes ?? null,
    };

    const balance = await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
        },
      },
      update: data,
      create: {
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        ...data,
      },
    });

    return {
      ...balance,
      entitlementOverrideDays:
        balance.entitlementOverrideDays === null
          ? null
          : this.num(balance.entitlementOverrideDays),
      carriedForwardDays: this.num(balance.carriedForwardDays),
    };
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  /**
   * Who may decide this employee's requests RIGHT NOW.
   *
   * Read live from the open EmploymentAssignment on every call, not from the
   * `approverId` stored on the request. If someone changes manager while a
   * request is pending, the new manager can act on it immediately and the
   * request never strands with someone who has moved on.
   *
   * `LeaveRequest.approverId` still records who was originally asked — that is
   * audit, not authorisation.
   *
   * Falls back to the department head so a direct report of the CEO is not
   * stranded. Null is still possible (the CEO's own request), in which case
   * only someone with wider scope — HR — can decide it.
   */
  private async resolveCurrentApprover(employeeId: string): Promise<string | null> {
    const assignment = await this.prisma.employmentAssignment.findFirst({
      where: { employeeId, effectiveTo: null },
      select: { managerId: true, department: { select: { headEmployeeId: true } } },
    });

    if (assignment?.managerId) return assignment.managerId;

    const head = assignment?.department?.headEmployeeId ?? null;
    return head && head !== employeeId ? head : null;
  }

  async listRequests(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    query: QueryLeaveRequestsDto,
  ) {
    const scopeFilter = await this.permissions.buildEmployeeScopeFilter(callerEmployeeId, scope);

    const filters: Prisma.LeaveRequestWhereInput[] = [
      { employee: { is: { AND: [scopeFilter, { deletedAt: null }] } } },
    ];

    if (query.status) filters.push({ status: query.status });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });

    // The manager's queue: pending requests from people whose CURRENT manager
    // is the caller. Resolved from the live reporting line, not the stored
    // approverId, so a manager change re-routes the queue automatically.
    if (query.awaitingMyDecision) {
      if (!callerEmployeeId) return this.emptyPage(query);
      filters.push({
        status: LeaveRequestStatus.PENDING,
        employeeId: { not: callerEmployeeId },
        employee: {
          is: { assignments: { some: { effectiveTo: null, managerId: callerEmployeeId } } },
        },
      });
    }

    const where: Prisma.LeaveRequestWhereInput = { AND: filters };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const [items, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return {
      items: items.map((item) => this.shapeRequest(item)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      scope,
    };
  }

  private shapeRequest<T extends { days: Prisma.Decimal; appliedPolicy?: unknown }>(item: T) {
    const policy = item.appliedPolicy as { quotaDays?: Prisma.Decimal } | null | undefined;
    return {
      ...item,
      days: this.num(item.days),
      appliedPolicy: policy
        ? { ...policy, quotaDays: this.num(policy.quotaDays) }
        : null,
    };
  }

  private emptyPage(query: QueryLeaveRequestsDto) {
    return {
      items: [],
      total: 0,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
      totalPages: 1,
      scope: PermissionScope.SELF,
    };
  }

  async getRequest(callerEmployeeId: string | null, scope: PermissionScope, id: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!request) throw new NotFoundException('Leave request not found.');

    await this.assertEmployeeVisible(callerEmployeeId, scope, request.employeeId);
    return this.shapeRequest(request);
  }

  /**
   * Submits a request.
   *
   * Validation runs cheapest-and-clearest first, so the message a person sees
   * is the most useful one:
   *   1. the leave type is active
   *   2. a policy exists for the requested dates
   *   3. end date not before start date
   *   4. at least one working day in the range
   *   5. the policy's minimum notice period is satisfied
   *   6. no overlap with an existing request
   *   7. enough balance, unless the type does not require one
   *
   * The POLICY IN FORCE ON THE START DATE governs — not today's policy. A
   * request for next March is judged by March's rules.
   */
  async createRequest(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    dto: CreateLeaveRequestDto,
  ) {
    const employeeId = dto.employeeId ?? callerEmployeeId;
    if (!employeeId) {
      throw new BadRequestException('Your login is not linked to an employee record.');
    }

    if (employeeId !== callerEmployeeId && scope === PermissionScope.SELF) {
      throw new ForbiddenException('You can only request leave for yourself.');
    }
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    const leaveType = await this.prisma.leaveType.findUnique({ where: { id: dto.leaveTypeId } });
    if (!leaveType) throw new BadRequestException('That leave type does not exist.');

    // --- 1. active type -------------------------------------------------------
    if (!leaveType.isActive) {
      throw new BadRequestException(`${leaveType.name} has been archived and cannot be requested.`);
    }

    const startDate = toDateOnly(new Date(dto.startDate));
    const endDate = toDateOnly(new Date(dto.endDate));

    // --- 3. dates -------------------------------------------------------------
    if (endDate < startDate) {
      throw new BadRequestException('The end date cannot be before the start date.');
    }

    // --- 2. a policy covers these dates ---------------------------------------
    const policy = await this.policies.getPolicyOn(leaveType.id, startDate);
    if (!policy) {
      throw new BadRequestException(
        `No ${leaveType.name} policy is in force on ${formatDate(startDate)}. Ask HR to set one up before requesting leave for that date.`,
      );
    }

    // --- 4. working days ------------------------------------------------------
    const days = countWorkingDays(startDate, endDate);
    if (days <= 0) {
      throw new BadRequestException(
        'That range contains no working days — it falls entirely on a weekend.',
      );
    }

    // --- 5. minimum notice ----------------------------------------------------
    // Calendar days, not working days: "two days' notice" is ordinarily read as
    // two days on the calendar.
    if (policy.minNoticeDays > 0) {
      const earliest = toDateOnly(new Date());
      earliest.setUTCDate(earliest.getUTCDate() + policy.minNoticeDays);

      if (startDate < earliest) {
        throw new BadRequestException(
          `${leaveType.name} needs ${policy.minNoticeDays} day${policy.minNoticeDays === 1 ? '' : 's'} of notice. The earliest you can start is ${formatDate(earliest)}.`,
        );
      }
    }

    // --- 6. overlap -----------------------------------------------------------
    const clash = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ACTIVE_STATUSES },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      include: { leaveType: { select: { name: true } } },
    });

    if (clash) {
      throw new ConflictException(
        `This overlaps an existing ${clash.status.toLowerCase()} request (${clash.leaveType.name}, ${formatDate(clash.startDate)} to ${formatDate(clash.endDate)}).`,
      );
    }

    // --- 7. balance -----------------------------------------------------------
    if (leaveType.requiresBalance) {
      const year = leaveYearOf(startDate);
      const summary = await this.getBalances(callerEmployeeId, scope, { employeeId, year });
      const forType = summary.balances.find((b) => b.leaveTypeId === leaveType.id);
      const remaining = forType?.remainingDays ?? 0;

      if (days > remaining) {
        throw new BadRequestException(
          `Not enough ${leaveType.name} left: this request is ${days} day${days === 1 ? '' : 's'} but only ${remaining} remain${remaining === 1 ? 's' : ''} for ${year}. Pending requests already reserve part of the balance.`,
        );
      }
    }

    // --- route or auto-approve ------------------------------------------------
    const approverId = await this.resolveCurrentApprover(employeeId);

    // When the policy says no approval is needed, the request is APPROVED on
    // submission and flagged, so a report can tell "nobody needed to agree"
    // apart from "a person agreed".
    const autoApprove = !policy.approvalRequired;

    const created = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: leaveType.id,
        startDate,
        endDate,
        days,
        reason: dto.reason.trim(),
        status: autoApprove ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.PENDING,
        approverId,
        appliedPolicyId: policy.id,
        autoApproved: autoApprove,
        decidedAt: autoApprove ? new Date() : null,
        decisionComment: autoApprove
          ? `Automatically approved — ${leaveType.name} does not require approval.`
          : null,
      },
      include: REQUEST_INCLUDE,
    });

    this.logger.log(
      `Leave requested by ${employeeId} (${days}d ${leaveType.code}) — ${autoApprove ? 'auto-approved' : `routed to ${approverId ?? 'nobody'}`}`,
    );

    return this.shapeRequest(created);
  }

  /**
   * Approve or reject.
   *
   * Two checks, both necessary:
   *   - you cannot decide your OWN request, even if you would otherwise be its
   *     approver. A manager holds approve permission at TEAM scope and TEAM
   *     includes themselves, so scope alone would allow it.
   *   - you must be the employee's CURRENT manager, or hold approval
   *     permission at a scope covering them (which is how HR unblocks a
   *     request whose manager has left).
   */
  async decideRequest(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    id: string,
    decision: typeof LeaveRequestStatus.APPROVED | typeof LeaveRequestStatus.REJECTED,
    comment?: string,
  ) {
    if (!callerEmployeeId) {
      throw new ForbiddenException('Your login is not linked to an employee record.');
    }

    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { leaveType: { select: { name: true, requiresBalance: true } } },
    });
    if (!request) throw new NotFoundException('Leave request not found.');

    if (request.employeeId === callerEmployeeId) {
      throw new ForbiddenException('You cannot approve or reject your own leave request.');
    }

    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new ConflictException(`This request has already been ${request.status.toLowerCase()}.`);
    }

    const currentApprover = await this.resolveCurrentApprover(request.employeeId);
    const isCurrentApprover = currentApprover === callerEmployeeId;
    const canReachEmployee = await this.permissions.canAccessEmployee(
      callerEmployeeId,
      scope,
      request.employeeId,
    );

    if (!isCurrentApprover && !canReachEmployee) {
      throw new ForbiddenException('This request was not routed to you.');
    }

    // Re-check the balance at approval time — other requests may have been
    // approved since this one was submitted.
    if (decision === LeaveRequestStatus.APPROVED && request.leaveType.requiresBalance) {
      const year = leaveYearOf(request.startDate);
      const summary = await this.getBalances(callerEmployeeId, scope, {
        employeeId: request.employeeId,
        year,
      });
      const forType = summary.balances.find((b) => b.leaveTypeId === request.leaveTypeId);
      // This request is PENDING, so it is already inside remainingDays. Adding
      // it back gives what would remain if it were approved.
      const remainingIfApproved = (forType?.remainingDays ?? 0) + this.num(request.days);

      if (this.num(request.days) > remainingIfApproved) {
        throw new BadRequestException(
          `Approving this would exceed the employee's ${request.leaveType.name} balance for ${year}.`,
        );
      }
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: decision,
        decidedById: callerEmployeeId,
        decidedAt: new Date(),
        decisionComment: comment?.trim() || null,
      },
      include: REQUEST_INCLUDE,
    });

    this.logger.log(`Leave request ${id} ${decision.toLowerCase()} by ${callerEmployeeId}`);

    return this.shapeRequest(updated);
  }

  /**
   * Withdrawn by the employee (or by HR on their behalf).
   *
   * Allowed while PENDING, and while APPROVED provided the leave has not
   * started — plans change. Cancelling frees the reserved balance
   * automatically, because balances are derived rather than stored.
   *
   * Leave that has already begun is deliberately NOT cancellable here: it is a
   * historical fact that someone was off, and unwinding it is an HR correction
   * rather than a self-service action.
   */
  async cancelRequest(callerEmployeeId: string | null, scope: PermissionScope, id: string) {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Leave request not found.');

    const isOwn = request.employeeId === callerEmployeeId;
    if (!isOwn) {
      await this.assertEmployeeVisible(callerEmployeeId, scope, request.employeeId);
      if (scope === PermissionScope.SELF) {
        throw new ForbiddenException('You can only cancel your own leave requests.');
      }
    }

    if (request.status === LeaveRequestStatus.CANCELLED) {
      throw new ConflictException('This request is already cancelled.');
    }
    if (request.status === LeaveRequestStatus.REJECTED) {
      throw new ConflictException('A rejected request cannot be cancelled.');
    }

    const today = toDateOnly(new Date());
    if (request.status === LeaveRequestStatus.APPROVED && request.startDate <= today) {
      throw new ConflictException(
        'This leave has already started. Ask HR to adjust it rather than cancelling.',
      );
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveRequestStatus.CANCELLED, cancelledAt: new Date() },
      include: REQUEST_INCLUDE,
    });

    return this.shapeRequest(updated);
  }
}
