import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProrationMethod, type LeaveTypePolicy, type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { toDateOnly } from './working-days';

/** Postgres error code for an exclusion-constraint violation. */
const PG_EXCLUSION_VIOLATION = '23P01';

export interface EntitlementBreakdownRow {
  policyId: string;
  quotaDays: number;
  from: string;
  to: string;
  daysInPeriod: number;
  /** quotaDays × daysInPeriod ÷ daysInYear */
  contribution: number;
}

export interface EntitlementResult {
  year: number;
  method: ProrationMethod;
  entitledDays: number;
  /** Shown in the UI so HR can see exactly how the number was reached. */
  breakdown: EntitlementBreakdownRow[];
}

function daysBetweenInclusive(from: Date, to: Date): number {
  const ms = toDateOnly(to).getTime() - toDateOnly(from).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * =============================================================================
 * EFFECTIVE-DATED LEAVE POLICY
 *
 * The same pattern as EmploymentAssignment, applied to policy instead of
 * people. A policy is never edited in place: changing the quota closes the
 * current version and opens a new one, so the system can always answer
 * "what was the rule on date D?".
 *
 * Overlaps are impossible — a Postgres exclusion constraint enforces it (see
 * the migration). This service checks first only so the user gets a readable
 * message instead of a raw constraint violation.
 * =============================================================================
 */
@Injectable()
export class LeavePolicyService {
  private readonly logger = new Logger(LeavePolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private num(value: Prisma.Decimal | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    return typeof value === 'number' ? value : value.toNumber();
  }

  /** Decimal columns → plain numbers, so the API speaks ordinary JSON. */
  shape(policy: LeaveTypePolicy) {
    return {
      ...policy,
      quotaDays: this.num(policy.quotaDays),
      carryForwardMaxDays:
        policy.carryForwardMaxDays === null ? null : this.num(policy.carryForwardMaxDays),
    };
  }

  /**
   * THE HISTORICAL LOOKUP.
   *
   * `getPolicyOn(annualLeaveId, '2026-03-15')` → the 8-day version
   * `getPolicyOn(annualLeaveId, '2026-08-15')` → the 6-day version
   *
   * Returns null when no policy covers that date — a leave type created today
   * has no policy for last year, and callers must handle that rather than
   * silently assuming zero.
   */
  async getPolicyOn(leaveTypeId: string, date: Date): Promise<LeaveTypePolicy | null> {
    const on = toDateOnly(date);
    return this.prisma.leaveTypePolicy.findFirst({
      where: {
        leaveTypeId,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
    });
  }

  /** Every version for a type, newest first. This is the history screen. */
  async listVersions(leaveTypeId: string) {
    const versions = await this.prisma.leaveTypePolicy.findMany({
      where: { leaveTypeId },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return versions.map((v) => ({
      ...this.shape(v),
      createdBy: v.createdBy,
      updatedBy: v.updatedBy,
    }));
  }

  /** The version in force today, if any. */
  async getCurrentPolicy(leaveTypeId: string): Promise<LeaveTypePolicy | null> {
    return this.getPolicyOn(leaveTypeId, new Date());
  }

  /**
   * Opens a new policy version, closing the one it supersedes.
   *
   * Mirrors EmploymentAssignmentService.changeAssignment: in ONE transaction
   * the open version is closed the day before the new one starts, and the new
   * version is inserted. The old row keeps its quota — nothing is rewritten,
   * so a historical lookup for March still returns March's rule.
   */
  async createVersion(
    leaveTypeId: string,
    input: {
      quotaDays: number;
      approvalRequired: boolean;
      carryForwardEnabled: boolean;
      carryForwardMaxDays?: number | null;
      minNoticeDays: number;
      effectiveFrom: Date;
      notes?: string | null;
    },
    actorEmployeeId: string | null,
  ) {
    const leaveType = await this.prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType) throw new NotFoundException('Leave type not found.');

    const effectiveFrom = toDateOnly(input.effectiveFrom);

    // The version currently open-ended, if any.
    const open = await this.prisma.leaveTypePolicy.findFirst({
      where: { leaveTypeId, effectiveTo: null },
    });

    if (open && effectiveFrom <= open.effectiveFrom) {
      throw new BadRequestException(
        `The new policy must start after ${open.effectiveFrom.toISOString().slice(0, 10)}, when the current policy began.`,
      );
    }

    // Guard against back-dating into an already-closed period. The database
    // would reject it too, but this gives a message a person can act on.
    const clash = await this.prisma.leaveTypePolicy.findFirst({
      where: {
        leaveTypeId,
        effectiveTo: { not: null, gte: effectiveFrom },
        effectiveFrom: { lte: effectiveFrom },
      },
    });
    if (clash) {
      throw new ConflictException(
        `A policy already covers ${effectiveFrom.toISOString().slice(0, 10)} (${clash.effectiveFrom.toISOString().slice(0, 10)} to ${clash.effectiveTo?.toISOString().slice(0, 10)}). Policy periods cannot overlap.`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (open) {
          const closeOn = new Date(effectiveFrom);
          closeOn.setUTCDate(closeOn.getUTCDate() - 1);
          await tx.leaveTypePolicy.update({
            where: { id: open.id },
            data: { effectiveTo: closeOn, updatedById: actorEmployeeId },
          });
        }

        const created = await tx.leaveTypePolicy.create({
          data: {
            leaveTypeId,
            quotaDays: input.quotaDays,
            approvalRequired: input.approvalRequired,
            carryForwardEnabled: input.carryForwardEnabled,
            carryForwardMaxDays: input.carryForwardMaxDays ?? null,
            minNoticeDays: input.minNoticeDays,
            effectiveFrom,
            effectiveTo: null,
            notes: input.notes ?? null,
            createdById: actorEmployeeId,
            updatedById: actorEmployeeId,
          },
        });

        this.logger.log(
          `Leave policy version created for ${leaveType.code}: ${input.quotaDays} days from ${effectiveFrom.toISOString().slice(0, 10)}`,
        );

        return this.shape(created);
      });
    } catch (error) {
      // Last line of defence: the exclusion constraint caught something the
      // checks above missed (e.g. a concurrent request).
      if ((error as { code?: string }).code === PG_EXCLUSION_VIOLATION) {
        throw new ConflictException(
          'That period overlaps an existing policy version for this leave type.',
        );
      }
      throw error;
    }
  }

  /**
   * Corrects a version in place.
   *
   * Deliberately NARROW: only `notes` and the carry-forward cap can be edited.
   * Changing a quota or a date is a new version, not an edit — otherwise
   * history would be rewritten, which is the whole thing this design prevents.
   */
  async amendVersion(
    policyId: string,
    input: { notes?: string | null; carryForwardMaxDays?: number | null },
    actorEmployeeId: string | null,
  ) {
    const existing = await this.prisma.leaveTypePolicy.findUnique({ where: { id: policyId } });
    if (!existing) throw new NotFoundException('Policy version not found.');

    const updated = await this.prisma.leaveTypePolicy.update({
      where: { id: policyId },
      data: {
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.carryForwardMaxDays !== undefined && {
          carryForwardMaxDays: input.carryForwardMaxDays,
        }),
        updatedById: actorEmployeeId,
      },
    });
    return this.shape(updated);
  }

  /**
   * =========================================================================
   * QUOTA CALCULATION — PERIOD-BASED PRORATING
   *
   * When the quota changes mid-year, each policy period contributes in
   * proportion to how much of the year it covers:
   *
   *   contribution = quotaDays × (days the policy covers in the year ÷ days in year)
   *
   * For Annual Leave in 2026 (365 days):
   *   Jan 1 – Jun 30  8 days × 181/365 = 3.97
   *   Jul 1 – Dec 31  6 days × 184/365 = 3.02
   *                                    -------
   *                                      6.99
   *
   * The alternative, LATEST_POLICY_IN_YEAR, applies the latest policy's quota
   * to the whole year — which means a mid-year cut reduces the year
   * retroactively. Chosen per leave type, so this is configuration rather
   * than a hardcoded assumption.
   *
   * NOTE ON SCOPE: this prorates by POLICY period only. It does not prorate by
   * employment — someone who joins in August still gets the full year's
   * entitlement. Use LeaveBalance.entitlementOverrideDays for those until
   * employment-based proration is built.
   * =========================================================================
   */
  async calculateEntitlement(leaveTypeId: string, year: number): Promise<EntitlementResult> {
    const leaveType = await this.prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType) throw new NotFoundException('Leave type not found.');

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const daysInYear = isLeapYear(year) ? 366 : 365;

    const policies = await this.prisma.leaveTypePolicy.findMany({
      where: {
        leaveTypeId,
        effectiveFrom: { lte: yearEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: yearStart } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });

    if (policies.length === 0) {
      return { year, method: leaveType.prorationMethod, entitledDays: 0, breakdown: [] };
    }

    const breakdown: EntitlementBreakdownRow[] = policies.map((policy) => {
      const from = policy.effectiveFrom > yearStart ? policy.effectiveFrom : yearStart;
      const policyEnd = policy.effectiveTo ?? yearEnd;
      const to = policyEnd < yearEnd ? policyEnd : yearEnd;
      const daysInPeriod = daysBetweenInclusive(from, to);
      const quotaDays = this.num(policy.quotaDays);

      return {
        policyId: policy.id,
        quotaDays,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        daysInPeriod,
        contribution: Number(((quotaDays * daysInPeriod) / daysInYear).toFixed(2)),
      };
    });

    let entitledDays: number;

    if (leaveType.prorationMethod === ProrationMethod.LATEST_POLICY_IN_YEAR) {
      // Policies are ordered ascending, so the last one is the latest to take
      // effect within the year.
      entitledDays = this.num(policies[policies.length - 1].quotaDays);
    } else {
      entitledDays = Number(
        breakdown.reduce((sum, row) => sum + row.contribution, 0).toFixed(2),
      );
    }

    return { year, method: leaveType.prorationMethod, entitledDays, breakdown };
  }
}
