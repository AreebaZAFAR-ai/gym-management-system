// Read-only check of the Neon connections in api/.env.
// Prints host, database, Postgres version and existing tables. Never prints passwords
// and never changes anything in the database.
import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

const targets = [
  ['DATABASE_URL', 'pooled (used by the API)'],
  ['DATABASE_URL_DIRECT', 'direct (used by migrations)'],
];

let failed = false;

for (const [name, label] of targets) {
  const url = process.env[name];
  console.log(`\n${name}: ${label}`);
  if (!url || url.includes('<')) {
    console.log('  not set in api/.env');
    failed = true;
    continue;
  }

  let host = '?';
  try {
    host = new URL(url).hostname;
  } catch {
    console.log('  not a valid connection string');
    failed = true;
    continue;
  }
  const pooled = host.includes('-pooler');
  console.log(`  host: ${host}`);
  if (name === 'DATABASE_URL' && !pooled) console.log('  warning: expected the pooled host (contains "-pooler")');
  if (name === 'DATABASE_URL_DIRECT' && pooled) console.log('  warning: expected the direct host (no "-pooler")');

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    const info = await client.query(
      "select current_database() as db, current_user as usr, current_setting('server_version') as version",
    );
    const { db, usr, version } = info.rows[0];
    console.log(`  connected: database "${db}" as "${usr}", PostgreSQL ${version}`);
    const tables = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
    );
    const names = tables.rows.map((r) => r.table_name);
    console.log(`  existing tables in public: ${names.length ? names.join(', ') : '(none)'}`);
  } catch (err) {
    console.log(`  could not connect: ${err instanceof Error ? err.message : err}`);
    failed = true;
  } finally {
    await client.end().catch(() => {});
  }
}

process.exit(failed ? 1 : 0);
