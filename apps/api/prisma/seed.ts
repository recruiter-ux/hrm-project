/**
 * =============================================================================
 * Velixa HR — database seed
 *
 * Fills an empty database with a small, realistic Hazel Mobile org so that
 * screens have something to render and you can confirm the setup works.
 *
 * Run with:  npm run db:seed
 *
 * SAFE TO RE-RUN. Every write uses `upsert` (update-or-insert) keyed on a
 * stable natural key, so running it twice does not create duplicates.
 *
 * This is DEVELOPMENT data. It is not a migration and never runs in production.
 *
 * Remember the two similar-sounding concepts:
 *   Role       = job title      ("Software Engineer")
 *   AccessRole = permission set ("HR Administrator")
 * =============================================================================
 */
import {
  AssignmentChangeReason,
  EmploymentType,
  PermissionScope,
  PrismaClient,
  WorkLocationType,
} from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Password given to every seeded account.
 *
 * DEVELOPMENT ONLY. This seed must never run against a real database — see
 * the guard in main() below, which refuses to run when NODE_ENV=production.
 */
const SEED_PASSWORD = 'Password123!';

// -----------------------------------------------------------------------------
// 1. PERMISSIONS
//
// Every permission is a resource + action pair. Each future module appends its
// own block here (leave:*, attendance:*, payroll:*) so there is one place to
// see everything the system can authorise.
// -----------------------------------------------------------------------------
const PERMISSIONS: Array<{
  resource: string;
  action: string;
  module: string;
  description: string;
}> = [
  { resource: 'employee', action: 'read', module: 'core_hr', description: 'View employee records' },
  { resource: 'employee', action: 'create', module: 'core_hr', description: 'Add new employees' },
  {
    resource: 'employee',
    action: 'update',
    module: 'core_hr',
    description: 'Edit employee records',
  },
  {
    resource: 'employee',
    action: 'delete',
    module: 'core_hr',
    description: 'Archive employee records',
  },
  {
    resource: 'employment_assignment',
    action: 'read',
    module: 'core_hr',
    description: 'View employment and career history',
  },
  {
    resource: 'employment_assignment',
    action: 'create',
    module: 'core_hr',
    description: 'Record promotions, transfers, and other job changes',
  },
  { resource: 'department', action: 'read', module: 'core_hr', description: 'View departments' },
  {
    resource: 'department',
    action: 'manage',
    module: 'core_hr',
    description: 'Create and edit departments',
  },
  { resource: 'role', action: 'read', module: 'core_hr', description: 'View job titles' },
  {
    resource: 'role',
    action: 'manage',
    module: 'core_hr',
    description: 'Create and edit job titles',
  },
  {
    resource: 'document',
    action: 'read',
    module: 'core_hr',
    description: 'View employee documents',
  },
  { resource: 'document', action: 'upload', module: 'core_hr', description: 'Upload documents' },
  {
    resource: 'document',
    action: 'read_confidential',
    module: 'core_hr',
    description: 'View documents marked confidential',
  },
  {
    resource: 'access_role',
    action: 'read',
    module: 'core_hr',
    description: 'View access roles and their permissions',
  },
  {
    resource: 'access_role',
    action: 'manage',
    module: 'core_hr',
    description: 'Grant access roles and edit permissions',
  },
];

