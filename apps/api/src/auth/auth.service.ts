import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth.types';
import { TokenService } from './token.service';

/** How many consecutive failures before the account is temporarily locked. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * bcrypt work factor. 12 takes roughly 250ms on modern hardware — slow enough
 * to make offline brute-forcing expensive, fast enough that login feels
 * instant. Raise it as hardware improves.
 */
const BCRYPT_ROUNDS = 12;

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
  ) {}

  static hashPassword(plaintext: string): Promise<string> {
    return hash(plaintext, BCRYPT_ROUNDS);
  }

  /**
   * Verifies credentials and issues a token pair.
   *
   * Every failure path throws the SAME message. Saying "no such user" versus
   * "wrong password" would let someone enumerate which email addresses have
   * accounts.
   */
  async login(
    email: string,
    password: string,
    context: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<LoginResult> {
    const genericFailure = new UnauthorizedException('Incorrect email or password.');

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // Hash a dummy value anyway so that a missing account takes about as
      // long as a wrong password. Otherwise response timing reveals which
      // emails exist.
      await compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      throw genericFailure;
    }

    if (!user.isActive) throw genericFailure;

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    const passwordMatches = await compare(password, user.passwordHash);

    if (!passwordMatches) {
      await this.recordFailedAttempt(user.id, user.failedLoginAttempts);
      throw genericFailure;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const authenticated: AuthenticatedUser = {
      userId: user.id,
      email: user.email,
      employeeId: user.employeeId,
    };

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      eid: user.employeeId,
    });
    const refreshToken = await this.tokens.issueRefreshToken(user.id, context);

    this.logger.log(`Login: ${user.email}`);

    return { user: authenticated, accessToken, refreshToken };
  }

  private async recordFailedAttempt(userId: string, currentCount: number): Promise<void> {
    const attempts = currentCount + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    if (shouldLock) {
      this.logger.warn(`Account locked after ${attempts} failed attempts: user ${userId}`);
    }
  }

  /**
   * Exchanges a valid refresh token for a fresh pair, and REVOKES the old one.
   *
   * Rotating on every refresh means a stolen refresh token is usable at most
   * once, and only until the real user's next refresh.
   */
  async refresh(
    refreshToken: string,
    context: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<LoginResult> {
    const userId = await this.tokens.verifyRefreshToken(refreshToken);
    if (!userId) throw new UnauthorizedException('Session expired. Please sign in again.');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    await this.tokens.revokeRefreshToken(refreshToken);

    const newAccess = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      eid: user.employeeId,
    });
    const newRefresh = await this.tokens.issueRefreshToken(user.id, context);

    return {
      user: { userId: user.id, email: user.email, employeeId: user.employeeId },
      accessToken: newAccess,
      refreshToken: newRefresh,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefreshToken(refreshToken);
  }

  /**
   * The full profile the frontend needs after login: who you are, which
   * employee record you are attached to, and what you are allowed to do.
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        lastLoginAt: true,
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            workEmail: true,
            role: { select: { code: true, title: true } },
            department: { select: { code: true, name: true } },
            accessRoles: {
              select: { accessRole: { select: { key: true, name: true } } },
            },
          },
        },
      },
    });

    if (!user) throw new UnauthorizedException();

    // Flattened to `{ "employee:read": "TEAM", ... }` so the web app can gate
    // navigation and buttons on exactly what the API will enforce. This is a
    // convenience for the UI only — hiding a button is not security, and every
    // endpoint re-checks server-side regardless.
    const permissionMap = await this.permissions.getPermissions(user.employee?.id ?? null);

    return {
      ...user,
      permissions: Object.fromEntries(permissionMap),
    };
  }
}
