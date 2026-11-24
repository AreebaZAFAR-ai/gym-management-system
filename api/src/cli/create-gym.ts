import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadDotEnv } from '../config/env';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';
import { createGym, createGymInput, demoGym, seedDemoPlans } from '../setup/create-gym';

const USAGE =
  'Usage: OWNER_PASSWORD=<password> npm --workspace api run gym:create -- --id <slug> --name <name> --short <letters> ' +
  '--city <city> --color <app colour> --prefix <member prefix> --owner-name <name> --owner-phone <mobile>\n' +
  '       OWNER_PASSWORD=<password> npm --workspace api run gym:demo';

/**
 * Super-admin script (§2, §12 step 1). Uses DATABASE_URL_DIRECT from api/.env.
 * The owner password comes from OWNER_PASSWORD and is never printed; nor is the
 * check-in secret. `--demo` creates the §13 demo gym "demo" with three fee plans.
 */
async function main() {
  loadDotEnv();
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT is missing from api/.env');

  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!demo && !arg('id')) {
    console.error(USAGE);
    process.exit(2);
  }
  const input = demo
    ? demoGym(process.env.OWNER_PASSWORD ?? '')
    : {
        id: arg('id') ?? '', name: arg('name') ?? '', short: arg('short') ?? '', city: arg('city') ?? '',
        primaryColor: arg('color') ?? '', memberPrefix: arg('prefix') ?? '', ownerName: arg('owner-name') ?? '',
        ownerPhone: arg('owner-phone') ?? '', ownerPassword: process.env.OWNER_PASSWORD ?? '',
      };
  createGymInput.parse(input); // report every problem before connecting

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Database;
    const result = await createGym(db, input);
    if (demo) await seedDemoPlans(db, result.gymId);
    console.log(`Created gym "${result.gymId}" and its owner.`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const issues = (err as { issues?: { message: string }[] }).issues;
  console.error(issues ? issues.map((i) => `- ${i.message}`).join('\n') : err instanceof Error ? err.message : err);
  process.exit(1);
});
