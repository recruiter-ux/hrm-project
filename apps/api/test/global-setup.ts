/**
 * Runs ONCE before the whole test suite.
 *
 * Creates the test database if it does not exist and brings it up to date with
 * every committed migration. That last part matters more than it sounds: the
 * overlap guarantee on leave policy is a hand-written Postgres EXCLUDE
 * constraint that lives only in a migration file. A test database built with
 * `prisma db push` would not have it, and the test that proves overlapping
 * policy versions are impossible would then pass against a database that does
 * not actually prevent them.
 *
 * So: `migrate deploy`, the same command a deployment would run.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { maintenanceUrl, testDatabaseName, testDatabaseUrl } from './test-database';

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        'Tests read it from the repo-root .env file. Run them with `npm test` from\n' +
        'apps/api, or `npm run test` from the repo root — both load that file.',
    );
  }

  const url = testDatabaseUrl();
  const name = testDatabaseName();

  // Connect to the built-in `postgres` database: you cannot create a database
  // from inside the one you are creating.
  const admin = new PrismaClient({ datasources: { db: { url: maintenanceUrl() } } });

  try {
    const existing = await admin.$queryRaw<
      Array<{ exists: number }>
    >`SELECT 1 AS exists FROM pg_database WHERE datname = ${name}`;

    if (existing.length === 0) {
      // Identifiers cannot be parameterised. `name` comes from our own
      // DATABASE_URL, never from user input, and is quoted regardless.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`\n  Created test database ${name}`);
    }
  } catch (error) {
    throw new Error(
      `Could not prepare the test database.\n` +
        `Is PostgreSQL running? Start it with:  npm run db:up\n\n` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await admin.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    // npx is a shell script on Windows.
    shell: process.platform === 'win32',
  });

  console.log(`  Test database ${name} is migrated and ready.\n`);
}
