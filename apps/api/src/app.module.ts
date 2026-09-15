import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DocumentsModule } from './documents/documents.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthModule } from './health/health.module';
import { LeaveModule } from './leave/leave.module';
import { PermissionsGuard } from './permissions/permissions.guard';
import { PermissionsModule } from './permissions/permissions.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';

/**
 * The application root.
 *
 * SECURITY POSTURE: both guards are registered globally, so every endpoint is
 * locked by default.
 *   - JwtAuthGuard runs first and answers "who are you?". Opt out with @Public().
 *   - PermissionsGuard runs second and answers "may you do this?". It only acts
 *     on routes carrying @RequirePermission(...).
 *
 * Registering them here rather than per-controller means a new module is
 * protected the moment it is added, even if its author forgets to think about
 * auth. Forgetting a decorator locks an endpoint down instead of exposing it.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnv,
      cache: true,
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,
    StorageModule,
    PermissionsModule,

    // Features
    AuthModule,
    EmployeesModule,
    DocumentsModule,
    LeaveModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
