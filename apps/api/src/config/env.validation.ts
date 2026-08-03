/**
 * Fails fast on start-up if required environment variables are missing or
 * malformed.
 *
 * The alternative is a server that boots "fine" and then throws a confusing
 * error on the first database query. This turns that into one clear message
 * before anything else happens.
 */

const REQUIRED_VARS = ['DATABASE_URL'] as const;

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
      ].join('\n'),
    );
  }

  const databaseUrl = String(config.DATABASE_URL);
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error(
      `DATABASE_URL must be a PostgreSQL connection string starting with "postgresql://". Received: "${databaseUrl.slice(0, 24)}..."`,
    );
  }

  const port = config.API_PORT;
  if (port !== undefined && Number.isNaN(Number(port))) {
    throw new Error(`API_PORT must be a number. Received: "${String(port)}"`);
  }

  return config;
}
