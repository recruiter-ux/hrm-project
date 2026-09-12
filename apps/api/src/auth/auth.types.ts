import type { PermissionScope } from '@prisma/client';

/**
 * What gets signed into an ACCESS token.
 *
 * Deliberately small. It carries identity only — never permissions. If
 * permissions lived in the token, revoking someone's payroll access would not
 * take effect until their token expired. They are loaded fresh per request
 * instead (see PermissionsService).
 */
export interface AccessTokenPayload {
  /** User id. `sub` is the JWT standard claim name for "subject". */
  sub: string;
  email: string;
  /** The linked employee, or null for accounts with no staff record. */
  eid: string | null;
}

/** What gets signed into a REFRESH token. Even smaller — it only identifies. */
export interface RefreshTokenPayload {
  sub: string;
}

/**
 * The authenticated caller, attached to `req.user` by JwtAuthGuard.
 * Read it in a controller with the `@CurrentUser()` decorator.
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  employeeId: string | null;
}

/**
 * Attached to `req.permissionScope` by PermissionsGuard when a route declares
 * `@RequirePermission(...)`. Tells the service layer HOW MUCH the caller may
 * see, which it turns into a query filter.
 */
export interface ResolvedPermission {
  key: string;
  scope: PermissionScope;
}

/** Cookie names. Centralised so the web app and API cannot drift apart. */
export const ACCESS_COOKIE = 'pn_access';
export const REFRESH_COOKIE = 'pn_refresh';

/**
 * The refresh cookie is scoped to /api/auth so it is not sent on every single
 * API call — only on refresh and logout. Smaller attack surface.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';
