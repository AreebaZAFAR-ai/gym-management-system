import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error(
    'DATABASE_URL_DIRECT is missing from api/.env. Migrations use the Neon direct connection, not the pooled one.',
  );
}

/**
 * Migrations only (`npm run db:generate`, `npm run db:migrate`).
 * Generated SQL in ./drizzle is reviewed and committed before it is applied.
 * Do not use `drizzle-kit push`: it can drop columns without a reviewable file.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