// -----------------------------------------------------------------------------
// 2. ACCESS ROLES — what people may DO in the software.
//
// `scope` is what makes one permission mean different things to different
// access roles. A manager and an HR admin both hold `employee:read` — the
// manager sees their direct reports, HR sees everyone.
// -----------------------------------------------------------------------------
const ACCESS_ROLES: Array<{
  key: string;
  name: string;
  description: string;
  grants: Array<{ permission: string; scope: PermissionScope }>;
}> = [
  {
    key: 'super_admin',
    name: 'Super Administrator',
    description: 'Unrestricted access. Reserved for platform maintainers.',
    grants: PERMISSIONS.map((p) => ({
      permission: `${p.resource}:${p.action}`,
      scope: PermissionScope.GLOBAL,
    })),
  },
  {
    key: 'hr_admin',
    name: 'HR Administrator',
    description: 'Full access to people data across the company.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.GLOBAL },
      { permission: 'employee:create', scope: PermissionScope.GLOBAL },
      { permission: 'employee:update', scope: PermissionScope.GLOBAL },
      { permission: 'employee:delete', scope: PermissionScope.GLOBAL },
      { permission: 'employment_assignment:read', scope: PermissionScope.GLOBAL },
      { permission: 'employment_assignment:create', scope: PermissionScope.GLOBAL },
      { permission: 'department:read', scope: PermissionScope.GLOBAL },
      { permission: 'department:manage', scope: PermissionScope.GLOBAL },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
      { permission: 'role:manage', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:upload', scope: PermissionScope.GLOBAL },
      { permission: 'document:read_confidential', scope: PermissionScope.GLOBAL },
      { permission: 'access_role:read', scope: PermissionScope.GLOBAL },
    ],
  },
  {
    key: 'department_head',
    name: 'Department Head',
    description: 'Manages an entire department, including nested sub-departments.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'employee:update', scope: PermissionScope.DEPARTMENT },
      { permission: 'employment_assignment:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'department:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.DEPARTMENT },
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Manages direct reports. Will approve leave and attendance exceptions.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.TEAM },
      { permission: 'employment_assignment:read', scope: PermissionScope.TEAM },
      { permission: 'department:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.TEAM },
    ],
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Hiring access. Expands considerably when the ATS module lands.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.GLOBAL },
      { permission: 'department:read', scope: PermissionScope.GLOBAL },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
    ],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Baseline access held by everyone. Self-service only.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.SELF },
      { permission: 'employment_assignment:read', scope: PermissionScope.SELF },
      { permission: 'department:read', scope: PermissionScope.GLOBAL },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.SELF },
      { permission: 'document:upload', scope: PermissionScope.SELF },
    ],
  },
];

// -----------------------------------------------------------------------------
// 3. ROLES — job titles. What people are employed to DO.
//
// `level` is a plain number (1 = most junior) rather than an enum, so the
// company can re-map its levelling without a database migration.
// -----------------------------------------------------------------------------
const JOB_TITLES: Array<{
  code: string;
  title: string;
  jobFamily: string;
  level: number;
  description: string;
}> = [
  {
    code: 'CEO',
    title: 'Chief Executive Officer',
    jobFamily: 'Leadership',
    level: 10,
    description: 'Sets company direction and is accountable to the board.',
  },
  {
    code: 'VP_ENG',
    title: 'VP of Engineering',
    jobFamily: 'Engineering',
    level: 8,
    description: 'Owns engineering strategy, delivery, and hiring.',
  },
  {
    code: 'HEAD_PEOPLE',
    title: 'Head of People',
    jobFamily: 'People',
    level: 8,
    description: 'Owns HR, recruitment, and internal operations.',
  },
  {
    code: 'ENG_LEAD',
    title: 'Engineering Lead',
    jobFamily: 'Engineering',
    level: 6,
    description: 'Leads a delivery team; part hands-on, part people management.',
  },
  {
    code: 'SR_SWE',
    title: 'Senior Software Engineer',
    jobFamily: 'Engineering',
    level: 5,
    description: 'Delivers complex work independently and mentors others.',
  },
  {
    code: 'SWE',
    title: 'Software Engineer',
    jobFamily: 'Engineering',
    level: 4,
    description: 'Delivers well-defined work with review.',
  },
  {
    code: 'AI_ENG',
    title: 'AI Engineer',
    jobFamily: 'Engineering',
    level: 4,
    description: 'Builds and evaluates applied ML and LLM features.',
  },
  {
    code: 'PRODUCT_DESIGNER',
    title: 'Product Designer',
    jobFamily: 'Design',
    level: 4,
    description: 'Owns product interaction and visual design.',
  },
  {
    code: 'RECRUITER',
    title: 'Recruiter',
    jobFamily: 'People',
    level: 4,
    description: 'Runs hiring pipelines end to end.',
  },
];

