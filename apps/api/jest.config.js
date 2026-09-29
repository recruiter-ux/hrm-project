/**
 * =============================================================================
 * Velixa HR — test runner configuration
 *
 * Run with:
 *   npm test                  everything (needs Postgres running)
 *   npm run test:unit         pure logic only, no database, very fast
 *   npm run test:watch        re-runs on save while you work
 *
 * TWO KINDS OF TEST LIVE HERE, and the split is deliberate:
 *
 *   src/ **.spec.ts    UNIT. Pure functions and arithmetic. No database, no
 *                      HTTP. Milliseconds. This is where the day-counting and
 *                      proration maths are pinned down.
 *
 *   test/ **.spec.ts   INTEGRATION. A real NestJS app against a real Postgres,
 *                      driven over real HTTP with real logins. This is where
 *                      the things that actually broke in manual testing get
 *                      caught: permission scopes, the exclusion constraint,
 *                      balance arithmetic across a request's whole lifecycle,
 *                      and duplicate notifications.
 *
 * Integration tests use a SEPARATE DATABASE (velixa_hr_test), created and
 * migrated automatically by test/global-setup.ts. Your development data is
 * never touched.
 * =============================================================================
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    // @nestjs/jwt v12 ships as ES modules only, and Jest runs CommonJS. Without
    // this, importing AppModule dies on "Cannot use import statement outside a
    // module" — nothing to do with our code. Compiling that one package down to
    // CommonJS is far less disruptive than switching the whole suite to ESM.
    '^.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'ES2023', esModuleInterop: true } },
    ],
  },
  // Everything in node_modules is left alone EXCEPT @nestjs/jwt, per above.
  // The character class covers both path separators, because Windows.
  transformIgnorePatterns: ['node_modules[\\\\/](?!@nestjs[\\\\/]jwt)'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Points DATABASE_URL at the test database before anything imports Prisma.
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // Creates and migrates that database once, before the whole run.
  globalSetup: '<rootDir>/test/global-setup.ts',

  // ⚠️ ONE WORKER, ON PURPOSE. Every integration test resets the same database
  // to a known fixture. Run them in parallel and one test truncates the tables
  // another is halfway through using, producing failures that look like real
  // bugs and vanish when you re-run them.
  maxWorkers: 1,

  // Spinning up a Nest app and migrating a database is slower than a unit test.
  testTimeout: 30_000,

  clearMocks: true,
  // Nest logs a lot at boot; the harness silences it, and this keeps the
  // summary readable when something does go wrong.
  verbose: true,
};
