// Must be the first import — NestJS decorators depend on it at runtime.
import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Nest's own logger. Swap for a structured JSON logger (pino) when we
    // start shipping logs somewhere.
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('api.port', 4000);
  const corsOrigins = config.get<string[]>('api.corsOrigins', []);

  // Everything lives under /api EXCEPT the health check, which stays at the
  // root. Load balancers and uptime monitors conventionally probe /health.
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // Auth tokens travel as httpOnly cookies, so they must be parsed before any
  // guard tries to read them.
  app.use(cookieParser());

  // `credentials: true` is what allows the browser to send those cookies
  // cross-origin (web on :3000, API on :4000). Without it the browser silently
  // drops them and every request looks unauthenticated.
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Applies to every incoming request once we start defining DTOs.
  //   whitelist            — silently drop fields not declared on the DTO
  //   forbidNonWhitelisted — reject the request instead of dropping (safer)
  //   transform            — turn plain JSON into real class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Lets Nest run onModuleDestroy hooks (e.g. closing the DB pool) when the
  // process receives SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}`);
  logger.log(`Health check:     http://localhost:${port}/health`);
}

void bootstrap();