// -----------------------------------------------------------------------------
// 4. DEPARTMENTS — `parent` refers to another department's `code`.
// -----------------------------------------------------------------------------
const DEPARTMENTS: Array<{
  code: string;
  name: string;
  parent?: string;
  description: string;
}> = [
  { code: 'EXEC', name: 'Leadership', description: 'Executive team' },
  { code: 'ENG', name: 'Engineering', description: 'All engineering functions' },
  { code: 'ENG-MOB', name: 'Mobile Engineering', parent: 'ENG', description: 'iOS and Android' },
  { code: 'ENG-AI', name: 'AI Engineering', parent: 'ENG', description: 'Applied AI and ML' },
  { code: 'DESIGN', name: 'Product Design', description: 'Product and brand design' },
  { code: 'PEOPLE', name: 'People & Culture', description: 'HR, hiring, and operations' },
];

// -----------------------------------------------------------------------------
// 5. EMPLOYEES, each with their full employment history.
//
// The entry with `to: null` is the CURRENT arrangement — exactly one per
// person — and is what gets cached onto the Employee row.
//
// The sample history deliberately covers three kinds of change so you can see
// the table working: a promotion, a department move, and an intern converting
// to full-time.
//
// Ordered so that every manager is created before their reports.
// -----------------------------------------------------------------------------
interface HistoryEntry {
  role: string; // Role.code
  department: string; // Department.code
  manager: string | null; // Employee.employeeNumber
  employmentType: EmploymentType;
  workLocationType: WorkLocationType;
  from: string;
  to: string | null;
  reason: AssignmentChangeReason;
  notes?: string;
}

