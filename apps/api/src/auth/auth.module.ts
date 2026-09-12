import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Secrets are NOT registered here. Each signing call passes its own secret
 * explicitly (see TokenService), because access and refresh tokens use
 * different ones and JwtModule only holds a single default.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  // JwtModule is re-exported so the globally registered JwtAuthGuard (declared
  // in AppModule) can inject JwtService.
  exports: [AuthService, TokenService, JwtModule],
})
export class AuthModule {}
