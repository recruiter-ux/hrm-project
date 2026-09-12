import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { ACCESS_COOKIE, type AccessTokenPayload, type AuthenticatedUser } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Verifies the access token on every request and attaches the caller to
 * `req.user`.
 *
 * Registered GLOBALLY in AppModule, so endpoints are protected by default and
 * must opt out with `@Public()`. A forgotten decorator therefore locks an
 * endpoint down rather than exposing it — the safe direction to fail.
 *
 * This guard answers only "who are you?". "May you do this?" is
 * PermissionsGuard, which runs after it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException('Not signed in.');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.accessSecret'),
      });

      request.user = {
        userId: payload.sub,
        email: payload.email,
        employeeId: payload.eid,
      };
      return true;
    } catch {
      // Covers expired, tampered, and wrong-secret tokens alike. The web app
      // responds to a 401 by calling /auth/refresh once, then retrying.
      throw new UnauthorizedException('Session expired.');
    }
  }

  /**
   * Cookie first (how the web app authenticates), Authorization header second
   * (convenient for curl, Postman, and future service-to-service calls).
   */
  private extractToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[ACCESS_COOKIE];
    if (fromCookie) return fromCookie;

    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    return undefined;
  }
}
