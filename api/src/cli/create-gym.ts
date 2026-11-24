import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadDotEnv } from '../config/env';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';
import { createGym, createGymInput, DEMO_GYM, seedDemoPlans } from '../setup/create-gym';

/**
 * Super-admin script (§2, §12). Uses DATABASE_URL_DIRECT from api/.env.
 *
 *   npm --workspace api run gym:create -- --id ironhouse --name "Iron House Fitness" --short IH \
 *     --city Lahore --prefix IH --owner-name "Kamran Iqbal" --owner-phone 03451234567 [--color #17191C]
 *   npm --workspace api run gym:demo        (the §13 demo gym "demo" with three fee plans)
 *
 * Prints the owner's password once (generated if not given). The check-in secret is never printed.
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
    console.error(
      'Usage: npm --workspace api run gym:create -- --id <slug> --name <name> --short <letters> --city <city> ' +
        '--prefix <member prefix> --owner-name <name> --owner-phone <mobile> [--color #17191C]\n' +
        '       npm --workspace api run gym:demo',
    );
    process.exit(2);
  }
  const input = demo
    ? DEMO_GYM
    : createGymInput.parse({
        id: arg('id'), name: arg('name'), short: arg('short'), city: arg('city'), primaryColor: arg('color'),
        memberPrefix: arg('prefix'), ownerName: arg('owner-name'), ownerPhone: arg('owner-phone') ?? '',
        ownerPassword: process.env.OWNER_PASSWORD,
      });

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Database;
    const result = await createGym(db, input);
    if (demo) await seedDemoPlans(db, result.gymId);
    console.log(`Created gym "${result.gymId}" and its owner.`);
    console.log(`Owner login: gym ${result.gymId}, phone ${input.ownerPhone}, password ${result.ownerPassword}`);
    console.log('Ask the owner to change this password after the first login.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const issues = (err as { issues?: { message: string }[] }).issues;
  console.error(issues ? issues.map((i) => `- ${i.message}`).join('\n') : err instanceof Error ? err.message : err);
  process.exit(1);
});
