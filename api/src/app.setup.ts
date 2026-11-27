import type { INestApplication } from '@nestjs/common';
import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ErrorFilter } from './common/error.filter';
import { ENV } from './config/config.module';
import { corsOrigins, type Env } from './config/env';

/** Shared by main.ts and the tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  (app as NestExpressApplication).disable('x-powered-by');
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new ErrorFilter());

  if (env.NODE_ENV === 'production') requireHttps(app as NestExpressApplication);

  // §11: weak gym Wi-Fi and 4G. Brotli when the client accepts it, otherwise gzip;
  // responses under 1 KB are sent as they are.
  app.use(compression());

  // The mobile app does not need CORS. Browsers (the web admin) only from the listed origins.
  const origins = corsOrigins(env);
  app.enableCors({ origin: origins.length ? origins : env.NODE_ENV !== 'production' });
  app.enableShutdownHooks();
}

export const HTTPS_REQUIRED = 'HTTPS is required.';

/**
 * §11 Security: "HTTPS only in production". The API runs behind the host's TLS proxy
 * (Railway, Render, nginx), which reports the original scheme in X-Forwarded-Proto.
 * Plain-HTTP requests are refused, and browsers are told to use HTTPS (HSTS).
 * /health stays reachable for the host's internal health checks.
 */
function requireHttps(app: NestExpressApplication): void {
  app.set('trust proxy', 1);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      return next();
    }
    res.status(403).json({ message: HTTPS_REQUIRED });
  });
}
