/**
 * Shapes returned by the API.
 *
 * Hand-written for now. When `packages/shared` exists these should move there
 * and be imported by both apps, so the two cannot drift apart.
 */

export type PermissionScope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'GLOBAL';

export type EmploymentStatus =
  'PROBATION' | 'ACTIVE' | 'ON_LEAVE' | 'NOTICE_PERIOD' | 'SUSPENDED' | 'TERMINATED';

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN' | 'CONSULTANT';

export type WorkLocationType = 'ONSITE' | 'REMOTE' | 'HYBRID';

export type AssignmentChangeReason =
  | 'HIRE'
  | 'PROMOTION'
  | 'DEMOTION'
  | 'LATERAL_MOVE'
  | 'DEPARTMENT_TRANSFER'
  | 'MANAGER_CHANGE'
  | 'EMPLOYMENT_TYPE_CHANGE'
  | 'WORK_LOCATION_CHANGE'
  | 'REORGANISATION'
  | 'TERMINATION'
  | 'DATA_CORRECTION';

export interface RoleRef {
  id: string;
  code: string;
  title: string;
  level: number | null;
  jobFamily?: string | null;
}

export interface DepartmentRef {
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
}

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
}

export interface EmployeeListItem {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string;
  status: EmploymentStatus;
  employmentType: EmploymentType;
  workLocationType: WorkLocationType;
  workingTitle: string | null;
  role: RoleRef | null;
  department: DepartmentRef | null;
  manager: PersonRef | null;
}

export interface AssignmentHistoryEntry {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: AssignmentChangeReason;
  notes: string | null;
  employmentType: EmploymentType;
  workLocationType: WorkLocationType;
  role: { code: string; title: string; level: number | null };
  department: { code: string; name: string };
  manager: PersonRef | null;
  recordedBy: { id: string; firstName: string; lastName: string } | null;
}

export interface EmployeeDetail extends EmployeeListItem {
  personalEmail: string | null;
  phoneNumber: string | null;
  timezone: string;
  hiredAt: string;
  probationEndsAt: string | null;
  terminatedAt: string | null;
  reports: Array<PersonRef & { role: { title: string } | null }>;
  accessRoles: Array<{ expiresAt: string | null; accessRole: { key: string; name: string } }>;
  assignmentHistory: AssignmentHistoryEntry[];
}

export interface EmployeeListResponse {
  items: EmployeeListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  scope: PermissionScope;
}

export interface DocumentItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  isConfidential: boolean;
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  uploadedBy: { id: string; firstName: string; lastName: string } | null;
}

export interface OrgChartNode {
  id: string;
  employeeNumber: string;
  name: string;
  title: string | null;
  department: string | null;
  workLocationType: WorkLocationType;
  status: EmploymentStatus;
  children: OrgChartNode[];
}

export interface CurrentUser {
  id: string;
  email: string;
  lastLoginAt: string | null;
  employee: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    workEmail: string;
    role: { code: string; title: string } | null;
    department: { code: string; name: string } | null;
    accessRoles: Array<{ accessRole: { key: string; name: string } }>;
  } | null;
  /** e.g. { "employee:read": "TEAM" } — used to show or hide UI. */
  permissions: Record<string, PermissionScope>;
}

// --- Leave (Phase 2) ---------------------------------------------------------

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ProrationMethod = 'PRORATED_BY_DAYS' | 'LATEST_POLICY_IN_YEAR';

/** One effective-dated version of a leave type's rules. */
export interface LeaveTypePolicy {
  id: string;
  leaveTypeId: string;
  quotaDays: number;
  approvalRequired: boolean;
  carryForwardEnabled: boolean;
  carryForwardMaxDays: number | null;
  minNoticeDays: number;
  effectiveFrom: string;
  /** Null means this is the version currently in force. */
  effectiveTo: string | null;
  notes: string | null;
  createdBy?: { id: string; firstName: string; lastName: string } | null;
  updatedBy?: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

/**
 * The type's IDENTITY. All rules live on `currentPolicy`, which is resolved
 * for today — which is why a quota change takes effect on its date without
 * anyone editing the type.
 */
export interface LeaveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPaid: boolean;
  /** False for unpaid leave, which can be taken with no entitlement. */
  requiresBalance: boolean;
  prorationMethod: ProrationMethod;
  isActive: boolean;
  currentPolicy: LeaveTypePolicy | null;
  versionCount: number;
}

export interface LeaveTypeDetail extends LeaveType {
  versions: LeaveTypePolicy[];
  usage: { requests: number; balances: number };
}

export interface EntitlementBreakdownRow {
  policyId: string;
  quotaDays: number;
  from: string;
  to: string;
  daysInPeriod: number;
  contribution: number;
}

export interface EntitlementResult {
  year: number;
  method: ProrationMethod;
  entitledDays: number;
  breakdown: EntitlementBreakdownRow[];
}

export interface LeaveBalanceSummary {
  leaveTypeId: string;
  code: string;
  name: string;
  requiresBalance: boolean;
  year: number;
  /** Derived from the effective-dated policy, unless HR set an override. */
  entitledDays: number;
  isOverridden: boolean;
  carriedForwardDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  /** Empty when overridden — there is no policy calculation to show. */
  entitlementBreakdown: EntitlementBreakdownRow[];
}

export interface LeaveBalancesResponse {
  employeeId: string;
  year: number;
  balances: LeaveBalanceSummary[];
}

export interface LeaveRequestItem {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveRequestStatus;
  decisionComment: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** True when the policy required no approval, so nobody decided it. */
  autoApproved: boolean;
  employee: PersonRef & { workEmail: string };
  leaveType: { id: string; code: string; name: string; requiresBalance: boolean };
  /** Audit only: who the request was routed to at submission. */
  approver: { id: string; firstName: string; lastName: string } | null;
  decidedBy: { id: string; firstName: string; lastName: string } | null;
  /** Which policy version the request was judged against. */
  appliedPolicy: {
    id: string;
    quotaDays: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
}

export interface LeaveRequestsResponse {
  items: LeaveRequestItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  scope: PermissionScope;
}

export interface FormOptions {
  roles: RoleRef[];
  departments: DepartmentRef[];
  managers: PersonRef[];
}

/** Working days in a range, counted by the API rather than the browser. */
export interface WorkingDaysResponse {
  startDate: string;
  endDate: string;
  days: number;
  valid: boolean;
}

/** Where a submitted request was sent, and why. */
export interface LeaveRouting {
  source: 'MANAGER' | 'DEPARTMENT_HEAD' | 'NONE';
  note: string | null;
}

export type LeaveRequestCreated = LeaveRequestItem & { routing: LeaveRouting };

// --- Notifications (Phase 2) -------------------------------------------------

/**
 * One thing the signed-in person should know about.
 *
 * `type` is an open string, not a union, on purpose: a new module must be able
 * to raise a new kind of notification without a change here.
 */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  /** Path inside this app, e.g. `/leave/approvals?request=abc`. */
  link: string | null;
  /** Null means unread. */
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
  total: number;
}

/**
 * One line of the shared audit log: who did what to which record.
 *
 * Generic across modules — the same shape will describe a recruitment action
 * or an attendance correction once those exist.
 */
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** A readable sentence, written at the time it happened. */
  summary: string;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string } | null;
}

export interface NotificationDelivery {
  channel: 'EMAIL';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
}
