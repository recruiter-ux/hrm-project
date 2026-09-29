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
  if (name.endsWith(TEST_SUFFIX)) return source;

  url.pathname = `/${name}${TEST_SUFFIX}`;
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
