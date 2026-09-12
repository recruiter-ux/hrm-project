import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Declares which permission a route needs, e.g.
 *
 *   @RequirePermission('employee:read')
 *   @Get()
 *   findAll(...) { ... }
 *
 * PermissionsGuard then checks the caller holds it at SOME scope, and hands
 * the resolved scope to the handler via `@Scope()`. The guard answers "may you
 * call this at all?"; the service answers "on which rows?".
 *
 * Keys are always `resource:action` and must exist in the `permissions` table
 * — register new ones in prisma/seed.ts.
 */
export const RequirePermission = (permissionKey: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permissionKey);
