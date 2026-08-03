import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/**
 * The application root.
 *
 * Feature modules get added to `imports` as we build them. The intended
 * layout is one module per business area, e.g.
 *   EmployeesModule, DepartmentsModule, LeaveModule, AttendanceModule
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The single .env lives at the repo root. The first path wins; the local
      // fallback exists so the API can also run from its own folder if needed.
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnv,
      cache: true,
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,

    // Features
    HealthModule,
  ],
})
export class AppModule {}
