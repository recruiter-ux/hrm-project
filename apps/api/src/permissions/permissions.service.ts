import { Injectable } from '@nestjs/common';
import { PermissionScope, type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Scopes ranked weakest to strongest. Used when one person holds the same
 * permission through several AccessRoles — the widest one wins.
 *
 * Example: someone who is both a Manager (employee:read at TEAM) and an HR
 * Administrator (employee:read at GLOBAL) gets GLOBAL.
 */
const SCOPE_RANK: Record<PermissionScope, number> = {
  [PermissionScope.SELF]: 0,
  [PermissionScope.TEAM]: 1,
  [PermissionScope.DEPARTMENT]: 2,
  [PermissionScope.GLOBAL]: 3,
};

/**
 * A `where` fragment that matches no rows. Used when a caller's scope resolves
 * to nothing — for instance a user account with no linked employee record
 * asking for SELF-scoped data.
 *
 * Returning "match nothing" is safer than returning "match everything" if a
 * future edit ever forgets a branch.
 */
const MATCH_NOTHING: Prisma.EmployeeWhereInput = { id: '__no_such_employee__' };

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every permission this employee holds, mapped to the widest scope they hold
   * it at.
   *
   * Loaded fresh from the database on each request rather than baked into the
   * access token. That costs one query, and buys immediate revocation — take
   * someone out of the hr_admin AccessRole and they lose access on their very
   * next request, not 15 minutes later when their token expires.
   */
  async getPermissions(employeeId: string | null): Promise<Map<string, PermissionScope>> {
    const result = new Map<string, PermissionScope>();
    if (!employeeId) return result;

    const grants = await this.prisma.employeeAccessRole.findMany({
      where: {
        employeeId,
        // Temporary elevation (e.g. covering HR during someone's leave) lapses
        // on its own without anyone having to remember to remove it.
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        accessRole: {
          select: {
            permissions: {
              select: { scope: true, permission: { select: { key: true } } },
            },
          },
        },
      },
    });

    for (const grant of grants) {
      for (const entry of grant.accessRole.permissions) {
        const key = entry.permission.key;
        const existing = result.get(key);
        if (!existing || SCOPE_RANK[entry.scope] > SCOPE_RANK[existing]) {
          result.set(key, entry.scope);
        }
      }
    }

    return result;
  }

  /** The scope this employee holds a single permission at, or null if not at all. */
  async resolveScope(
    employeeId: string | null,
    permissionKey: string,
  ): Promise<PermissionScope | null> {
    const permissions = await this.getPermissions(employeeId);
    return permissions.get(permissionKey) ?? null;
  }

  /**
   * Turns a scope into a Prisma filter over the Employee table. This one
   * method is what stops a manager seeing another team's salaries.
   *
   *   GLOBAL     — everyone
   *   DEPARTMENT — the caller's department and everything nested beneath it
   *   TEAM       — the caller's direct reports, plus themselves
   *   SELF       — only themselves
   *
   * Note TEAM is one level deep by design: a manager sees their own reports,
   * not their reports' reports. Skip-level visibility is what DEPARTMENT is
   * for. If that turns out to be wrong for Hazel Mobile, this is the single
   * place to change it.
   */
  async buildEmployeeScopeFilter(
    employeeId: string | null,
    scope: PermissionScope,
  ): Promise<Prisma.EmployeeWhereInput> {
    if (scope === PermissionScope.GLOBAL) return {};
    if (!employeeId) return MATCH_NOTHING;

    switch (scope) {
      case PermissionScope.SELF:
        return { id: employeeId };

      case PermissionScope.TEAM:
        return { OR: [{ id: employeeId }, { managerId: employeeId }] };

      case PermissionScope.DEPARTMENT: {
        const me = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { departmentId: true },
        });

        // Someone with no department can still always see themselves.
        if (!me?.departmentId) return { id: employeeId };

        const departmentIds = await this.getDepartmentAndDescendants(me.departmentId);
        return { OR: [{ departmentId: { in: departmentIds } }, { id: employeeId }] };
      }

      default:
        return MATCH_NOTHING;
    }
  }

  /**
   * A department plus every department nested underneath it, at any depth.
   *
   * Departments nest (Engineering > Mobile > iOS), so a DEPARTMENT-scoped
   * permission on Engineering has to reach the iOS team too.
   *
   * Loads the whole (small) department table once and walks it in memory
   * rather than issuing a recursive SQL query. A studio has tens of
   * departments, not thousands. If that ever stops being true, replace this
   * with a Postgres recursive CTE — the method signature will not change.
   */
  async getDepartmentAndDescendants(rootId: string): Promise<string[]> {
    const all = await this.prisma.department.findMany({
      select: { id: true, parentId: true },
    });

    const childrenByParent = new Map<string, string[]>();
    for (const dept of all) {
      if (!dept.parentId) continue;
      const siblings = childrenByParent.get(dept.parentId) ?? [];
      siblings.push(dept.id);
      childrenByParent.set(dept.parentId, siblings);
    }

    const collected: string[] = [];
    const queue = [rootId];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift() as string;
      // Guards against an accidental cycle in the data hanging the request.
      if (seen.has(current)) continue;
      seen.add(current);
      collected.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }

    return collected;
  }

  /**
   * Whether the caller may act on one specific employee. Used by the
   * single-record endpoints (view, edit) where a list filter is not enough.
   */
  async canAccessEmployee(
    callerEmployeeId: string | null,
    scope: PermissionScope,
    targetEmployeeId: string,
  ): Promise<boolean> {
    const filter = await this.buildEmployeeScopeFilter(callerEmployeeId, scope);
    const match = await this.prisma.employee.findFirst({
      where: { AND: [{ id: targetEmployeeId }, filter] },
      select: { id: true },
    });
    return match !== null;
  }
}
