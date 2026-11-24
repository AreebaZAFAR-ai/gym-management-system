import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from '../../src/db/db.module';
import * as schema from '../../src/db/schema';

export const MIGRATIONS_FOLDER = resolve(__dirname, '../../drizzle');

/** In-memory Postgres with the committed migrations applied (the same SQL Neon gets). */
export async function createTestDb(): Promise<{ db: Database; pglite: PGlite }> {
  const pglite = new PGlite();
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: pgliteDb as unknown as Database, pglite };
}