const EMPLOYEES: Array<{
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  hiredAt: string;
  accessRoles: string[];
  headOf?: string;
  history: HistoryEntry[];
}> = [
  {
    employeeNumber: 'HM-0001',
    firstName: 'Ayesha',
    lastName: 'Rahman',
    workEmail: 'ayesha.rahman@hazelmobile.com',
    hiredAt: '2019-03-01',
    accessRoles: ['super_admin', 'employee'],
    headOf: 'EXEC',
    history: [
      {
        role: 'CEO',
        department: 'EXEC',
        manager: null,
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.ONSITE,
        from: '2019-03-01',
        to: null,
        reason: AssignmentChangeReason.HIRE,
        notes: 'Founder.',
      },
    ],
  },
  {
    employeeNumber: 'HM-0002',
    firstName: 'Bilal',
    lastName: 'Khan',
    workEmail: 'bilal.khan@hazelmobile.com',
    hiredAt: '2020-06-15',
    accessRoles: ['department_head', 'manager', 'employee'],
    headOf: 'ENG',
    history: [
      {
        role: 'ENG_LEAD',
        department: 'ENG',
        manager: 'HM-0001',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.ONSITE,
        from: '2020-06-15',
        to: '2021-12-31',
        reason: AssignmentChangeReason.HIRE,
      },
      {
        role: 'VP_ENG',
        department: 'ENG',
        manager: 'HM-0001',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.HYBRID,
        from: '2022-01-01',
        to: null,
        reason: AssignmentChangeReason.PROMOTION,
        notes: 'Promoted to VP as the engineering org grew past 15 people.',
      },
    ],
  },
  {
    employeeNumber: 'HM-0003',
    firstName: 'Sana',
    lastName: 'Iqbal',
    workEmail: 'sana.iqbal@hazelmobile.com',
    hiredAt: '2021-01-11',
    accessRoles: ['hr_admin', 'department_head', 'employee'],
    headOf: 'PEOPLE',
    history: [
      {
        role: 'HEAD_PEOPLE',
        department: 'PEOPLE',
        manager: 'HM-0001',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.ONSITE,
        from: '2021-01-11',
        to: null,
        reason: AssignmentChangeReason.HIRE,
      },
    ],
  },
  {
    employeeNumber: 'HM-0004',
    firstName: 'Omar',
    lastName: 'Farooq',
    workEmail: 'omar.farooq@hazelmobile.com',
    hiredAt: '2021-09-06',
    accessRoles: ['manager', 'employee'],
    headOf: 'ENG-MOB',
    history: [
      {
        role: 'SR_SWE',
        department: 'ENG',
        manager: 'HM-0002',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.ONSITE,
        from: '2021-09-06',
        to: '2023-03-31',
        reason: AssignmentChangeReason.HIRE,
      },
      {
        role: 'ENG_LEAD',
        department: 'ENG-MOB',
        manager: 'HM-0002',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.HYBRID,
        from: '2023-04-01',
        to: null,
        reason: AssignmentChangeReason.PROMOTION,
        notes: 'Promoted to lead the newly formed Mobile Engineering team.',
      },
    ],
  },
  {
    employeeNumber: 'HM-0005',
    firstName: 'Zara',
    lastName: 'Ahmed',
    workEmail: 'zara.ahmed@hazelmobile.com',
    hiredAt: '2022-04-18',
    accessRoles: ['employee'],
    history: [
      {
        role: 'SWE',
        department: 'ENG',
        manager: 'HM-0002',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.ONSITE,
        from: '2022-04-18',
        to: '2023-03-31',
        reason: AssignmentChangeReason.HIRE,
      },
      {
        role: 'SWE',
        department: 'ENG-MOB',
        manager: 'HM-0004',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.REMOTE,
        from: '2023-04-01',
        to: '2023-12-31',
        reason: AssignmentChangeReason.REORGANISATION,
        notes: 'Moved into Mobile Engineering when the team was split out.',
      },
      {
        role: 'SR_SWE',
        department: 'ENG-MOB',
        manager: 'HM-0004',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.REMOTE,
        from: '2024-01-01',
        to: null,
        reason: AssignmentChangeReason.PROMOTION,
      },
    ],
  },
  {
    employeeNumber: 'HM-0006',
    firstName: 'Hassan',
    lastName: 'Malik',
    workEmail: 'hassan.malik@hazelmobile.com',
    hiredAt: '2023-02-27',
    accessRoles: ['employee'],
    history: [
      {
        role: 'AI_ENG',
        department: 'ENG-AI',
        manager: 'HM-0002',
        employmentType: EmploymentType.INTERN,
        workLocationType: WorkLocationType.ONSITE,
        from: '2023-02-27',
        to: '2023-08-31',
        reason: AssignmentChangeReason.HIRE,
        notes: 'Six-month internship.',
      },
      {
        role: 'AI_ENG',
        department: 'ENG-AI',
        manager: 'HM-0002',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.REMOTE,
        from: '2023-09-01',
        to: null,
        reason: AssignmentChangeReason.EMPLOYMENT_TYPE_CHANGE,
        notes: 'Converted from intern to full-time.',
      },
    ],
  },
  {
    employeeNumber: 'HM-0007',
    firstName: 'Fatima',
    lastName: 'Sheikh',
    workEmail: 'fatima.sheikh@hazelmobile.com',
    hiredAt: '2024-07-08',
    accessRoles: ['employee'],
    history: [
      {
        role: 'PRODUCT_DESIGNER',
        department: 'DESIGN',
        manager: 'HM-0001',
        employmentType: EmploymentType.FULL_TIME,
        workLocationType: WorkLocationType.HYBRID,
        from: '2024-07-08',
        to: null,
        reason: AssignmentChangeReason.HIRE,
      },
    ],
  },
];

