import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The single database connection pool for the whole application.
 *
 * Everything that touches Postgres goes through this service, injected into
 * other services like so:
 *
 *   constructor(private readonly prisma: PrismaService) {}
 *   const staff = await this.prisma.employee.findMany();
 *
 * Never call `new PrismaClient()` anywhere else — each instance opens its own
 * pool and Postgres will run out of connections.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
          : [{ emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL');
  }

  /**
   * Cheap round-trip used by the health endpoint to prove the database is
   * genuinely reachable, not just that a pool object exists.
   */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
