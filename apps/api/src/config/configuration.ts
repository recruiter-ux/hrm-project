/**
 * Turns flat environment variables into a typed, nested config object.
 *
 * Read anywhere in the app with:
 *   constructor(private readonly config: ConfigService) {}
 *   this.config.get<number>('api.port')
 *
 * Rule of thumb: `process.env` should appear ONLY in this file. Everything
 * else goes through ConfigService, so there is one place to look when an
 * environment variable is wrong.
 */
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',

  api: {
    port: parseInt(process.env.API_PORT ?? '4000', 10),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  database: {
    url: process.env.DATABASE_URL ?? '',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  auth: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },

  storage: {
    uploadDir: process.env.UPLOAD_DIR ?? './uploads',
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES ?? '10485760', 10),
  },

  /**
   * Where the web app lives. Notification emails contain absolute links back
   * into Velixa HR, and an email cannot use a relative one.
   */
  app: {
    webUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  },

  /**
   * Email delivery. See apps/api/src/notifications/email/email.service.ts.
   *
   * The default is deliberately different per environment:
   *   development — `file`, writing openable .eml files to EMAIL_OUTBOX_DIR,
   *                 so notification emails can be verified without a provider
   *   production  — `none`, so a deployment that forgot to configure SMTP
   *                 records SKIPPED deliveries rather than silently writing
   *                 mail to a directory nobody reads
   */
  email: {
    transport: (process.env.EMAIL_TRANSPORT ??
      (process.env.NODE_ENV === 'production' ? 'none' : 'file')) as 'file' | 'smtp' | 'none',
    from: process.env.EMAIL_FROM ?? 'Velixa HR <no-reply@velixa-hr.local>',
    outboxDir: process.env.EMAIL_OUTBOX_DIR ?? './outbox',
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
    },
  },

  notifications: {
    /** How often the outbox dispatcher looks for work. 0 disables the timer. */
    dispatchIntervalMs: parseInt(process.env.NOTIFICATION_DISPATCH_INTERVAL_MS ?? '15000', 10),
    /** Give up after this many tries and mark the delivery FAILED. */
    maxAttempts: parseInt(process.env.NOTIFICATION_MAX_ATTEMPTS ?? '5', 10),
    batchSize: parseInt(process.env.NOTIFICATION_BATCH_SIZE ?? '25', 10),
  },
});
