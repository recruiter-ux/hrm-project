import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface DependencyStatus {
  status: 'up' | 'down';
  error?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

/**
 * The endpoint you hit to answer "is this thing actually working?".
 *
 * Sits at GET /health (outside the /api prefix — see main.ts).
 *
 * It genuinely queries Postgres and pings Redis rather than just returning
 * `{ ok: true }`, so a green response means the whole chain works.
 *
 * `status` is "ok" only when the DATABASE is reachable. Redis being down
 * reports "degraded", because nothing depends on Redis yet and the API is
 * still usable without it.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Public: uptime monitors and load balancers probe this without credentials. */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      service: '[PROJECT_NAME] API',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await this.prisma.ping();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: (error as Error).message };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const alive = await this.redis.ping();
    return alive ? { status: 'up' } : { status: 'down', error: 'PING failed' };
  }
}
