import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { REFRESH_COOKIE, type AuthenticatedUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { TokenService } from './token.service';

/**
 * Endpoints under /api/auth.
 *
 * Tokens are delivered as httpOnly cookies, never in the response body. The
 * browser attaches them automatically; JavaScript can never read them.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  private requestContext(req: Request) {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password, this.requestContext(req));
    this.tokens.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  /**
   * Called by the web app when an API request comes back 401. Rotates the
   * token pair — the old refresh token is revoked as part of this.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[REFRESH_COOKIE] ?? '';

    const result = await this.auth.refresh(token, this.requestContext(req));
    this.tokens.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  /**
   * Public because logging out must work even with an expired access token —
   * otherwise a user whose session lapsed could never clear their cookies.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    await this.auth.logout(cookies?.[REFRESH_COOKIE]);
    this.tokens.clearAuthCookies(res);
    return { ok: true };
  }

  /**
   * Who am I, and what am I allowed to do?
   *
   * The web app calls this on load to restore the session after a page
   * refresh, and uses the returned permissions to decide which navigation
   * items and buttons to render.
   */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.userId);
  }
}
