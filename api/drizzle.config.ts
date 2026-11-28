import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

// Migrations use the direct connection; DATABASE_URL only if there is no direct one.
// `drizzle-kit generate` reads the schema files and never connects.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL_DIRECT (or DATABASE_URL) is missing from api/.env.');
}

/**
 * Used only by `npm run db:generate` (drizzle-kit generate), which writes a new SQL file
 * in ./drizzle to review and commit. Migrations are applied by `npm run db:migrate`
 * (src/cli/db.ts), never by drizzle-kit. Never use `drizzle-kit push`: it can drop
 * tables and columns without a reviewable file.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
