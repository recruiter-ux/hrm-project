import {
  AssignmentChangeReason,
  EmploymentType,
  PermissionScope,
  PrismaClient,
  WorkLocationType,
  type EmploymentStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';

import { ACCESS_ROLES, LEAVE_TYPES, PERMISSIONS } from '../prisma/seed-data';

/**
 * =============================================================================
 * THE WORLD EVERY INTEGRATION TEST RUNS AGAINST
 *
 * A small Hazel Mobile, rebuilt from scratch before each test file so no test
 * can be affected by what another one left behind. (That was a real problem
 * during manual verification: leftover leave requests made a balance read 1.99
 * and produced a string of misleading failures.)
 *
 * PERMISSIONS AND ACCESS ROLES ARE IMPORTED FROM prisma/seed-data.ts, not
 * redeclared here. A permission test is only worth running if it tests the
 * scopes the product actually ships with.
 *
 * The cast of six is chosen so every approval edge case has somebody in it:
 *
 *   sana     HR Administrator      GLOBAL everything
 *   omar     Manager               TEAM — manages zara and hassan
 *   zara     Employee              SELF — the ordinary person
 *   hassan   Employee              SELF — proves "one manager, two reports"
 *   bilal    Manager               TEAM — manages nobody in these tests, so he
 *                                  is the outsider who must NOT be able to
 *                                  approve zara's leave
 *   nadia    Employee              SELF — no manager, no department head, so
 *                                  her requests cannot be routed anywhere
 * =============================================================================
 */

export const TEST_PASSWORD = 'TestPassword123!';

export interface TestWorld {
  employees: {
    sana: string;
    omar: string;
    zara: string;
    hassan: string;
    bilal: string;
    nadia: string;
  };
  emails: Record<keyof TestWorld['employees'], string>;
  leaveTypes: { annual: string; sick: string; casual: string; unpaid: string };
  departments: { engineering: string; mobile: string; people: string };
  year: number;
}

/**
 * Empties every table.
 *
 * Order matters: children before parents, or a foreign key refuses. TRUNCATE
 * … CASCADE in one statement is both faster and immune to that ordering, which
 * is why it is one raw statement rather than a series of deleteMany calls.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      notification_deliveries, notifications, audit_logs,
      leave_requests, leave_balances, leave_type_policies, leave_types,
      refresh_tokens, users,
      documents, employee_access_roles, access_role_permissions,
      employment_assignments, permissions, access_roles,
      employees, departments, roles
    RESTART IDENTITY CASCADE
  `);
}

export async function buildWorld(prisma: PrismaClient): Promise<TestWorld> {
  await resetDatabase(prisma);

  const year = new Date().getUTCFullYear();
  const passwordHash = await hash(TEST_PASSWORD, 4); // low cost: speed over strength in tests

  // --- Permissions and access roles, straight from the shipped config -------
  for (const p of PERMISSIONS) {
    await prisma.permission.create({
      data: {
        key: `${p.resource}:${p.action}`,
        resource: p.resource,
        action: p.action,
        module: p.module,
        description: p.description,
      },
    });
  }

  for (const role of ACCESS_ROLES) {
    const created = await prisma.accessRole.create({
      data: { key: role.key, name: role.name, description: role.description },
    });
    for (const grant of role.grants) {
      const permission = await prisma.permission.findUnique({ where: { key: grant.permission } });
      if (!permission) throw new Error(`Seed data grants unknown permission ${grant.permission}`);
      await prisma.accessRolePermission.create({
        data: { accessRoleId: created.id, permissionId: permission.id, scope: grant.scope },
      });
    }
  }

  // --- Org structure ---------------------------------------------------------
  const engineering = await prisma.department.create({
    data: { code: 'ENG', name: 'Engineering' },
  });
  const mobile = await prisma.department.create({
    data: { code: 'MOB', name: 'Mobile Engineering', parentId: engineering.id },
  });
  // Deliberately headless. Nadia sits here with no manager either, which is
  // the only way to reach the "nobody can approve this" branch — an
  // EmploymentAssignment requires a department, so "no department at all" is
  // not a state the schema allows.
  const people = await prisma.department.create({
    data: { code: 'PPL', name: 'People Operations' },
  });
  const jobRole = await prisma.role.create({
    data: { code: 'SWE', title: 'Software Engineer', jobFamily: 'Engineering', level: 2 },
  });

  let counter = 1;
  async function addEmployee(input: {
    firstName: string;
    lastName: string;
    accessRoleKey: string;
    departmentId: string;
    status?: EmploymentStatus;
  }) {
    const employeeNumber = `HM-${String(counter++).padStart(4, '0')}`;
    const workEmail = `${input.firstName.toLowerCase()}.${input.lastName.toLowerCase()}@hazelmobile.test`;

    const employee = await prisma.employee.create({
      data: {
        employeeNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        workEmail,
        hiredAt: new Date(Date.UTC(year - 3, 0, 15)),
        status: input.status ?? 'ACTIVE',
        roleId: jobRole.id,
        departmentId: input.departmentId,
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.HYBRID,
      },
    });

    await prisma.user.create({
      data: { email: workEmail, passwordHash, employeeId: employee.id, isActive: true },
    });

    const accessRole = await prisma.accessRole.findUnique({ where: { key: input.accessRoleKey } });
    if (!accessRole) throw new Error(`No access role ${input.accessRoleKey}`);
    await prisma.employeeAccessRole.create({
      data: { employeeId: employee.id, accessRoleId: accessRole.id },
    });

    return { id: employee.id, workEmail };
  }

  const sana = await addEmployee({
    firstName: 'Sana',
    lastName: 'Iqbal',
    accessRoleKey: 'hr_admin',
    departmentId: people.id,
  });
  const omar = await addEmployee({
    firstName: 'Omar',
    lastName: 'Farooq',
    accessRoleKey: 'manager',
    departmentId: mobile.id,
  });
  const bilal = await addEmployee({
    firstName: 'Bilal',
    lastName: 'Khan',
    accessRoleKey: 'manager',
    departmentId: engineering.id,
  });
  const zara = await addEmployee({
    firstName: 'Zara',
    lastName: 'Ahmed',
    accessRoleKey: 'employee',
    departmentId: mobile.id,
  });
  const hassan = await addEmployee({
    firstName: 'Hassan',
    lastName: 'Raza',
    accessRoleKey: 'employee',
    departmentId: mobile.id,
  });
  // No manager, and her department has no head — so nothing can be routed for
  // her. This is the "unroutable" case, which must escalate to HR rather than
  // silently approving itself.
  const nadia = await addEmployee({
    firstName: 'Nadia',
    lastName: 'Sheikh',
    accessRoleKey: 'employee',
    departmentId: people.id,
  });

  // --- Reporting lines -------------------------------------------------------
  // ⚠️ Written to BOTH the open EmploymentAssignment and the cached fields on
  // Employee, exactly as EmploymentAssignmentService does. Approver resolution
  // reads the assignment; the permission scope filter reads the cache. A
  // fixture that set only one of them would make half the tests meaningless.
  async function assign(employeeId: string, managerId: string | null, departmentId: string) {
    await prisma.employmentAssignment.create({
      data: {
        employeeId,
        roleId: jobRole.id,
        departmentId,
        managerId,
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.HYBRID,
        effectiveFrom: new Date(Date.UTC(year - 3, 0, 15)),
        effectiveTo: null,
        reason: AssignmentChangeReason.HIRE,
      },
    });
    await prisma.employee.update({ where: { id: employeeId }, data: { managerId, departmentId } });
  }

  await assign(sana.id, null, people.id);
  await assign(bilal.id, null, engineering.id);
  await assign(omar.id, bilal.id, mobile.id);
  await assign(zara.id, omar.id, mobile.id);
  await assign(hassan.id, omar.id, mobile.id);
  await assign(nadia.id, null, people.id);

  // --- Leave types, from the same configuration the seed uses ----------------
  const leaveTypeIds: Record<string, string> = {};
  for (const type of LEAVE_TYPES) {
    const created = await prisma.leaveType.create({
      data: {
        code: type.code,
        name: type.name,
        description: type.description,
        isPaid: type.isPaid,
        requiresBalance: type.requiresBalance,
      },
    });
    await prisma.leaveTypePolicy.create({
      data: {
        leaveTypeId: created.id,
        quotaDays: type.policy.quotaDays,
        approvalRequired: type.policy.approvalRequired,
        carryForwardEnabled: type.policy.carryForwardEnabled,
        carryForwardMaxDays: type.policy.carryForwardMaxDays,
        minNoticeDays: type.policy.minNoticeDays,
        effectiveFrom: new Date(Date.UTC(year, 0, 1)),
        effectiveTo: null,
        notes: 'Initial policy.',
      },
    });
    leaveTypeIds[type.code] = created.id;
  }

  return {
    employees: {
      sana: sana.id,
      omar: omar.id,
      zara: zara.id,
      hassan: hassan.id,
      bilal: bilal.id,
      nadia: nadia.id,
    },
    emails: {
      sana: sana.workEmail,
      omar: omar.workEmail,
      zara: zara.workEmail,
      hassan: hassan.workEmail,
      bilal: bilal.workEmail,
      nadia: nadia.workEmail,
    },
    leaveTypes: {
      annual: leaveTypeIds.ANNUAL,
      sick: leaveTypeIds.SICK,
      casual: leaveTypeIds.CASUAL,
      unpaid: leaveTypeIds.UNPAID,
    },
    departments: { engineering: engineering.id, mobile: mobile.id, people: people.id },
    year,
  };
}

// -----------------------------------------------------------------------------
// Date helpers
//
// Leave validation depends on today (minimum notice, "has this leave started
// yet"). Hard-coded dates would make the suite pass in September and fail in
// December, so every test date is expressed relative to now — and snapped to a
// weekday, because a request that lands entirely on a Saturday is correctly
// rejected for having no working days in it.
// -----------------------------------------------------------------------------

/** `YYYY-MM-DD`, `offsetDays` from today, moved forward off a weekend. */
export function weekdayFromNow(offsetDays: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * A run of `count` consecutive working days starting at least `offsetDays`
 * away — returned as the { startDate, endDate } a request needs.
 *
 * Kept inside the current calendar year so the balance it draws on is the one
 * the test set up. A request spanning New Year is attributed entirely to the
 * start date's year, which is correct but would make assertions confusing.
 */
export function workingDayRange(
  offsetDays: number,
  count: number,
): { startDate: string; endDate: string } {
  const start = new Date(`${weekdayFromNow(offsetDays)}T00:00:00.000Z`);
  const cursor = new Date(start);
  let counted = 1;
  while (counted < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) counted += 1;
  }
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: cursor.toISOString().slice(0, 10),
  };
}
