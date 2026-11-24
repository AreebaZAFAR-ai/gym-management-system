import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ENV } from './config/config.module';
import { loadDotEnv, parseEnv, type Env } from './config/env';

async function bootstrap() {
  loadDotEnv();
  parseEnv(process.env); // fail fast with a readable list before Nest starts
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const { PORT } = app.get<Env>(ENV);
  await app.listen(PORT);
  Logger.log(`API listening on http://localhost:${PORT} (health: /health, routes: /v1)`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // Configuration errors are already readable; print them without a stack trace.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
