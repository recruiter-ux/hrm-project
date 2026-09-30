import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LeaveRequestStatus, PermissionScope, type Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateLeaveRequestDto,
  QueryBalancesDto,
  QueryLeaveRequestsDto,
  SetBalanceDto,
} from './dto/leave.dto';
import { LeavePolicyService, type EntitlementBreakdownRow } from './leave-policy.service';
import * as LeaveNotifications from './leave-notifications';
import { countWorkingDays, formatDate, leaveYearOf, toDateOnly } from './working-days';

/** Statuses that consume entitlement and block overlapping dates. */
const ACTIVE_STATUSES: LeaveRequestStatus[] = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
];

/**
 * Someone in one of these states cannot be asked to approve leave: they have
 * left, or their access is suspended pending something. ON_LEAVE and
 * NOTICE_PERIOD are deliberately NOT here — a manager on a week's holiday is
 * still the right approver, and escalating past them would be surprising.
 */
const INELIGIBLE_APPROVER_STATUSES = ['TERMINATED', 'SUSPENDED'] as const;

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

/** Where an approver came from, so the UI and the audit can explain it. */
export type ApproverSource = 'MANAGER' | 'DEPARTMENT_HEAD' | 'NONE';

export interface ApproverResolution {
  approverId: string | null;
  source: ApproverSource;
  /** Plain-English explanation, shown to the employee when nobody was found. */
  note: string | null;
}

/**
 * Prisma's transaction client. Balance arithmetic runs against either this or
 * the plain service, depending on whether it is inside the concurrency lock.
 */
