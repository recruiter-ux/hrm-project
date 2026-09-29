/**
 * =============================================================================
 * Velixa HR — seed CONFIGURATION
 *
 * The permission catalogue, the access roles and their scopes, and the opening
 * leave types. Separated from seed.ts so that two very different consumers can
 * share one definition:
 *
 *   prisma/seed.ts   fills a development database
 *   test/fixtures.ts builds the world the automated tests run against
 *
 * That matters more than it looks. If the tests declared their own permission
 * grants they would be testing a fiction — a permission test would keep
 * passing after someone quietly widened a real scope in the seed. Importing
 * the same data means a test failure is a genuine statement about the
 * configuration this product ships with.
 *
 * Remember the two similar-sounding concepts:
 *   Role       = job title      ("Software Engineer")
 *   AccessRole = permission set ("HR Administrator")
 * =============================================================================
 */
import { PermissionScope } from '@prisma/client';

// -----------------------------------------------------------------------------
// 1. PERMISSIONS
//
// Every permission is a resource + action pair. Each future module appends its
// own block here (leave:*, attendance:*, payroll:*) so there is one place to
// see everything the system can authorise.
// -----------------------------------------------------------------------------
export const PERMISSIONS: Array<{
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

  // --- Leave module (Phase 2) ---
  { resource: 'leave_type', action: 'read', module: 'leave', description: 'View leave types' },
  {
    resource: 'leave_type',
    action: 'manage',
    module: 'leave',
    description: 'Create and edit leave types',
  },
  {
    resource: 'leave_balance',
    action: 'read',
    module: 'leave',
    description: 'View leave balances',
  },
  {
    resource: 'leave_balance',
    action: 'manage',
    module: 'leave',
    description: 'Set leave entitlements',
  },
  {
    resource: 'leave_request',
    action: 'read',
    module: 'leave',
    description: 'View leave requests',
  },
  {
    resource: 'leave_request',
    action: 'create',
    module: 'leave',
    description: 'Submit leave requests',
  },
  {
    resource: 'leave_request',
    action: 'approve',
    module: 'leave',
    description: 'Approve or reject leave requests',
  },
  {
    resource: 'leave_request',
    action: 'cancel',
    module: 'leave',
    description: 'Withdraw a leave request',
  },
  {
    resource: 'leave_policy',
    action: 'read',
    module: 'leave',
    description: 'View leave policy versions and history',
  },
  {
    resource: 'leave_policy',
    action: 'manage',
    module: 'leave',
    description: 'Create leave types and effective-dated policy versions',
  },
];

// -----------------------------------------------------------------------------
// 1b. LEAVE TYPES + THEIR OPENING POLICY (Phase 2)
//
// These are STARTING data, not a fixed list. HR creates and archives leave
// types through the admin UI — nothing in application code depends on these
// codes existing.
//
// Each type gets one opening policy version effective 1 January. Further
// versions are created through the UI, which is what preserves history when a
// quota changes mid-year.
//
// THE QUOTAS BELOW ARE HAZEL MOBILE'S ACTUAL LEAVE STRUCTURE, confirmed by
// leadership on 2026-09-29:
//
//   Casual Leave   8 days
//   Sick Leave     6 days
//   Annual Leave   6 days
//   Unpaid Leave   no paid entitlement
//
// ⚠️ THEY ARE STARTING VALUES, NOT CONSTANTS. Nothing in application code
// reads them, and nothing anywhere says "Annual Leave is worth 6 days". They
// create the first policy version of a brand-new database; after that HR
// changes quotas through Leave policy settings, which opens a new
// effective-dated version and leaves the old one intact. Editing a number
// here has NO effect on a database that has already been seeded — that is the
// whole point of the design.
//
// Two deliberate demonstrations:
//   UNPAID  requiresBalance: false   — legitimate to take with no entitlement
//   UNPAID  approvalRequired: false  — auto-approves on submission
// -----------------------------------------------------------------------------
export const LEAVE_TYPES: Array<{
  code: string;
  name: string;
  description: string;
  isPaid: boolean;
  requiresBalance: boolean;
  policy: {
    quotaDays: number;
    approvalRequired: boolean;
    carryForwardEnabled: boolean;
    carryForwardMaxDays: number | null;
    minNoticeDays: number;
  };
}> = [
  {
    code: 'ANNUAL',
    name: 'Annual Leave',
    description: 'Paid holiday entitlement.',
    isPaid: true,
    requiresBalance: true,
    policy: {
      quotaDays: 6,
      approvalRequired: true,
      carryForwardEnabled: false,
      carryForwardMaxDays: null,
      minNoticeDays: 2,
    },
  },
  {
    code: 'SICK',
    name: 'Sick Leave',
    description: 'Paid time off for illness. A medical note may be requested.',
    isPaid: true,
    requiresBalance: true,
    policy: {
      // No notice period: you cannot give two days' warning of falling ill.
      quotaDays: 6,
      approvalRequired: true,
      carryForwardEnabled: false,
      carryForwardMaxDays: null,
      minNoticeDays: 0,
    },
  },
  {
    code: 'CASUAL',
    name: 'Casual Leave',
    description: 'Short-notice personal time off.',
    isPaid: true,
    requiresBalance: true,
    policy: {
      quotaDays: 8,
      approvalRequired: true,
      carryForwardEnabled: true,
      carryForwardMaxDays: 2,
      minNoticeDays: 1,
    },
  },
  {
    code: 'UNPAID',
    name: 'Unpaid Leave',
    description: 'Time off without pay. Requires no entitlement and no approval.',
    isPaid: false,
    requiresBalance: false,
    policy: {
      quotaDays: 0,
      approvalRequired: false,
      carryForwardEnabled: false,
      carryForwardMaxDays: null,
      minNoticeDays: 0,
    },
  },
];