async function main(): Promise<void> {
  // Hard stop. This seed writes known passwords and would be catastrophic
  // against real employee data.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The seed script must never run with NODE_ENV=production.');
  }

  console.log('Seeding Velixa HR development data...\n');

  // --- Permissions -----------------------------------------------------------
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: p.resource, action: p.action } },
      update: { description: p.description, module: p.module },
      create: {
        resource: p.resource,
        action: p.action,
        key: `${p.resource}:${p.action}`,
        module: p.module,
        description: p.description,
      },
    });
  }
  console.log(`  Permissions  : ${PERMISSIONS.length}`);

  // --- Access roles + their permission grants --------------------------------
  for (const accessRole of ACCESS_ROLES) {
    const created = await prisma.accessRole.upsert({
      where: { key: accessRole.key },
      update: { name: accessRole.name, description: accessRole.description, isSystem: true },
      create: {
        key: accessRole.key,
        name: accessRole.name,
        description: accessRole.description,
        isSystem: true,
      },
    });

    for (const grant of accessRole.grants) {
      const permission = await prisma.permission.findUnique({ where: { key: grant.permission } });
      if (!permission) {
        throw new Error(
          `Access role "${accessRole.key}" references unknown permission "${grant.permission}".`,
        );
      }

      await prisma.accessRolePermission.upsert({
        where: {
          accessRoleId_permissionId: { accessRoleId: created.id, permissionId: permission.id },
        },
        update: { scope: grant.scope },
        create: { accessRoleId: created.id, permissionId: permission.id, scope: grant.scope },
      });
    }
  }
  console.log(`  Access roles : ${ACCESS_ROLES.length}`);

  // --- Job titles ------------------------------------------------------------
  for (const job of JOB_TITLES) {
    await prisma.role.upsert({
      where: { code: job.code },
      update: {
        title: job.title,
        jobFamily: job.jobFamily,
        level: job.level,
        description: job.description,
      },
      create: {
        code: job.code,
        title: job.title,
        jobFamily: job.jobFamily,
        level: job.level,
        description: job.description,
      },
    });
  }
  console.log(`  Job titles   : ${JOB_TITLES.length}`);

  // --- Departments (parents first, so children can point at them) ------------
  for (const dept of DEPARTMENTS.filter((d) => !d.parent)) {
    await prisma.department.upsert({
      where: { code: dept.code },
      update: { name: dept.name, description: dept.description },
      create: { code: dept.code, name: dept.name, description: dept.description },
    });
  }
  for (const dept of DEPARTMENTS.filter((d) => d.parent)) {
    const parent = await prisma.department.findUnique({ where: { code: dept.parent as string } });
    await prisma.department.upsert({
      where: { code: dept.code },
      update: { name: dept.name, description: dept.description, parentId: parent?.id },
      create: {
        code: dept.code,
        name: dept.name,
        description: dept.description,
        parentId: parent?.id,
      },
    });
  }
  console.log(`  Departments  : ${DEPARTMENTS.length}`);

  // --- Employees -------------------------------------------------------------
  // Pass 1: the employee rows themselves, carrying the CURRENT arrangement.
  for (const emp of EMPLOYEES) {
    const current = emp.history.find((h) => h.to === null);
    if (!current) {
      throw new Error(
        `Employee ${emp.employeeNumber} has no current assignment (none with to: null).`,
      );
    }

    const role = await prisma.role.findUnique({ where: { code: current.role } });
    const department = await prisma.department.findUnique({ where: { code: current.department } });
    const manager = current.manager
      ? await prisma.employee.findUnique({ where: { employeeNumber: current.manager } })
      : null;

    const data = {
      firstName: emp.firstName,
      lastName: emp.lastName,
      workEmail: emp.workEmail,
      status: 'ACTIVE' as const,
      hiredAt: new Date(emp.hiredAt),
      roleId: role?.id ?? null,
      departmentId: department?.id ?? null,
      managerId: manager?.id ?? null,
      employmentType: current.employmentType,
      workLocationType: current.workLocationType,
    };

    await prisma.employee.upsert({
      where: { employeeNumber: emp.employeeNumber },
      update: data,
      create: { employeeNumber: emp.employeeNumber, ...data },
    });
  }
  console.log(`  Employees    : ${EMPLOYEES.length}`);

  // Pass 2: the full history. Done after every employee exists, because an
  // assignment can reference any other employee as the manager.
  let assignmentCount = 0;
  for (const emp of EMPLOYEES) {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { employeeNumber: emp.employeeNumber },
    });

    for (const entry of emp.history) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: entry.role } });
      const department = await prisma.department.findUniqueOrThrow({
        where: { code: entry.department },
      });
      const manager = entry.manager
        ? await prisma.employee.findUnique({ where: { employeeNumber: entry.manager } })
        : null;

      const effectiveFrom = new Date(entry.from);

      const data = {
        roleId: role.id,
        departmentId: department.id,
        managerId: manager?.id ?? null,
        employmentType: entry.employmentType,
        workLocationType: entry.workLocationType,
        effectiveTo: entry.to ? new Date(entry.to) : null,
        reason: entry.reason,
        notes: entry.notes ?? null,
      };

      await prisma.employmentAssignment.upsert({
        where: {
          employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom },
        },
        update: data,
        create: { employeeId: employee.id, effectiveFrom, ...data },
      });
      assignmentCount += 1;
    }
  }
  console.log(`  Assignments  : ${assignmentCount}`);

  // --- Access role grants ----------------------------------------------------
  for (const emp of EMPLOYEES) {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { employeeNumber: emp.employeeNumber },
    });

    for (const key of emp.accessRoles) {
      const accessRole = await prisma.accessRole.findUnique({ where: { key } });
      if (!accessRole) {
        throw new Error(`Employee ${emp.employeeNumber} references unknown access role "${key}".`);
      }

      await prisma.employeeAccessRole.upsert({
        where: {
          employeeId_accessRoleId: { employeeId: employee.id, accessRoleId: accessRole.id },
        },
        update: {},
        create: { employeeId: employee.id, accessRoleId: accessRole.id },
      });
    }
  }

  // --- Department heads (done last: employees must exist first) --------------
  for (const emp of EMPLOYEES.filter((e) => e.headOf)) {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { employeeNumber: emp.employeeNumber },
    });

    await prisma.department.update({
      where: { code: emp.headOf as string },
      data: { headEmployeeId: employee.id },
    });
  }

  // --- Login accounts --------------------------------------------------------
  // Everyone in EMPLOYEES gets an account with the same development password,
  // so you can sign in as each AccessRole and see permission scoping in action.
  const passwordHash = await hash(SEED_PASSWORD, 12);

  for (const emp of EMPLOYEES) {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { employeeNumber: emp.employeeNumber },
    });

    await prisma.user.upsert({
      where: { email: emp.workEmail },
      // Password is reset on every seed run so a forgotten local password is
      // never a problem. Safe precisely because this is development-only data.
      update: { passwordHash, employeeId: employee.id, isActive: true },
      create: { email: emp.workEmail, passwordHash, employeeId: employee.id },
    });
  }
  console.log(`  Login users  : ${EMPLOYEES.length}`);

  console.log('\nSeed complete.');
  console.log('Inspect the data visually with:  npm run prisma:studio');
  console.log('Try the "employment_assignments" table to see career history.\n');

  console.log('Sign in at http://localhost:3000 with any of these:');
  console.log(`  (password for all: ${SEED_PASSWORD})\n`);
  const widest = Math.max(...EMPLOYEES.map((e) => e.workEmail.length));
  for (const emp of EMPLOYEES) {
    console.log(`  ${emp.workEmail.padEnd(widest)}  ${emp.accessRoles.join(', ')}`);
  }
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
