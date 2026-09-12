import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser, ResolvedPermission } from '../auth.types';

/**
 * Injects the authenticated caller into a controller method:
 *
 *   findAll(@CurrentUser() user: AuthenticatedUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      // Should be unreachable — JwtAuthGuard runs first and rejects otherwise.
      throw new Error('@CurrentUser() used on a route with no JwtAuthGuard.');
    }
    return request.user;
  },
);

/**
 * Injects the scope resolved for this route's required permission:
 *
 *   findAll(@Scope() permission: ResolvedPermission) { ... }
 *
 * Only meaningful on routes that also declare @RequirePermission(...).
 */
export const Scope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedPermission => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { permissionScope?: ResolvedPermission }>();
    if (!request.permissionScope) {
      throw new Error('@Scope() used on a route with no @RequirePermission(...).');
    }
    return request.permissionScope;
  },
);
