import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentChangeReason,
  EmploymentType,
  PermissionScope,
  WorkLocationType,
  type Prisma,
} from '@prisma/client';

import { EmploymentAssignmentService } from '../assignments/employment-assignment.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { QueryEmployeesDto } from './dto/query-employees.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';

/** One person in the reporting tree. Declared at module scope so it can appear
 *  in the public return type of getOrgChart. */
export interface OrgChartNode {
  id: string;
  employeeNumber: string;
  name: string;
  title: string | null;
  department: string | null;
  workLocationType: string;
  status: string;
  children: OrgChartNode[];
}

/** Columns returned in the directory list. Deliberately excludes personal data. */
const LIST_SELECT = {
  id: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  workEmail: true,
  status: true,
  employmentType: true,
  workLocationType: true,
  workingTitle: true,
  role: { select: { id: true, code: true, title: true, level: true } },
  department: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly assignments: EmploymentAssignmentService,
  ) {}

  /**
   * The employee directory, narrowed to what the caller may see.
   *
   * The scope filter is ANDed with the user's own search filters, so there is
   * no way to widen visibility by crafting a query string.
   */
  async findAll(callerEmployeeId: string | null, scope: PermissionScope, query: QueryEmployeesDto) {
    const scopeFilter = await this.permissions.buildEmployeeScopeFilter(callerEmployeeId, scope);

    const filters: Prisma.EmployeeWhereInput[] = [scopeFilter, { deletedAt: null }];

    if (query.search) {
      const search = query.search.trim();
      filters.push({
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { preferredName: { contains: search, mode: 'insensitive' } },
          { workEmail: { contains: search, mode: 'insensitive' } },
          { employeeNumber: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.status) filters.push({ status: query.status });

    const where: Prisma.EmployeeWhereInput = { AND: filters };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      /** Echoed back so the UI can show "showing your team" vs "showing everyone". */
      scope,
    };
  }

  /** One employee's full profile, including career history. */
  async findOne(callerEmployeeId: string | null, scope: PermissionScope, id: string) {
    const allowed = await this.permissions.canAccessEmployee(callerEmployeeId, scope, id);
    if (!allowed) {
      // 404 rather than 403 on purpose: a manager should not be able to learn
      // that an employee exists outside their team by probing ids.
      throw new NotFoundException('Employee not found.');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...LIST_SELECT,
        personalEmail: true,
        phoneNumber: true,
        timezone: true,
        hiredAt: true,
        probationEndsAt: true,
        terminatedAt: true,
        createdAt: true,
        updatedAt: true,
        reports: {
          where: { deletedAt: null },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            role: { select: { title: true } },
          },
          orderBy: { lastName: 'asc' },
        },
        accessRoles: {
          select: {
            expiresAt: true,
            accessRole: { select: { key: true, name: true } },
          },
        },
      },
    });

    if (!employee) throw new NotFoundException('Employee not found.');

    const history = await this.assignments.getHistory(id);

    return { ...employee, assignmentHistory: history };
  }

  /**
   * Creates an employee AND their opening HIRE assignment in one transaction.
   *
   * Both or neither — an employee row with no open assignment would be an
   * invalid state that breaks every history query.
   */
  async create(dto: CreateEmployeeDto, recordedById: string | null) {
    await this.assertReferencesExist(dto.roleId, dto.departmentId, dto.managerId ?? null);

    const existing = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { employeeNumber: dto.employeeNumber },
          { workEmail: dto.workEmail.toLowerCase().trim() },
        ],
      },
      select: { employeeNumber: true, workEmail: true },
    });

    if (existing) {
      const clash =
        existing.employeeNumber === dto.employeeNumber ? 'employee number' : 'work email';
      throw new ConflictException(`An employee with that ${clash} already exists.`);
    }

    const hiredAt = new Date(dto.hiredAt);
    const employmentType = dto.employmentType ?? EmploymentType.FULL_TIME;
    const workLocationType = dto.workLocationType ?? WorkLocationType.ONSITE;

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          employeeNumber: dto.employeeNumber,
          firstName: dto.firstName,
          lastName: dto.lastName,
          preferredName: dto.preferredName ?? null,
          workEmail: dto.workEmail.toLowerCase().trim(),
          personalEmail: dto.personalEmail?.toLowerCase().trim() ?? null,
          phoneNumber: dto.phoneNumber ?? null,
          timezone: dto.timezone ?? 'Asia/Karachi',
          hiredAt,
          status: dto.status ?? 'PROBATION',
          workingTitle: dto.workingTitle ?? null,
          // Cache fields, kept in step with the assignment created below.
          roleId: dto.roleId,
          departmentId: dto.departmentId,
          managerId: dto.managerId ?? null,
          employmentType,
          workLocationType,
        },
        select: LIST_SELECT,
      });

      await this.assignments.createInitialAssignment(tx, {
        employeeId: employee.id,
        roleId: dto.roleId,
        departmentId: dto.departmentId,
        managerId: dto.managerId ?? null,
        employmentType,
        workLocationType,
        effectiveFrom: hiredAt,
        reason: AssignmentChangeReason.HIRE,
        recordedById,
      });

      return employee;
    });
  }

  /**
   * Updates an employee.
   *
   * Personal details are written directly. Anything touching the job goes
   * through EmploymentAssignmentService, which closes the old assignment and
   * opens a new one transactionally. There is no code path that writes the
   * five tracked fields directly onto the employee row.
   */
  async update(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    id: string,
    dto: UpdateEmployeeDto,
  ) {
    const allowed = await this.permissions.canAccessEmployee(callerEmployeeId, scope, id);
    if (!allowed) throw new NotFoundException('Employee not found.');

    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    // --- Personal details -----------------------------------------------------
    const personal: Prisma.EmployeeUpdateInput = {};
    if (dto.firstName !== undefined) personal.firstName = dto.firstName;
    if (dto.lastName !== undefined) personal.lastName = dto.lastName;
    if (dto.preferredName !== undefined) personal.preferredName = dto.preferredName;
    if (dto.workEmail !== undefined) personal.workEmail = dto.workEmail.toLowerCase().trim();
    if (dto.personalEmail !== undefined) {
      personal.personalEmail = dto.personalEmail.toLowerCase().trim();
    }
    if (dto.phoneNumber !== undefined) personal.phoneNumber = dto.phoneNumber;
    if (dto.timezone !== undefined) personal.timezone = dto.timezone;
    if (dto.workingTitle !== undefined) personal.workingTitle = dto.workingTitle;
    if (dto.status !== undefined) personal.status = dto.status;
    if (dto.probationEndsAt !== undefined) personal.probationEndsAt = new Date(dto.probationEndsAt);
    if (dto.terminatedAt !== undefined) personal.terminatedAt = new Date(dto.terminatedAt);

    if (Object.keys(personal).length > 0) {
      try {
        await this.prisma.employee.update({ where: { id }, data: personal });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new ConflictException('That work email is already used by another employee.');
        }
        throw error;
      }
    }

    // --- The job itself -------------------------------------------------------
    let assignmentChanged = false;
    if (dto.assignment) {
      const a = dto.assignment;
      await this.assertReferencesExist(a.roleId, a.departmentId, a.managerId);

      if (a.managerId === id) {
        throw new BadRequestException('An employee cannot be their own manager.');
      }
      if (a.managerId && (await this.wouldCreateReportingCycle(id, a.managerId))) {
        throw new BadRequestException(
          'That manager reports to this employee (directly or indirectly), which would create a loop in the org chart.',
        );
      }

      const result = await this.assignments.changeAssignment({
        employeeId: id,
        roleId: a.roleId,
        departmentId: a.departmentId,
        managerId: a.managerId,
        employmentType: a.employmentType,
        workLocationType: a.workLocationType,
        effectiveFrom: new Date(a.effectiveFrom),
        reason: a.reason,
        notes: a.notes ?? null,
        recordedById: callerEmployeeId,
      });
      assignmentChanged = result.changed;
    }

    const updated = await this.findOne(callerEmployeeId, scope, id);
    return { ...updated, assignmentChanged };
  }

  /**
   * Soft delete. HR records are retained for tax and audit reasons, so nothing
   * is ever physically removed.
   */
  async archive(callerEmployeeId: string | null, scope: PermissionScope, id: string) {
    const allowed = await this.permissions.canAccessEmployee(callerEmployeeId, scope, id);
    if (!allowed) throw new NotFoundException('Employee not found.');

    if (id === callerEmployeeId) {
      throw new ForbiddenException('You cannot archive your own record.');
    }

    const reportCount = await this.prisma.employee.count({
      where: { managerId: id, deletedAt: null },
    });
    if (reportCount > 0) {
      throw new BadRequestException(
        `This person still has ${reportCount} direct report${reportCount === 1 ? '' : 's'}. Reassign them to a new manager first.`,
      );
    }

    await this.prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { archived: true };
  }

  /**
   * The reporting tree, narrowed to what the caller may see.
   *
   * WHY THIS READS `Employee.managerId` RATHER THAN THE ASSIGNMENT TABLE
   * (you asked me to make this call — here is the reasoning.)
   *
   * The org chart shows the org as it stands TODAY, which is exactly what the
   * cached fields represent. Deriving it from `employment_assignments` would
   * mean filtering `effective_to IS NULL` and joining, to arrive at the same
   * answer more slowly.
   *
   * That is only safe because the cache is now trustworthy: every job change
   * goes through EmploymentAssignmentService in a transaction, and the
   * database's partial unique index makes a second "current" assignment
   * impossible. `findDrift()` on that service verifies the invariant holds.
   *
   * A HISTORICAL org chart ("show me the org last March") is a different
   * feature and WOULD have to query assignments with a date filter. Worth
   * building when Reporting lands; deliberately not built now.
   */
  async getOrgChart(callerEmployeeId: string | null, scope: PermissionScope) {
    const scopeFilter = await this.permissions.buildEmployeeScopeFilter(callerEmployeeId, scope);

    const employees = await this.prisma.employee.findMany({
      where: { AND: [scopeFilter, { deletedAt: null }] },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        managerId: true,
        workLocationType: true,
        status: true,
        role: { select: { title: true, level: true } },
        department: { select: { code: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const nodes = new Map<string, OrgChartNode>();
    for (const e of employees) {
      nodes.set(e.id, {
        id: e.id,
        employeeNumber: e.employeeNumber,
        name: `${e.preferredName ?? e.firstName} ${e.lastName}`,
        title: e.role?.title ?? null,
        department: e.department?.name ?? null,
        workLocationType: e.workLocationType,
        status: e.status,
        children: [],
      });
    }

    // Anyone whose manager is outside the visible set becomes a root. That way
    // a manager viewing their own team sees themselves at the top, rather than
    // an empty chart because their boss was filtered out.
    const roots: OrgChartNode[] = [];
    for (const e of employees) {
      const node = nodes.get(e.id) as OrgChartNode;
      const parent = e.managerId ? nodes.get(e.managerId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    return { roots, total: employees.length, scope };
  }

  /** Dropdown data for the create/edit forms. */
  async getFormOptions() {
    const [roles, departments, managers] = await Promise.all([
      this.prisma.role.findMany({
        where: { isActive: true },
        select: { id: true, code: true, title: true, jobFamily: true, level: true },
        orderBy: [{ jobFamily: 'asc' }, { level: 'desc' }],
      }),
      this.prisma.department.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, code: true, name: true, parentId: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.employee.findMany({
        where: { deletedAt: null, status: { not: 'TERMINATED' } },
        select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        orderBy: { lastName: 'asc' },
      }),
    ]);

    return { roles, departments, managers };
  }

  private async assertReferencesExist(
    roleId: string,
    departmentId: string,
    managerId: string | null,
  ): Promise<void> {
    const [role, department, manager] = await Promise.all([
      this.prisma.role.findUnique({ where: { id: roleId }, select: { id: true } }),
      this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }),
      managerId
        ? this.prisma.employee.findFirst({
            where: { id: managerId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!role) throw new BadRequestException('That job title (Role) does not exist.');
    if (!department) throw new BadRequestException('That department does not exist.');
    if (managerId && !manager) throw new BadRequestException('That manager does not exist.');
  }

  /**
   * Walks up from the proposed manager. If we reach the employee being edited,
   * setting that manager would make the org chart cyclic — and any code that
   * climbs the chain (leave approval, attendance escalation) would loop forever.
   */
  private async wouldCreateReportingCycle(employeeId: string, proposedManagerId: string) {
    const seen = new Set<string>();
    let cursor: string | null = proposedManagerId;

    while (cursor) {
      if (cursor === employeeId) return true;
      if (seen.has(cursor)) return false; // pre-existing loop; not ours to fix here
      seen.add(cursor);

      const next: { managerId: string | null } | null = await this.prisma.employee.findUnique({
        where: { id: cursor },
        select: { managerId: true },
      });
      cursor = next?.managerId ?? null;
    }

    return false;
  }
}
