import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser, ResolvedPermission } from '../auth/auth.types';
import { REQUIRED_PERMISSION_KEY } from './decorators/require-permission.decorator';
import { PermissionsService } from './permissions.service';

/**
 * Enforces `@RequirePermission(...)`.
 *
 * Runs after JwtAuthGuard, so `req.user` is already populated. Routes with no
 * `@RequirePermission` pass straight through — being signed in is enough for
 * those (e.g. /auth/me).
 *
 * On success it attaches the resolved scope to the request so the service
 * layer can narrow its query. The guard never decides WHICH rows are visible;
 * that stays in the service, close to the query.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const request = context.switchToHttp().getRequest<
      Request & {
        user?: AuthenticatedUser;
        permissionScope?: ResolvedPermission;
      }
    >();

    const user = request.user;
    if (!user) throw new ForbiddenException('Not signed in.');

    const scope = await this.permissions.resolveScope(user.employeeId, required);

    if (!scope) {
      throw new ForbiddenException(
        `You do not have permission to do this (${required} is required).`,
      );
    }

    request.permissionScope = { key: required, scope };
    return true;
  }
}
