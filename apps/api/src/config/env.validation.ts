/**
 * Fails fast on start-up if required environment variables are missing or
 * malformed.
 *
 * The alternative is a server that boots "fine" and then throws a confusing
 * error on the first database query — or worse, one that runs in production
 * signing tokens with the placeholder secret from .env.example.
 */

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

/** Any secret containing this is a copy-paste from .env.example. */
const PLACEHOLDER_MARKER = 'replace-me';

const MIN_SECRET_LENGTH = 32;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_VARS.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || String(value).trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required environment variable(s): ${missing.join(', ')}.`,
        '',
        'Fix: copy .env.example to .env in the repo root and fill in the values.',
        '  Windows PowerShell:  Copy-Item .env.example .env',
        '  macOS / Linux:       cp .env.example .env',
        '',
        'Generate a secret with:',
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
      ].join('\n'),
    );
  }

  const databaseUrl = String(config.DATABASE_URL);
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error(
      `DATABASE_URL must be a PostgreSQL connection string starting with "postgresql://". Received: "${databaseUrl.slice(0, 24)}..."`,
    );
  }

  // --- Token secrets --------------------------------------------------------
  const isProduction = String(config.NODE_ENV ?? 'development') === 'production';

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const secret = String(config[key]);

    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `${key} must be at least ${MIN_SECRET_LENGTH} characters. It is currently ${secret.length}.`,
      );
    }

    if (isProduction && secret.includes(PLACEHOLDER_MARKER)) {
      throw new Error(
        `${key} still contains the placeholder value from .env.example. Generate a real secret before running in production.`,
      );
    }
  }

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different. Using one secret for both means a leaked access-token key also mints refresh tokens.',
    );
  }

  const port = config.API_PORT;
  if (port !== undefined && Number.isNaN(Number(port))) {
    throw new Error(`API_PORT must be a number. Received: "${String(port)}"`);
  }

  // --- Email (Phase 2) ------------------------------------------------------
  // A typo in EMAIL_TRANSPORT must not fall through to "send nothing and say
  // nothing" — that is exactly the failure that makes people believe emails
  // went out when they did not.
  const transport = config.EMAIL_TRANSPORT;
  if (transport !== undefined && !['file', 'smtp', 'none'].includes(String(transport))) {
    throw new Error(
      `EMAIL_TRANSPORT must be one of: file, smtp, none. Received: "${String(transport)}"`,
    );
  }

  if (String(transport) === 'smtp' && !String(config.SMTP_HOST ?? '').trim()) {
    throw new Error('EMAIL_TRANSPORT=smtp requires SMTP_HOST to be set.');
  }

  return config;
}