type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly policies: LeavePolicyService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
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
  //
  // ⚠️ ONE CALCULATION, ONE PLACE. `computeBalance` below is the only code
  // that works out what someone has left. The balances screen, the submission
  // check, and the approval re-check all call it, so they cannot drift apart
  // and disagree about whether a request fits.
  // ---------------------------------------------------------------------------

  /**
   * ⚠️ THE BALANCE CALCULATION IS SPLIT IN TWO, AND THE SPLIT IS NOT COSMETIC.
   *
   * A person's remaining days come from two very different kinds of data:
   *
   *   ENTITLEMENT   the policy for that year, plus any HR override. Nothing a
   *                 colleague does — or that this person does in another tab —
   *                 can change it while a request is being submitted.
   *
   *   CONSUMPTION   the days this employee has already used or reserved. This
   *                 is exactly what two simultaneous submissions fight over,
   *                 so it MUST be read inside the lock.
   *
   * Keeping them apart is what lets the locked transaction stay tiny and, far
   * more importantly, touch ONLY its own connection. See `submitUnderLock`.
   */

  /** Contention-free. Always read on the main pool, never inside a transaction. */
  private async resolveEntitlement(
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<{
    entitledDays: number;
    isOverridden: boolean;
    carriedForwardDays: number;
    breakdown: EntitlementBreakdownRow[];
  }> {
    const [override, calculated] = await Promise.all([
      this.prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      }),
      this.policies.calculateEntitlement(leaveTypeId, year),
    ]);

    const isOverridden =
      override?.entitlementOverrideDays !== null && override?.entitlementOverrideDays !== undefined;

    return {
      entitledDays: isOverridden
        ? this.num(override.entitlementOverrideDays)
        : calculated.entitledDays,
      isOverridden,
      carriedForwardDays: this.num(override?.carriedForwardDays),
      breakdown: isOverridden ? [] : calculated.breakdown,
    };
  }

  /**
   * The contended half: days already committed or reserved, for one type, in
   * one year.
   *
   * Takes a client so the submission path can run it on the transaction that
   * holds the row lock — and ONLY on that client.
   */
  private async sumActiveDays(
    db: DbClient,
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<{ usedDays: number; pendingDays: number }> {
    const requests = await db.leaveRequest.findMany({
      where: {
        employeeId,
        leaveTypeId,
        status: { in: ACTIVE_STATUSES },
        startDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31)),
        },
      },
      select: { days: true, status: true },
    });

    return {
      usedDays: requests
        .filter((r) => r.status === LeaveRequestStatus.APPROVED)
        .reduce((sum, r) => sum + this.num(r.days), 0),
      pendingDays: requests
        .filter((r) => r.status === LeaveRequestStatus.PENDING)
        .reduce((sum, r) => sum + this.num(r.days), 0),
    };
  }

  /** Days rounded to two decimals, the way every figure in this module is. */
  private remainingDays(
    entitlement: { entitledDays: number; carriedForwardDays: number },
    consumption: { usedDays: number; pendingDays: number },
  ): number {
    return Number(
      (
        entitlement.entitledDays +
        entitlement.carriedForwardDays -
        consumption.usedDays -
        consumption.pendingDays
      ).toFixed(2),
    );
  }

  /**
   * One leave type, one employee, one year — the whole picture.
   *
   * The READ path only: the balances screen and the approval re-check. Both
   * run outside any transaction, so both halves use the main pool.
   */
  private async computeBalance(
    employeeId: string,
    type: { id: string; code: string; name: string; requiresBalance: boolean },
    year: number,
  ): Promise<BalanceSummary> {
    const [entitlement, consumption] = await Promise.all([
      this.resolveEntitlement(employeeId, type.id, year),
      this.sumActiveDays(this.prisma, employeeId, type.id, year),
    ]);

    return {
      leaveTypeId: type.id,
      code: type.code,
      name: type.name,
      requiresBalance: type.requiresBalance,
      year,
      entitledDays: entitlement.entitledDays,
      isOverridden: entitlement.isOverridden,
      carriedForwardDays: entitlement.carriedForwardDays,
      usedDays: consumption.usedDays,
      pendingDays: consumption.pendingDays,
      remainingDays: this.remainingDays(entitlement, consumption),
      entitlementBreakdown: entitlement.breakdown,
    };
  }

  async getBalances(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    query: QueryBalancesDto,
  ): Promise<{ employeeId: string; year: number; balances: BalanceSummary[] }> {
    const employeeId = query.employeeId ?? callerEmployeeId;
    if (!employeeId) throw new BadRequestException('No employee to show balances for.');
    await this.assertEmployeeVisible(callerEmployeeId, scope, employeeId);

    const year = query.year ?? new Date().getUTCFullYear();
    const types = await this.prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const balances = await Promise.all(
      types.map((type) => this.computeBalance(employeeId, type, year)),
    );

    return { employeeId, year, balances };
  }

  /** HR records a per-employee deviation from the policy. */
  async setBalance(dto: SetBalanceDto, actorEmployeeId: string | null) {
    const [employee, leaveType] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: dto.employeeId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.leaveType.findUnique({
        where: { id: dto.leaveTypeId },
        select: { id: true, name: true },
      }),
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

    await this.audit.record({
      actorId: actorEmployeeId,
      action: 'leave_balance.set',
      entityType: 'leave_balance',
      entityId: balance.id,
      summary:
        `Set ${leaveType.name} ${dto.year} for ${employee.firstName} ${employee.lastName}: ` +
        `entitlement override ${data.entitlementOverrideDays ?? 'none'}, carried forward ${data.carriedForwardDays}`,
      after: data as Prisma.InputJsonValue,
    });

    return {
      ...balance,
      entitlementOverrideDays:
        balance.entitlementOverrideDays === null ? null : this.num(balance.entitlementOverrideDays),
      carriedForwardDays: this.num(balance.carriedForwardDays),
    };
  }

  // ---------------------------------------------------------------------------
  // Approver resolution
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
   * THE EDGE CASES, AND WHAT HAPPENS IN EACH:
   *
   *   manager set, still employed      → the manager
   *   manager left / suspended         → fall through to the department head
   *   manager is the employee          → fall through (nobody approves
   *                                       themselves, even by accident)
   *   no manager (CEO's report)        → the department head
   *   head also unavailable or is them → NONE, and HR is notified
   *
   * ⚠️ NONE NEVER MEANS "APPROVE IT ANYWAY". The request stays PENDING, the
   * employee is told plainly that it went to HR, and HR is notified. Silently
   * approving something nobody agreed to would be the worst possible answer.
   */
  async resolveApprover(employeeId: string): Promise<ApproverResolution> {
    const assignment = await this.prisma.employmentAssignment.findFirst({
      where: { employeeId, effectiveTo: null },
      select: {
        managerId: true,
        department: { select: { headEmployeeId: true } },
      },
    });

    const candidates: Array<{ id: string | null; source: ApproverSource }> = [
      { id: assignment?.managerId ?? null, source: 'MANAGER' },
      { id: assignment?.department?.headEmployeeId ?? null, source: 'DEPARTMENT_HEAD' },
    ];

    let sawIneligible = false;

    for (const candidate of candidates) {
      if (!candidate.id || candidate.id === employeeId) continue;

      const person = await this.prisma.employee.findFirst({
        where: {
          id: candidate.id,
          deletedAt: null,
          status: { notIn: [...INELIGIBLE_APPROVER_STATUSES] },
        },
        select: { id: true },
      });

      if (person) return { approverId: person.id, source: candidate.source, note: null };
      sawIneligible = true;
    }

    return {
      approverId: null,
      source: 'NONE',
      note: sawIneligible
        ? 'The manager on file has left the company or is suspended.'
        : 'This employee has no manager and no department head on file.',
    };
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
      { employee: { is: { AND: [scopeFilter, { deletedAt: null }] } } },
    ];

    if (query.status) filters.push({ status: query.status });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });

    // The manager's queue: pending requests from people whose CURRENT manager
    // is the caller. Resolved from the live reporting line, not the stored
    // approverId, so a manager change re-routes the queue automatically.
    //
    // Someone with wider approval rights (HR at GLOBAL scope) additionally
    // sees requests that could not be routed to anyone — otherwise the
    // notification they receive would lead to an empty screen.
    if (query.awaitingMyDecision) {
      if (!callerEmployeeId) return this.emptyPage(query);

      const queueFilters: Prisma.LeaveRequestWhereInput[] = [
        {
          employee: {
            is: { assignments: { some: { effectiveTo: null, managerId: callerEmployeeId } } },
          },
        },
      ];

      if (scope === PermissionScope.GLOBAL) {
        queueFilters.push({ approverId: null });
      }

      filters.push({
        status: LeaveRequestStatus.PENDING,
        employeeId: { not: callerEmployeeId },
        OR: queueFilters,
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
      appliedPolicy: policy ? { ...policy, quotaDays: this.num(policy.quotaDays) } : null,
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
   * Working days in a range, for the request form's live preview.
   *
   * Exists so the browser never counts days itself. The number a person sees
   * before submitting is produced by the SAME function that stores it, which
   * is what stops the preview and the saved record disagreeing — and keeps
   * being true on the day a public-holiday calendar lands.
   */
  calculateDays(startDate: string, endDate: string) {
    const start = toDateOnly(new Date(startDate));
    const end = toDateOnly(new Date(endDate));

    if (end < start) {
      return { startDate: formatDate(start), endDate: formatDate(end), days: 0, valid: false };
    }

    return {
      startDate: formatDate(start),
      endDate: formatDate(end),
      days: countWorkingDays(start, end),
      valid: true,
    };
  }

  /**
   * Submits a request.
   *
   * Validation runs cheapest-and-clearest first, so the message a person sees
   * is the most useful one:
   *   1. the leave type is active
   *   2. end date not before start date
   *   3. a policy exists for the requested dates
   *   4. at least one working day in the range
   *   5. the policy's minimum notice period is satisfied
   *   6. no overlap with an existing request
   *   7. enough balance, unless the type does not require one
   *
   * The POLICY IN FORCE ON THE START DATE governs — not today's policy. A
   * request for next March is judged by March's rules.
   *
   * ⚠️ STEPS 6 AND 7 ARE REPEATED INSIDE A LOCK. See `submitUnderLock`.
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

    // --- 2. dates -------------------------------------------------------------
    if (endDate < startDate) {
      throw new BadRequestException('The end date cannot be before the start date.');
    }

    // --- 3. a policy covers these dates ---------------------------------------
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

    // --- route or auto-approve ------------------------------------------------
    const approval = await this.resolveApprover(employeeId);
    const autoApprove = !policy.approvalRequired;

    // ⚠️ RESOLVED BEFORE THE LOCK IS TAKEN, DELIBERATELY.
    //
    // Entitlement depends on policy and on any HR override — neither of which
    // a competing submission can change. Reading it here rather than inside
    // the transaction is what keeps the transaction to a single database
    // connection. See the comment on `submitUnderLock` for what happened when
    // it did not.
    const entitlement = leaveType.requiresBalance
      ? await this.resolveEntitlement(employeeId, leaveType.id, leaveYearOf(startDate))
      : null;

    // --- 6 and 7, then the insert, all under one lock -------------------------
    const created = await this.submitUnderLock({
      employeeId,
      leaveType,
      policyId: policy.id,
      startDate,
      endDate,
      days,
      reason: dto.reason.trim(),
      approverId: approval.approverId,
      autoApprove,
      entitlement,
    });

    // --- everything below happens AFTER the transaction has committed ---------
    // A notification about a change that then rolled back would be a lie, and
    // a mail server must never be able to undo an approved request.
    await this.announceSubmission(created, approval, autoApprove);

    this.logger.log(
      `Leave requested by ${employeeId} (${days}d ${leaveType.code}) — ${
        autoApprove ? 'auto-approved' : `routed to ${approval.approverId ?? 'HR (no approver)'}`
      }`,
    );

    return {
      ...this.shapeRequest(created),
      /** Tells the employee where it went, including when the answer is "HR". */
      routing: { source: approval.source, note: approval.note },
    };
  }

  /**
   * =========================================================================
   * THE CONCURRENCY GUARD
   *
   * The problem: someone with 2 days left clicks Submit twice in the same
   * instant, or has two browser tabs open. Both requests read "2 days
   * remaining", both pass validation, and both are written — 4 days are taken
   * from a 2-day balance. Checking-then-writing is never safe on its own.
   *
   * The fix: `SELECT ... FOR UPDATE` on the employee's own row. Postgres hands
   * that lock to one transaction at a time, so the second submission waits,
   * then re-reads a balance that already includes the first request and is
   * correctly rejected.
   *
   * WHY LOCK THE EMPLOYEE ROW rather than the leave requests: there is no row
   * to lock for a request that does not exist yet. The employee is the thing
   * both submissions have in common, and locking it serialises exactly the
   * people who are competing — one person's submissions queue behind each
   * other, and everyone else is unaffected.
   *
   * The overlap and balance checks are repeated in here deliberately. The
   * copies outside the lock are not redundant: they produce a fast, friendly
   * error in the ordinary case without paying for a lock.
   *
   * ⚠️⚠️ NEVER QUERY `this.prisma` FROM INSIDE THIS TRANSACTION. Use `tx`.
   *
   * This cost a red CI build, and the failure mode is worth understanding
   * because it will happen again to anyone who forgets.
   *
   * An interactive transaction holds ONE connection from Prisma's pool for its
   * whole lifetime. The pool defaults to `physical_cores * 2 + 1` — on a
   * two-core CI runner, five. This method used to call a helper that read the
   * policy through `this.prisma`, asking the pool for a SECOND connection
   * while still holding the first.
   *
   * With five people submitting at once:
   *   - five transactions each take one connection: the pool is empty
   *   - each then waits for a connection to read the policy
   *   - none can finish, so none gives its connection back
   *   - every one dies at the 5-second transaction timeout (P2028)
   *
   * A textbook pool-starvation deadlock. Locally it was invisible, because a
   * developer machine with sixteen logical cores has a pool of thirty-three
   * and plenty of slack. It only appeared on the smaller machine.
   *
   * The fix is structural rather than a bigger pool: everything that does not
   * need the lock is resolved BEFORE the transaction opens (see
   * `resolveEntitlement`), and what remains inside touches `tx` alone. The
   * transaction is now four statements long and needs exactly one connection,
   * so it cannot starve however many people submit at once.
   * =========================================================================
   */
  private async submitUnderLock(input: {
    employeeId: string;
    leaveType: { id: string; code: string; name: string; requiresBalance: boolean };
    policyId: string;
    startDate: Date;
    endDate: Date;
    days: number;
    reason: string;
    approverId: string | null;
    autoApprove: boolean;
    /** Pre-resolved outside the lock. Null when the type needs no balance. */
    entitlement: { entitledDays: number; carriedForwardDays: number } | null;
  }) {
    const { employeeId, leaveType, startDate, endDate, days, entitlement } = input;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Take the lock. Nothing is read from the result — the wait is the point.
          await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;

          // --- 6. overlap -----------------------------------------------------
          const clash = await tx.leaveRequest.findFirst({
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

          // --- 7. balance -----------------------------------------------------
          // Only the CONSUMED half is read here; entitlement came in already
          // resolved. One connection, four statements, in and out.
          if (entitlement) {
            const year = leaveYearOf(startDate);
            const consumption = await this.sumActiveDays(tx, employeeId, leaveType.id, year);
            const remaining = this.remainingDays(entitlement, consumption);

            if (days > remaining) {
              throw new BadRequestException(
                `Not enough ${leaveType.name} left: this request is ${days} day${days === 1 ? '' : 's'} but only ${remaining} remain${remaining === 1 ? 's' : ''} for ${year}. Pending requests already reserve part of the balance.`,
              );
            }
          }

          return tx.leaveRequest.create({
            data: {
              employeeId,
              leaveTypeId: leaveType.id,
              startDate,
              endDate,
              days,
              reason: input.reason,
              status: input.autoApprove ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.PENDING,
              approverId: input.approverId,
              appliedPolicyId: input.policyId,
              autoApproved: input.autoApprove,
              decidedAt: input.autoApprove ? new Date() : null,
              decisionComment: input.autoApprove
                ? `Automatically approved — ${leaveType.name} does not require approval.`
                : null,
            },
            include: REQUEST_INCLUDE,
          });
        },
        {
          // A row lock serialises writers by design, so a queue is normal and
          // not a symptom. These are deliberately far above what the work
          // needs (about 20ms) — they exist so a burst of submissions waits
          // its turn instead of erroring, while still failing eventually
          // rather than hanging for ever.
          maxWait: 10_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      // P2024: could not get a connection from the pool.
      // P2028: the transaction ran past its timeout.
      // Either means the system is saturated, not that the request was wrong —
      // so say so, and say it is worth retrying, rather than returning a bare
      // 500 that reads like a bug in the request.
      if (code === 'P2024' || code === 'P2028') {
        this.logger.error(
          `Leave submission for ${employeeId} could not complete (${code}). The database connection pool is saturated.`,
        );
        throw new ServiceUnavailableException(
          'The system is busy and could not record your request. Nothing was saved — please try again in a moment.',
        );
      }
      throw error;
    }
  }

  /** Audit and notifications for a freshly created request. */
  private async announceSubmission(
    request: Prisma.LeaveRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>,
    approval: ApproverResolution,
    autoApproved: boolean,
  ): Promise<void> {
    const ctx = this.contextOf(request);

    await this.audit.record({
      actorId: request.employeeId,
      action: autoApproved ? 'leave_request.auto_approved' : 'leave_request.created',
      entityType: 'leave_request',
      entityId: request.id,
      summary: autoApproved
        ? `${ctx.employeeName} took ${ctx.days} day(s) ${ctx.leaveTypeName} (${LeaveNotifications.formatDateRange(ctx.startDate, ctx.endDate)}) — auto-approved, no approval required`
        : `${ctx.employeeName} requested ${ctx.days} day(s) ${ctx.leaveTypeName} (${LeaveNotifications.formatDateRange(ctx.startDate, ctx.endDate)}) — routed to ${approval.source.toLowerCase().replace('_', ' ')}`,
      after: { status: request.status, approverId: approval.approverId, source: approval.source },
    });

    // E. No approval needed — tell the employee, and nobody else. There is no
    // manager action to prompt.
    if (autoApproved) {
      await this.notifications.notify(
        LeaveNotifications.autoApprovedToEmployee(request.employeeId, ctx),
      );
      return;
    }

    // A. The ordinary path — tell the person who has to decide.
    if (approval.approverId) {
      await this.notifications.notify(
        LeaveNotifications.submittedToApprover(approval.approverId, ctx),
      );
      return;
    }

    // A′. Nobody to ask. The request stays PENDING; HR is told so it does not
    // sit unnoticed.
    const hr = await this.permissions.findEmployeesWithPermissionAtScope(
      'leave_request:approve',
      PermissionScope.GLOBAL,
    );

    if (hr.length === 0) {
      this.logger.warn(
        `Leave request ${request.id} has no approver and nobody holds leave_request:approve at GLOBAL scope. It will sit unactioned.`,
      );
      return;
    }

    await this.notifications.notifyMany(
      hr
        .filter((hrId) => hrId !== request.employeeId)
        .map((hrId) =>
          LeaveNotifications.unroutedToHr(
            hrId,
            ctx,
            approval.note ?? 'No approver could be found.',
          ),
        ),
    );
  }

  private contextOf(
    request: Prisma.LeaveRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>,
  ): LeaveNotifications.LeaveNotificationContext {
    return {
      requestId: request.id,
      employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
      leaveTypeName: request.leaveType.name,
      startDate: request.startDate,
      endDate: request.endDate,
      days: this.num(request.days),
      reason: request.reason,
    };
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
      include: {
        leaveType: { select: { id: true, code: true, name: true, requiresBalance: true } },
      },
    });
    if (!request) throw new NotFoundException('Leave request not found.');

    if (request.employeeId === callerEmployeeId) {
      throw new ForbiddenException('You cannot approve or reject your own leave request.');
    }

    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new ConflictException(`This request has already been ${request.status.toLowerCase()}.`);
    }

    const approval = await this.resolveApprover(request.employeeId);
    const isCurrentApprover = approval.approverId === callerEmployeeId;
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
      const balance = await this.computeBalance(request.employeeId, request.leaveType, year);
      // This request is PENDING, so its days are already inside remainingDays.
      // Adding them back gives what would remain if it were approved.
      const remainingIfApproved = balance.remainingDays + this.num(request.days);

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

    // --- after the write ------------------------------------------------------
    const ctx = this.contextOf(updated);
    const deciderName = updated.decidedBy
      ? `${updated.decidedBy.firstName} ${updated.decidedBy.lastName}`
      : 'A manager';
    const note = updated.decisionComment;

    await this.audit.record({
      actorId: callerEmployeeId,
      action:
        decision === LeaveRequestStatus.APPROVED
          ? 'leave_request.approved'
          : 'leave_request.rejected',
      entityType: 'leave_request',
      entityId: updated.id,
      summary: `${deciderName} ${decision.toLowerCase()} ${ctx.employeeName}'s ${ctx.leaveTypeName}, ${LeaveNotifications.formatDateRange(ctx.startDate, ctx.endDate)} (${ctx.days} day(s))${note ? ` — "${note}"` : ''}`,
      before: { status: LeaveRequestStatus.PENDING },
      after: { status: decision, decidedById: callerEmployeeId, comment: note },
    });

    // B / C. Tell the employee either way. A rejection carries the reason,
    // because "no" without a reason is the complaint every HR system gets.
    await this.notifications.notify(
      decision === LeaveRequestStatus.APPROVED
        ? LeaveNotifications.approvedToEmployee(updated.employeeId, ctx, deciderName, note)
        : LeaveNotifications.rejectedToEmployee(updated.employeeId, ctx, deciderName, note),
    );

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

    const wasApproved = request.status === LeaveRequestStatus.APPROVED;
    const wasAutoApproved = request.autoApproved;

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveRequestStatus.CANCELLED, cancelledAt: new Date() },
      include: REQUEST_INCLUDE,
    });

    // --- after the write ------------------------------------------------------
    const ctx = this.contextOf(updated);
    const canceller = callerEmployeeId
      ? await this.prisma.employee.findUnique({
          where: { id: callerEmployeeId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const cancelledByName = canceller
      ? `${canceller.firstName} ${canceller.lastName}`
      : ctx.employeeName;

    await this.audit.record({
      actorId: callerEmployeeId,
      action: 'leave_request.cancelled',
      entityType: 'leave_request',
      entityId: updated.id,
      summary: `${cancelledByName} withdrew ${ctx.employeeName}'s ${ctx.leaveTypeName}, ${LeaveNotifications.formatDateRange(ctx.startDate, ctx.endDate)} (${ctx.days} day(s)) — was ${wasApproved ? 'approved' : 'pending'}`,
      before: { status: wasApproved ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.PENDING },
      after: { status: LeaveRequestStatus.CANCELLED },
    });

    // D. Tell the manager — but only where manager awareness is required.
    //
    // A request that was auto-approved never involved a manager, so telling
    // one now would be noise about something they were never asked about.
    if (!wasAutoApproved) {
      const approval = await this.resolveApprover(updated.employeeId);
      if (approval.approverId && approval.approverId !== callerEmployeeId) {
        await this.notifications.notify(
          LeaveNotifications.cancelledToApprover(
            approval.approverId,
            ctx,
            wasApproved,
            cancelledByName,
          ),
        );
      }
    }

    return this.shapeRequest(updated);
  }
}
