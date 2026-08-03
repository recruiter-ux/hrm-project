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
});
