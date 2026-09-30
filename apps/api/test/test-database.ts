/**
 * Where the tests' database lives.
 *
 * ⚠️ NEVER THE DEVELOPMENT DATABASE. Integration tests truncate every table
 * before each file, so pointing them at `velixa_hr_dev` would silently delete
 * whatever you had been clicking through. The suffix below is the only thing
 * standing between the two, so it is computed in one place and imported
 * everywhere rather than written out by hand.
 */

const TEST_SUFFIX = '_test';

/**
 * ⚠️ A DELIBERATELY SMALL CONNECTION POOL. Do not raise this to fix a test.
 *
 * Prisma sizes its pool from the machine: `physical_cores * 2 + 1`. A
 * developer laptop gets thirty-plus connections; a CI runner with two cores
 * gets five. That gap hid a real deadlock — code that held a transaction's
 * connection while asking the pool for a second one passed on every developer
 * machine and failed only in CI, where there was no slack.
 *
 * Pinning the tests to five makes the tight environment the one everybody
 * develops against, so that whole class of bug fails here, immediately, on the
 * machine of whoever wrote it. If a test starts timing out after this number,
 * the answer is almost always "something is holding a connection while waiting
 * for another one", not "the pool is too small".
 */
const TEST_CONNECTION_LIMIT = '5';

/** `postgresql://…/velixa_hr_dev` → `postgresql://…/velixa_hr_dev_test` */
export function testDatabaseUrl(source = process.env.DATABASE_URL): string {
  if (!source) {
    throw new Error(
      'DATABASE_URL is not set. Tests read it from the repo-root .env — run them ' +
        'through `npm test`, which loads that file, rather than calling jest directly.',
    );
  }

  const url = new URL(source);
  const name = url.pathname.replace(/^\//, '');

  if (!name) throw new Error(`DATABASE_URL has no database name: ${source}`);
  if (!name.endsWith(TEST_SUFFIX)) url.pathname = `/${name}${TEST_SUFFIX}`;

  url.searchParams.set('connection_limit', TEST_CONNECTION_LIMIT);
  return url.toString();
}

/** The administrative connection used only to CREATE the test database. */
export function maintenanceUrl(source = process.env.DATABASE_URL): string {
  const url = new URL(source as string);
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseName(source = process.env.DATABASE_URL): string {
  return new URL(testDatabaseUrl(source)).pathname.replace(/^\//, '');
}
