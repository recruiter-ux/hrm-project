/**
 * Runs inside every Jest worker, before anything else is imported.
 *
 * Its whole job is to make the test process point at the test database and
 * behave predictably. `setupFiles` (not `setupFilesAfterEach`) matters here:
 * PrismaClient reads DATABASE_URL when it is constructed, so the override has
 * to land before any module that imports it.
 */
import { testDatabaseUrl } from './test-database';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';

// ⚠️ NO BACKGROUND TIMER. The dispatcher would otherwise fire mid-assertion
// and a test checking "still PENDING" would fail depending on timing. Tests
// call `dispatcher.drain()` explicitly, so sending is deterministic.
process.env.NOTIFICATION_DISPATCH_INTERVAL_MS = '0';

// Emails are produced in full and written to a throwaway directory, so the
// tests exercise the real rendering and the real transport rather than a
// stub. Individual tests swap in a failing transport where that is the point.
process.env.EMAIL_TRANSPORT = 'file';
process.env.EMAIL_OUTBOX_DIR = './test-outbox';
process.env.EMAIL_FROM = 'Velixa HR <no-reply@velixa-hr.test>';
process.env.WEB_APP_URL = 'http://localhost:3000';

// Long enough to satisfy env validation; these are throwaway test values.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-111111';
