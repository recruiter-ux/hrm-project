/**
 * =============================================================================
 * [PROJECT_NAME] — database seed
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
 * =============================================================================
 */
import { PermissionScope, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
  { resource: 'employee', action: 'update', module: 'core_hr', description: 'Edit employee records' },
  {
    resource: 'employee',
    action: 'delete',
    module: 'core_hr',
    description: 'Archive employee records',
  },
  { resource: 'department', action: 'read', module: 'core_hr', description: 'View departments' },
  {
    resource: 'department',
    action: 'manage',
    module: 'core_hr',
    description: 'Create and edit departments',
  },
  { resource: 'document', action: 'read', module: 'core_hr', description: 'View employee documents' },
  { resource: 'document', action: 'upload', module: 'core_hr', description: 'Upload documents' },
  {
    resource: 'document',
    action: 'read_confidential',
    module: 'core_hr',
    description: 'View documents marked confidential',
  },
  { resource: 'role', action: 'read', module: 'core_hr', description: 'View access roles' },
  {
    resource: 'role',
    action: 'manage',
    module: 'core_hr',
    description: 'Create roles and assign permissions',
  },
];

// -----------------------------------------------------------------------------
// 2. ROLES
//
// `scope` is what makes one permission mean different things to different
// roles. A manager and an HR admin both hold `employee:read` — the manager
// sees their direct reports, HR sees everyone.
// -----------------------------------------------------------------------------
const ROLES: Array<{
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
      { permission: 'department:read', scope: PermissionScope.GLOBAL },
      { permission: 'department:manage', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:upload', scope: PermissionScope.GLOBAL },
      { permission: 'document:read_confidential', scope: PermissionScope.GLOBAL },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
    ],
  },
  {
    key: 'department_head',
    name: 'Department Head',
    description: 'Manages an entire department, including nested sub-departments.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'employee:update', scope: PermissionScope.DEPARTMENT },
      { permission: 'department:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'document:read', scope: PermissionScope.DEPARTMENT },
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Manages direct reports. Will approve leave and attendance exceptions.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.TEAM },
      { permission: 'department:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'document:read', scope: PermissionScope.TEAM },
    ],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Baseline role held by everyone. Self-service access only.',
    grants: [
      { permission: 'employee:read', scope: PermissionScope.SELF },
      { permission: 'department:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.SELF },
      { permission: 'document:upload', scope: PermissionScope.SELF },
    ],
  },
];

// -----------------------------------------------------------------------------
// 3. DEPARTMENTS — `parent` refers to another department's `code`.
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
// 4. EMPLOYEES — `manager` refers to another employee's `employeeNumber`.
//    Ordered so that every manager is created before their reports.
// -----------------------------------------------------------------------------
const EMPLOYEES: Array<{
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  jobTitle: string;
  department: string;
  manager?: string;
  hiredAt: string;
  roles: string[];
  headOf?: string;
  workLocationType?: 'ONSITE' | 'REMOTE' | 'HYBRID';
}> = [
  {
    employeeNumber: 'HM-0001',
    firstName: 'Ayesha',
    lastName: 'Rahman',
    workEmail: 'ayesha.rahman@hazelmobile.com',
    jobTitle: 'Chief Executive Officer',
    department: 'EXEC',
    hiredAt: '2019-03-01',
    roles: ['super_admin', 'employee'],
    headOf: 'EXEC',
  },
  {
    employeeNumber: 'HM-0002',
    firstName: 'Bilal',
    lastName: 'Khan',
    workEmail: 'bilal.khan@hazelmobile.com',
    jobTitle: 'VP of Engineering',
    department: 'ENG',
    manager: 'HM-0001',
    hiredAt: '2020-06-15',
    roles: ['department_head', 'manager', 'employee'],
    headOf: 'ENG',
    workLocationType: 'HYBRID',
  },
  {
    employeeNumber: 'HM-0003',
    firstName: 'Sana',
    lastName: 'Iqbal',
    workEmail: 'sana.iqbal@hazelmobile.com',
    jobTitle: 'Head of People',
    department: 'PEOPLE',
    manager: 'HM-0001',
    hiredAt: '2021-01-11',
    roles: ['hr_admin', 'department_head', 'employee'],
    headOf: 'PEOPLE',
  },
  {
    employeeNumber: 'HM-0004',
    firstName: 'Omar',
    lastName: 'Farooq',
    workEmail: 'omar.farooq@hazelmobile.com',
    jobTitle: 'Mobile Engineering Lead',
    department: 'ENG-MOB',
    manager: 'HM-0002',
    hiredAt: '2021-09-06',
    roles: ['manager', 'employee'],
    headOf: 'ENG-MOB',
    workLocationType: 'HYBRID',
  },
  {
    employeeNumber: 'HM-0005',
    firstName: 'Zara',
    lastName: 'Ahmed',
    workEmail: 'zara.ahmed@hazelmobile.com',
    jobTitle: 'Senior iOS Engineer',
    department: 'ENG-MOB',
    manager: 'HM-0004',
    hiredAt: '2022-04-18',
    roles: ['employee'],
    workLocationType: 'REMOTE',
  },
  {
    employeeNumber: 'HM-0006',
    firstName: 'Hassan',
    lastName: 'Malik',
    workEmail: 'hassan.malik@hazelmobile.com',
    jobTitle: 'AI Engineer',
    department: 'ENG-AI',
    manager: 'HM-0002',
    hiredAt: '2023-02-27',
    roles: ['employee'],
    workLocationType: 'REMOTE',
  },
  {
    employeeNumber: 'HM-0007',
    firstName: 'Fatima',
    lastName: 'Sheikh',
    workEmail: 'fatima.sheikh@hazelmobile.com',
    jobTitle: 'Product Designer',
    department: 'DESIGN',
    manager: 'HM-0001',
    hiredAt: '2024-07-08',
    roles: ['employee'],
  },
];

