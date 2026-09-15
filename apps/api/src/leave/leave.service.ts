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
} satisfies Prisma.LeaveRequestInclude;

export interface BalanceSummary {
  leaveTypeId: string;
  code: string;
  name: string;
  requiresBalance: boolean;
  year: number;
  entitledDays: number;
  approvedDays: number;
  pendingDays: number;
  /** entitled − approved − pending. Can be negative if HR lowers an entitlement. */
  remainingDays: number;
}

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Prisma returns Decimal objects; the API speaks plain numbers. */
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
  // Only `entitledDays` is stored. Taken, pending, and remaining are DERIVED by
  // summing requests every time they are asked for.
  //
  // That is deliberate: a stored "remaining" column would be a second source of
  // truth that drifts the moment a request is cancelled, back-dated, or edited.
  // Summing a handful of rows is cheap; reconciling a drifted counter is not.
  // ---------------------------------------------------------------------------

  async getBalances(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    query: QueryBalancesDto,
  ): Promise<{ employeeId: string; year: number; balances: BalanceSummary[] }> {
    const employeeId = query.employeeId ?? callerEmployeeId;
    if (!employeeId) {
      throw new BadRequestException('No employee to show balances for.');
    }
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    const year = query.year ?? new Date().getUTCFullYear();

    const [types, stored, requests] = await Promise.all([
      this.prisma.leaveType.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
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

    const storedByType = new Map(stored.map((b) => [b.leaveTypeId, b]));

    return {
      employeeId,
      year,
      balances: types.map((type) => {
        const forType = requests.filter((r) => r.leaveTypeId === type.id);
        const approvedDays = forType
          .filter((r) => r.status === LeaveRequestStatus.APPROVED)
          .reduce((sum, r) => sum + this.num(r.days), 0);
        const pendingDays = forType
          .filter((r) => r.status === LeaveRequestStatus.PENDING)
          .reduce((sum, r) => sum + this.num(r.days), 0);

        const entitledDays = this.num(storedByType.get(type.id)?.entitledDays);

        return {
          leaveTypeId: type.id,
          code: type.code,
          name: type.name,
          requiresBalance: type.requiresBalance,
          year,
          entitledDays,
          approvedDays,
          pendingDays,
          remainingDays: Number((entitledDays - approvedDays - pendingDays).toFixed(2)),
        };
      }),
    };
  }

  /** HR sets an entitlement. Upsert, so re-running is safe. */
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

    const balance = await this.prisma.leaveBalance.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
        },
      },
      update: { entitledDays: dto.entitledDays, notes: dto.notes ?? null },
      create: {
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        entitledDays: dto.entitledDays,
        notes: dto.notes ?? null,
      },
    });

    return { ...balance, entitledDays: this.num(balance.entitledDays) };
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  async listRequests(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    query: QueryLeaveRequestsDto,
  ) {
    const scopeFilter = await this.permissions.buildEmployeeScopeFilter(callerEmployeeId, scope);

    const filters: Prisma.LeaveRequestWhereInput[] = [
      // Restrict to employees the caller may see. `is` applies the employee
      // filter through the relation.
      { employee: { is: { AND: [scopeFilter, { deletedAt: null }] } } },
    ];

    if (query.status) filters.push({ status: query.status });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });

    // The manager's queue: pending, routed to me, and not my own request.
    if (query.awaitingMyDecision) {
      if (!callerEmployeeId) return this.emptyPage(query);
      filters.push({
        status: LeaveRequestStatus.PENDING,
        approverId: callerEmployeeId,
        employeeId: { not: callerEmployeeId },
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
      items: items.map((item) => ({ ...item, days: this.num(item.days) })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      scope,
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
    return { ...request, days: this.num(request.days) };
  }

  /**
   * Submits a request.
   *
   * Validation order is deliberate — cheapest and clearest failures first, so
   * the message a person sees is the most useful one:
   *   1. dates make sense
   *   2. the range contains at least one working day
   *   3. no overlap with an existing request
   *   4. enough balance (unless the type does not require one)
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

    // Submitting for someone else requires the permission to reach beyond your
    // own record. SELF scope means you may only request your own leave.
    if (employeeId !== callerEmployeeId && scope === PermissionScope.SELF) {
      throw new ForbiddenException('You can only request leave for yourself.');
    }
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    const leaveType = await this.prisma.leaveType.findUnique({ where: { id: dto.leaveTypeId } });
    if (!leaveType) throw new BadRequestException('That leave type does not exist.');
    if (!leaveType.isActive) {
      throw new BadRequestException(`${leaveType.name} is no longer available.`);
    }

    const startDate = toDateOnly(new Date(dto.startDate));
    const endDate = toDateOnly(new Date(dto.endDate));

    // --- 1. dates -------------------------------------------------------------
    if (endDate < startDate) {
      throw new BadRequestException('The end date cannot be before the start date.');
    }

    // --- 2. working days ------------------------------------------------------
    const days = countWorkingDays(startDate, endDate);
    if (days <= 0) {
      throw new BadRequestException(
        'That range contains no working days — it falls entirely on a weekend.',
      );
    }

    // --- 3. overlap -----------------------------------------------------------
    // Two ranges overlap when each starts on or before the other ends.
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

    // --- 4. balance -----------------------------------------------------------
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

    // --- route it -------------------------------------------------------------
    const approverId = await this.resolveApprover(employeeId);

    const created = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: leaveType.id,
        startDate,
        endDate,
        days,
        reason: dto.reason.trim(),
        status: LeaveRequestStatus.PENDING,
        approverId,
      },
      include: REQUEST_INCLUDE,
    });

    this.logger.log(
      `Leave requested by ${employeeId} (${days}d ${leaveType.code}), routed to ${approverId ?? 'nobody'}`,
    );

    return { ...created, days: this.num(created.days) };
  }

  /**
   * Who should decide this request.
   *
   * Read from the employee's OPEN EmploymentAssignment rather than the cached
   * `Employee.managerId`. The two agree — the assignment service keeps them in
   * step — but the assignment is the source of truth, and reading it here means
   * this stays correct even if the cache is ever wrong.
   *
   * Falls back to the department head when someone has no manager, so a
   * request from a direct report of the CEO does not vanish. Null approver is
   * still possible (the CEO's own request), in which case only someone with
   * wider scope, i.e. HR, can decide it.
   */
  private async resolveApprover(employeeId: string): Promise<string | null> {
    const assignment = await this.prisma.employmentAssignment.findFirst({
      where: { employeeId, effectiveTo: null },
      select: { managerId: true, department: { select: { headEmployeeId: true } } },
    });

    if (assignment?.managerId) return assignment.managerId;

    const head = assignment?.department?.headEmployeeId ?? null;
    return head && head !== employeeId ? head : null;
  }

  /**
   * Approve or reject.
   *
   * Two separate checks, and both matter:
   *   - you cannot decide your own request, even if you are somehow its
   *     approver (a department head whose manager is unset would otherwise be
   *     routed their own request)
   *   - you must either be the named approver, or hold approval permission at a
   *     scope that covers this employee (which is how HR can unblock a request
   *     whose manager has left)
   */
  async decideRequest(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    id: string,
    // Prisma 6 generates enums as const objects, so `LeaveRequestStatus` is a
    // string-literal union in type position, not a namespace. `typeof X.MEMBER`
    // narrows to that member's literal while keeping the link to the enum.
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
      throw new ConflictException(
        `This request has already been ${request.status.toLowerCase()}.`,
      );
    }

    const isNamedApprover = request.approverId === callerEmployeeId;
    const canReachEmployee = await this.permissions.canAccessEmployee(
      callerEmployeeId,
      scope,
      request.employeeId,
    );

    if (!isNamedApprover && !canReachEmployee) {
      throw new ForbiddenException('This request was not routed to you.');
    }

    // Re-check the balance at approval time. The employee may have had other
    // requests approved since this one was submitted.
    if (decision === LeaveRequestStatus.APPROVED && request.leaveType.requiresBalance) {
      const year = leaveYearOf(request.startDate);
      const summary = await this.getBalances(callerEmployeeId, scope, {
        employeeId: request.employeeId,
        year,
      });
      const forType = summary.balances.find((b) => b.leaveTypeId === request.leaveTypeId);
      // This request is itself PENDING, so it is already inside remainingDays.
      // Adding it back gives what would remain if it were approved.
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

    return { ...updated, days: this.num(updated.days) };
  }

  /**
   * Withdrawn by the employee (or by HR on their behalf).
   *
   * Allowed while PENDING, and also while APPROVED provided the leave has not
   * started — people's plans change. Cancelling frees the reserved balance
   * automatically, because balances are derived rather than stored.
   */
  async cancelRequest(callerEmployeeId: string | null, scope: PermissionScope, id: string) {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Leave request not found.');

    const isOwn = request.employeeId === callerEmployeeId;
    if (!isOwn) {
      // Someone else's request: only with scope that reaches them.
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

    return { ...updated, days: this.num(updated.days) };
  }
}
