import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { NotificationDispatcherService } from '../src/notifications/notification-dispatcher.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildWorld, TEST_PASSWORD, type TestWorld } from './fixtures';

/**
 * =============================================================================
 * A REAL APPLICATION, NOT A MOCK
 *
 * Every integration test runs against the actual AppModule: the same global
 * JwtAuthGuard, the same PermissionsGuard, the same ValidationPipe with
 * `forbidNonWhitelisted`, the same Prisma client against a real Postgres.
 *
 * That last point is the reason this file exists rather than a pile of mocks.
 * The three things most likely to break this module silently are all invisible
 * to a mocked test:
 *
 *   - the EXCLUDE constraint that makes overlapping policy versions impossible
 *   - the row lock that stops two simultaneous requests spending the same days
 *   - `forbidNonWhitelisted` rejecting an attempt to rewrite a historical quota
 *
 * None of those live in TypeScript. They live in Postgres and in the pipe
 * configuration, and only a real request through a real stack exercises them.
 *
 * Authentication is real too: tests log in over HTTP and keep the httpOnly
 * cookies, exactly as a browser does.
 * =============================================================================
 */

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  dispatcher: NotificationDispatcherService;
  world: TestWorld;
  /** Signs in and returns a client that carries that person's cookies. */
  login(email: string): Promise<Agent>;
  /** Rebuilds the fixture. Called between test files, not between tests. */
  reset(): Promise<TestWorld>;
  close(): Promise<void>;
}

export type Agent = ReturnType<typeof request.agent>;

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({
    // Nest's startup chatter would bury the test output.
    logger: ['error'],
  });

  // ⚠️ MUST MIRROR main.ts EXACTLY. A test that ran without
  // `forbidNonWhitelisted` would happily accept a request the real API
  // rejects, and the "you cannot rewrite a historical quota" test would be
  // meaningless.
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  const prisma = app.get(PrismaService);
  const dispatcher = app.get(NotificationDispatcherService);
  let world = await buildWorld(prisma);

  async function login(email: string): Promise<Agent> {
    const agent = request.agent(app.getHttpServer() as App);
    const response = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(
        `Test login failed for ${email}: HTTP ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return agent;
  }

  return {
    app,
    prisma,
    dispatcher,
    get world() {
      return world;
    },
    login,
    async reset() {
      world = await buildWorld(prisma);
      return world;
    },
    async close() {
      await app.close();
    },
  };
}
