import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis connection.
 *
 * NOTHING USES THIS YET. It is wired up now so that the local environment
 * matches production from day one, and so the phases that need it —
 * background jobs, the notification queue, caching expensive dashboard
 * queries, and rate limiting once auth exists — can just inject it.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(this.config.get<string>('redis.url', 'redis://localhost:6379'), {
      // Wait for an explicit .connect() rather than dialling in the
      // constructor, so a Redis outage cannot stop the API from booting.
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });

    // ioredis emits 'error' on an EventEmitter. Without a listener attached,
    // Node treats it as an unhandled exception and kills the process — so a
    // brief Redis blip would take the whole API down.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Connected to Redis');
    } catch (error) {
      // Deliberately non-fatal: no feature depends on Redis yet, and a failed
      // cache should never be the reason the HR system is offline.
      this.logger.warn(
        `Could not connect to Redis (continuing without it): ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /** The raw ioredis client, for when a feature module needs full access. */
  getClient(): Redis {
    return this.client;
  }

  /** Used by the health endpoint. Returns false rather than throwing. */
  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }
}
