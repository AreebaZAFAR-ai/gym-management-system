import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ENV } from '../../src/config/config.module';
import { parseEnv, type Env } from '../../src/config/env';
import { DB, PG_POOL, type Database } from '../../src/db/db.module';
import * as schema from '../../src/db/schema';

/** Test settings. Tests never touch Neon: the database is in-memory PGlite. */
export const TEST_ENV: Env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused@localhost/unused',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-validation',
  CORS_ORIGINS: 'http://admin.test',
});

export interface TestContext {
  app: INestApplication;
  db: Database;
  pglite: PGlite;
}

export async function createTestApp(): Promise<TestContext> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema }) as unknown as Database;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(TEST_ENV)
    .overrideProvider(PG_POOL)
    .useValue({ end: async () => {} })
    .overrideProvider(DB)
    .useValue(db)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return { app, db, pglite };
}

export async function closeTestApp(ctx: TestContext | undefined) {
  if (!ctx) return;
  await ctx.app.close();
  await ctx.pglite.close();
}
