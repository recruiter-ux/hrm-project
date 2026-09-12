import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssignmentChangeReason,
  EmploymentType,
  WorkLocationType,
  type EmploymentAssignment,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * The five fields that describe someone's employment arrangement.
 *
 * These exist in TWO places: as history rows in `employment_assignments`, and
 * as a cache of "right now" on the `employees` row. Keeping the two in step is
 * this service's entire job.
 */
export interface AssignmentFields {
  roleId: string;
  departmentId: string;
  managerId: string | null;
  employmentType: EmploymentType;
  workLocationType: WorkLocationType;
}

export interface ChangeAssignmentInput extends AssignmentFields {
  employeeId: string;
  /** First day the new arrangement applies. */
  effectiveFrom: Date;
  reason: AssignmentChangeReason;
  notes?: string | null;
  /** Employee id of whoever is recording this, for the audit trail. */
  recordedById?: string | null;
}

export interface ChangeAssignmentResult {
  changed: boolean;
  assignment: EmploymentAssignment;
}

/** Strips the time portion, in UTC, to match Postgres `date` columns. */
function toDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function previousDay(value: Date): Date {
  const result = toDateOnly(value);
  result.setUTCDate(result.getUTCDate() - 1);
  return result;
}

/**
 * =============================================================================
 * THE ONLY PLACE ALLOWED TO CHANGE SOMEONE'S JOB
 * =============================================================================
 *
 * Job title (Role), department, manager, employment type, and work location
 * must never be written directly onto the `employees` row. Doing so silently
 * destroys the career history: the person's record would say they are a Senior
 * Engineer in Mobile, while `employment_assignments` still claims they are a
 * Software Engineer in Engineering, and no report could reconcile the two.
 *
 * Every change goes through `changeAssignment`, which in ONE transaction:
 *
 *   1. closes the currently open assignment (sets its `effective_to`)
 *   2. inserts a new open assignment starting the next day
 *   3. updates the five cached fields on the employee
 *
 * All three succeed or none do. There is no partial state.
 *
 * The database backs this up: a partial unique index allows only one row per
 * employee with `effective_to IS NULL`, so even a bug that skipped step 1
 * would be rejected by Postgres rather than quietly corrupting the history.
 * =============================================================================
 */
