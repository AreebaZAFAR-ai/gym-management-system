import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorFilter } from './common/error.filter';
import { ENV } from './config/config.module';
import { corsOrigins, type Env } from './config/env';

/** Shared by main.ts and the tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  (app as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new ErrorFilter());

  // The mobile app does not need CORS. Browsers (the web admin) only from the listed origins.
  const origins = corsOrigins(env);
  app.enableCors({ origin: origins.length ? origins : env.NODE_ENV !== 'production' });
  app.enableShutdownHooks();
}
