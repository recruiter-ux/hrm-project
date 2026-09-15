/**
 * Shapes returned by the API.
 *
 * Hand-written for now. When `packages/shared` exists these should move there
 * and be imported by both apps, so the two cannot drift apart.
 */

export type PermissionScope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'GLOBAL';

export type EmploymentStatus =
  | 'PROBATION'
  | 'ACTIVE'
  | 'ON_LEAVE'
  | 'NOTICE_PERIOD'
  | 'SUSPENDED'
  | 'TERMINATED';

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

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPaid: boolean;
  /** False for unpaid leave, which can be taken with no entitlement. */
  requiresBalance: boolean;
  defaultAnnualDays: number;
  isActive: boolean;
}

export interface LeaveBalanceSummary {
  leaveTypeId: string;
  code: string;
  name: string;
  requiresBalance: boolean;
  year: number;
  entitledDays: number;
  approvedDays: number;
  pendingDays: number;
  remainingDays: number;
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
  employee: PersonRef & { workEmail: string };
  leaveType: { id: string; code: string; name: string; requiresBalance: boolean };
  approver: { id: string; firstName: string; lastName: string } | null;
  decidedBy: { id: string; firstName: string; lastName: string } | null;
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
