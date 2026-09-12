import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { Response } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from './auth.types';

/**
 * Everything to do with minting, storing, and clearing tokens.
 *
 * Split out from AuthService so the login/refresh/logout logic reads as a
 * sequence of intentions rather than a pile of crypto and cookie plumbing.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Refresh tokens are stored as a SHA-256 hash, never in plaintext. If the
   * database leaks, the hashes cannot be replayed as live sessions.
   *
   * SHA-256 rather than bcrypt here (unlike passwords) because the token is
   * already 200+ bits of server-generated randomness — there is nothing to
   * brute-force, and we need this lookup to be fast on every refresh.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * jsonwebtoken types `expiresIn` as a template-literal union ("15m", "7d",
   * …) rather than a plain string, so a value read from the environment needs
   * narrowing. Validated at runtime by the ttlToMs parser below, which falls
   * back to a sane default on anything malformed.
   */
  private ttl(key: 'auth.accessTtl' | 'auth.refreshTtl', fallback: string) {
    return this.config.get<string>(key, fallback) as JwtSignOptions['expiresIn'];
  }

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('auth.accessSecret'),
      expiresIn: this.ttl('auth.accessTtl', '15m'),
    });
  }

  /**
   * Signs a refresh token AND records it in the database.
   *
   * The database row is what makes logout real: a plain JWT cannot be revoked,
   * but deleting/revoking this row ends the session immediately.
   */
  async issueRefreshToken(
    userId: string,
    context: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<string> {
    const payload: RefreshTokenPayload = { sub: userId };

    const token = await this.jwt.signAsync(
      // jti makes every token unique even if issued in the same second for the
      // same user — without it two logins could produce an identical string
      // and collide on the tokenHash unique index.
      { ...payload, jti: randomUUID() },
      {
        secret: this.config.getOrThrow<string>('auth.refreshSecret'),
        expiresIn: this.ttl('auth.refreshTtl', '7d'),
      },
    );

    const decoded = this.jwt.decode<{ exp: number }>(token);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(decoded.exp * 1000),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ipAddress: context.ipAddress?.slice(0, 64) ?? null,
      },
    });

    return token;
  }

  /**
   * Verifies a refresh token on three levels, in order of cheapness:
   *   1. signature and expiry (no database hit)
   *   2. the row exists and has not been revoked
   *   3. the owning user is still active
   *
   * Returns the user id, or null if any check fails. Deliberately does NOT say
   * which check failed — the caller turns all of them into one generic 401.
   */
  async verifyRefreshToken(token: string): Promise<string | null> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.refreshSecret'),
      });
    } catch {
      return null;
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { select: { isActive: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null;
    if (!stored.user.isActive) return null;

    return payload.sub;
  }

  /** Marks a single refresh token as revoked. Used by logout and by rotation. */
  async revokeRefreshToken(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Ends every session for a user. For offboarding and password changes. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Cookies
  //
  // Tokens live in httpOnly cookies, NOT in localStorage. JavaScript cannot
  // read an httpOnly cookie, so a cross-site-scripting bug in the frontend
  // cannot steal the session.
  //
  // sameSite: 'lax' is enough in development because localhost:3000 and
  // localhost:4000 count as the SAME site (the port is ignored). In production,
  // if the API and web app end up on different domains, this must become
  // sameSite: 'none' with secure: true.
  // ---------------------------------------------------------------------------

  private get isProduction(): boolean {
    return this.config.get<string>('nodeEnv') === 'production';
  }

  setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const common = {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax' as const,
    };

    res.cookie(ACCESS_COOKIE, accessToken, {
      ...common,
      path: '/',
      maxAge: this.ttlToMs(this.config.get<string>('auth.accessTtl', '15m')),
    });

    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...common,
      path: REFRESH_COOKIE_PATH,
      maxAge: this.ttlToMs(this.config.get<string>('auth.refreshTtl', '7d')),
    });
  }

  clearAuthCookies(res: Response): void {
    // Path must match exactly or the browser keeps the cookie.
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  /** Converts "15m" / "7d" / "3600" into milliseconds for the cookie maxAge. */
  private ttlToMs(ttl: string): number {
    const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
    if (!match) return 15 * 60 * 1000;

    const value = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * (multipliers[match[2] ?? 's'] ?? 1000);
  }
}