// -----------------------------------------------------------------------------
// 2. ACCESS ROLES — what people may DO in the software.
//
// `scope` is what makes one permission mean different things to different
// access roles. A manager and an HR admin both hold `employee:read` — the
// manager sees their direct reports, HR sees everyone.
// -----------------------------------------------------------------------------
export const ACCESS_ROLES: Array<{
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
      // Leave: HR sets entitlements and can decide any request, including ones
      // whose manager has left the company.
      { permission: 'leave_type:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_type:manage', scope: PermissionScope.GLOBAL },
      { permission: 'leave_balance:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_balance:manage', scope: PermissionScope.GLOBAL },
      { permission: 'leave_request:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_request:create', scope: PermissionScope.GLOBAL },
      { permission: 'leave_request:approve', scope: PermissionScope.GLOBAL },
      { permission: 'leave_request:cancel', scope: PermissionScope.GLOBAL },
      // Policy administration is HR-only. No manager or employee AccessRole
      // grants leave_policy:manage at any scope.
      { permission: 'leave_policy:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_policy:manage', scope: PermissionScope.GLOBAL },
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
      { permission: 'leave_type:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_balance:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'leave_request:read', scope: PermissionScope.DEPARTMENT },
      { permission: 'leave_request:create', scope: PermissionScope.SELF },
      { permission: 'leave_request:approve', scope: PermissionScope.DEPARTMENT },
      { permission: 'leave_request:cancel', scope: PermissionScope.SELF },
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
      // Leave: a manager decides their direct reports' requests, and submits
      // their own (SELF) — which is what stops them approving their own.
      { permission: 'leave_type:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_balance:read', scope: PermissionScope.TEAM },
      { permission: 'leave_request:read', scope: PermissionScope.TEAM },
      { permission: 'leave_request:create', scope: PermissionScope.SELF },
      { permission: 'leave_request:approve', scope: PermissionScope.TEAM },
      { permission: 'leave_request:cancel', scope: PermissionScope.SELF },
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
      // Leave: everyone can request their own and withdraw it. Note there is
      // no leave_request:approve here at all — an ordinary employee has no
      // approval power whatsoever.
      { permission: 'leave_type:read', scope: PermissionScope.GLOBAL },
      { permission: 'leave_balance:read', scope: PermissionScope.SELF },
      { permission: 'leave_request:read', scope: PermissionScope.SELF },
      { permission: 'leave_request:create', scope: PermissionScope.SELF },
      { permission: 'leave_request:cancel', scope: PermissionScope.SELF },
      { permission: 'department:read', scope: PermissionScope.GLOBAL },
      { permission: 'role:read', scope: PermissionScope.GLOBAL },
      { permission: 'document:read', scope: PermissionScope.SELF },
      { permission: 'document:upload', scope: PermissionScope.SELF },
    ],
  },
];