async function main(): Promise<void> {
  console.log('Seeding [PROJECT_NAME] development data...\n');

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
  console.log(`  Permissions : ${PERMISSIONS.length}`);

  // --- Roles + their permission grants ---------------------------------------
  for (const role of ROLES) {
    const created = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description, isSystem: true },
      create: { key: role.key, name: role.name, description: role.description, isSystem: true },
    });

    for (const grant of role.grants) {
      const permission = await prisma.permission.findUnique({ where: { key: grant.permission } });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: created.id, permissionId: permission.id } },
        update: { scope: grant.scope },
        create: { roleId: created.id, permissionId: permission.id, scope: grant.scope },
      });
    }
  }
  console.log(`  Roles       : ${ROLES.length}`);

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
  console.log(`  Departments : ${DEPARTMENTS.length}`);

  // --- Employees -------------------------------------------------------------
  for (const emp of EMPLOYEES) {
    const department = await prisma.department.findUnique({ where: { code: emp.department } });
    const manager = emp.manager
      ? await prisma.employee.findUnique({ where: { employeeNumber: emp.manager } })
      : null;

    const data = {
      firstName: emp.firstName,
      lastName: emp.lastName,
      workEmail: emp.workEmail,
      jobTitle: emp.jobTitle,
      status: 'ACTIVE' as const,
      workLocationType: emp.workLocationType ?? ('ONSITE' as const),
      hiredAt: new Date(emp.hiredAt),
      departmentId: department?.id ?? null,
      managerId: manager?.id ?? null,
    };

    const employee = await prisma.employee.upsert({
      where: { employeeNumber: emp.employeeNumber },
      update: data,
      create: { employeeNumber: emp.employeeNumber, ...data },
    });

    for (const roleKey of emp.roles) {
      const role = await prisma.role.findUnique({ where: { key: roleKey } });
      if (!role) continue;

      await prisma.employeeRole.upsert({
        where: { employeeId_roleId: { employeeId: employee.id, roleId: role.id } },
        update: {},
        create: { employeeId: employee.id, roleId: role.id },
      });
    }
  }
  console.log(`  Employees   : ${EMPLOYEES.length}`);

  // --- Department heads (done last: employees must exist first) --------------
  for (const emp of EMPLOYEES.filter((e) => e.headOf)) {
    const employee = await prisma.employee.findUnique({
      where: { employeeNumber: emp.employeeNumber },
    });
    if (!employee) continue;

    await prisma.department.update({
      where: { code: emp.headOf as string },
      data: { headEmployeeId: employee.id },
    });
  }

  console.log('\nSeed complete.');
  console.log('Inspect the data visually with:  npm run prisma:studio');
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