@Injectable()
export class EmploymentAssignmentService {
  private readonly logger = new Logger(EmploymentAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The currently open assignment, or null if the employee has none. */
  async getCurrent(employeeId: string): Promise<EmploymentAssignment | null> {
    return this.prisma.employmentAssignment.findFirst({
      where: { employeeId, effectiveTo: null },
    });
  }

  /** Full career history, newest first. */
  async getHistory(employeeId: string) {
    return this.prisma.employmentAssignment.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        role: { select: { code: true, title: true, level: true } },
        department: { select: { code: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /** True if any of the five tracked fields differs from the current row. */
  private differs(current: AssignmentFields, next: AssignmentFields): boolean {
    return (
      current.roleId !== next.roleId ||
      current.departmentId !== next.departmentId ||
      current.managerId !== next.managerId ||
      current.employmentType !== next.employmentType ||
      current.workLocationType !== next.workLocationType
    );
  }

  /**
   * Records the very first assignment for a brand-new employee.
   *
   * Must be called inside the same transaction that creates the Employee row,
   * hence the `tx` parameter — an employee with no open assignment is an
   * invalid state we never want to be reachable, even momentarily.
   */
  async createInitialAssignment(
    tx: Prisma.TransactionClient,
    input: Omit<ChangeAssignmentInput, 'reason'> & { reason?: AssignmentChangeReason },
  ): Promise<EmploymentAssignment> {
    return tx.employmentAssignment.create({
      data: {
        employeeId: input.employeeId,
        roleId: input.roleId,
        departmentId: input.departmentId,
        managerId: input.managerId,
        employmentType: input.employmentType,
        workLocationType: input.workLocationType,
        effectiveFrom: toDateOnly(input.effectiveFrom),
        effectiveTo: null,
        reason: input.reason ?? AssignmentChangeReason.HIRE,
        notes: input.notes ?? null,
        recordedById: input.recordedById ?? null,
      },
    });
  }

  /**
   * Moves an employee to a new arrangement.
   *
   * Returns `changed: false` and leaves everything untouched if none of the
   * five fields actually differ — so an edit form that resubmits unchanged
   * values does not litter the history with meaningless rows.
   */
  async changeAssignment(input: ChangeAssignmentInput): Promise<ChangeAssignmentResult> {
    const effectiveFrom = toDateOnly(input.effectiveFrom);

    const current = await this.getCurrent(input.employeeId);

    if (!current) {
      throw new NotFoundException(
        `Employee ${input.employeeId} has no open employment assignment. Data is inconsistent — investigate before editing.`,
      );
    }

    if (!this.differs(current, input)) {
      return { changed: false, assignment: current };
    }

    // The new arrangement cannot start on or before the day the current one
    // began, or the closed row would end before it started.
    if (effectiveFrom <= current.effectiveFrom) {
      const currentStart = current.effectiveFrom.toISOString().slice(0, 10);
      throw new BadRequestException(
        `The effective date must be after ${currentStart}, when the current assignment began.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Close the current assignment the day before the new one starts, so
      //    the two periods sit flush against each other with no gap or overlap.
      await tx.employmentAssignment.update({
        where: { id: current.id },
        data: { effectiveTo: previousDay(effectiveFrom) },
      });

      // 2. Open the new one.
      const created = await tx.employmentAssignment.create({
        data: {
          employeeId: input.employeeId,
          roleId: input.roleId,
          departmentId: input.departmentId,
          managerId: input.managerId,
          employmentType: input.employmentType,
          workLocationType: input.workLocationType,
          effectiveFrom,
          effectiveTo: null,
          reason: input.reason,
          notes: input.notes ?? null,
          recordedById: input.recordedById ?? null,
        },
      });

      // 3. Refresh the cache on the employee so list screens stay fast.
      await tx.employee.update({
        where: { id: input.employeeId },
        data: {
          roleId: input.roleId,
          departmentId: input.departmentId,
          managerId: input.managerId,
          employmentType: input.employmentType,
          workLocationType: input.workLocationType,
        },
      });

      this.logger.log(
        `Assignment changed for employee ${input.employeeId} (${input.reason}), effective ${effectiveFrom.toISOString().slice(0, 10)}`,
      );

      return { changed: true, assignment: created };
    });
  }

  /**
   * Consistency check: finds employees whose cached fields have drifted from
   * their open assignment, or who have no open assignment at all.
   *
   * Should always return an empty list. If it does not, something wrote to the
   * employee row directly, bypassing this service.
   */
  async findDrift() {
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        employeeNumber: true,
        roleId: true,
        departmentId: true,
        managerId: true,
        employmentType: true,
        workLocationType: true,
        assignments: {
          where: { effectiveTo: null },
          select: {
            roleId: true,
            departmentId: true,
            managerId: true,
            employmentType: true,
            workLocationType: true,
          },
        },
      },
    });

    return employees
      .map((employee) => {
        const open = employee.assignments[0];
        if (!open) {
          return { employeeNumber: employee.employeeNumber, issue: 'no open assignment' };
        }
        if (
          this.differs(
            {
              roleId: open.roleId,
              departmentId: open.departmentId,
              managerId: open.managerId,
              employmentType: open.employmentType,
              workLocationType: open.workLocationType,
            },
            {
              roleId: employee.roleId ?? '',
              departmentId: employee.departmentId ?? '',
              managerId: employee.managerId,
              employmentType: employee.employmentType,
              workLocationType: employee.workLocationType,
            },
          )
        ) {
          return {
            employeeNumber: employee.employeeNumber,
            issue: 'cached fields differ from open assignment',
          };
        }
        return null;
      })
      .filter((row): row is { employeeNumber: string; issue: string } => row !== null);
  }
}
