/**
 * Database commands (run from api/, or the repo root with npm run db:<command>):
 *
 *   db:status   read-only: target database, applied and pending migrations, problems
 *   db:backup   export every table to api/backups/<database>-<time>.json
 *   db:migrate  backup, then apply pending migrations safely, then show the status
 *               --allow-destructive          permit DROP TABLE/SCHEMA/COLUMN, TRUNCATE,
 *                                            DELETE without WHERE, ALTER COLUMN … TYPE
 *               --confirm-database=<name>    the typed confirmation, when not interactive
 *
 * Uses DATABASE_URL_DIRECT (or DATABASE_URL) from the environment or api/.env. Never prints
 * a password or a full connection string. Never uses `drizzle-kit push`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Client } from 'pg';
import { loadDotEnv } from '../config/env';
import {
  acquireLock,
  applyMigration,
  backupDatabase,
  ensureMigrationsTable,
  type Finding,
  MigrationError,
  planMigrations,
  readApplied,
  readMigrations,
  releaseLock,
  scanDestructive,
  type Plan,
  type SqlClient,
} from '../db/migrator';

/** api/ (the folder whose package.json is @gym/api), from src/cli or dist/api/src/cli. */
function apiRoot(): string {
  for (let dir = __dirname; dir !== dirname(dir); dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@gym/api') return dir;
  }
  throw new Error('Could not find the api/ folder.');
}

interface Target {
  url: string;
  host: string;
  database: string;
  variable: string;
}

function target(): Target {
  const variable = process.env.DATABASE_URL_DIRECT ? 'DATABASE_URL_DIRECT' : 'DATABASE_URL';
  const url = process.env[variable];
  if (!url || url.includes('<')) throw new Error('Set DATABASE_URL_DIRECT (or DATABASE_URL) in api/.env or the environment.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${variable} is not a valid connection string.`);
  }
  return { url, host: parsed.hostname, database: decodeURIComponent(parsed.pathname.slice(1)) || '(default)', variable };
}

const say = (s = '') => console.log(s);

function describe(t: Target) {
  say(`Database: ${t.database} on ${t.host} (from ${t.variable})`);
  if (t.host.includes('-pooler')) {
    say('  Warning: this is a pooled connection. Use DATABASE_URL_DIRECT for migrations so the migration lock works.');
  }
}

function printPlan(p: Plan, total: number) {
  say(`Migrations in drizzle/: ${total}`);
  say(`Applied (${p.applied.length}):`);
  for (const m of p.applied) say(`  ✓ ${m.tag}${p.edited.includes(m) ? '   ← FILE EDITED AFTER IT RAN' : ''}`);
  say(`Pending (${p.pending.length}):`);
  if (!p.pending.length) say('  (none)');
  for (const m of p.pending) say(`  • ${m.tag}${p.outOfOrder.includes(m) ? '   ← older than an applied migration' : ''}`);
  for (const r of p.unknown) say(`  ? the database records a migration this code does not have (created_at ${r.createdAt})`);
}

/** Problems that make migrating unsafe. Each is a plain message. */
function problems(p: Plan): string[] {
  const out: string[] = [];
  for (const m of p.edited) {
    out.push(
      `${m.tag}.sql was edited after it was applied (its hash no longer matches). Never edit an applied ` +
        'migration: restore the file (git checkout) and write a new migration for the change.',
    );
  }
  for (const m of p.outOfOrder) {
    out.push(`${m.tag} is pending but older than a migration already applied. Regenerate it (db:generate) so it comes last.`);
  }
  if (p.unknown.length) {
    out.push(`The database has ${p.unknown.length} migration(s) this code does not know. Is newer code deployed? Update this branch first.`);
  }
  return out;
}

async function connect(t: Target): Promise<Client> {
  const client = new Client({ connectionString: t.url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  return client;
}

async function status(t: Target, folder: string): Promise<number> {
  describe(t);
  const client = await connect(t);
  try {
    await client.query('BEGIN READ ONLY');
    const rows = await readApplied(client);
    await client.query('ROLLBACK');
    const migrations = readMigrations(folder);
    const plan = planMigrations(migrations, rows);
    printPlan(plan, migrations.length);
    const issues = problems(plan);
    for (const i of issues) say(`Problem: ${i}`);
    return issues.length ? 1 : 0;
  } finally {
    await client.end();
  }
}

async function backup(t: Target, dir: string, client?: SqlClient): Promise<string> {
  const own = client ? null : await connect(t);
  try {
    const result = await backupDatabase(client ?? own!, dir, { host: t.host, database: t.database });
    const rows = result.tables.reduce((n, x) => n + x.rows, 0);
    say(`Backup written: ${result.file}`);
    say(`  ${result.tables.length} tables, ${rows} rows, ${(result.bytes / 1024).toFixed(1)} KB`);
    return result.file;
  } finally {
    await own?.end();
  }
}

async function confirmDatabase(database: string, given: string | undefined): Promise<boolean> {
  if (given !== undefined) return given === database;
  if (!process.stdin.isTTY) {
    say(`Not interactive: pass --confirm-database=${database} to confirm.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`Type the database name (${database}) to apply destructive migrations: `)).trim() === database;
  } finally {
    rl.close();
  }
}

function printFindings(findings: Finding[], root: string) {
  for (const f of findings) say(`  ${relative(root, f.file)}:${f.line}  ${f.rule}  →  ${f.text}`);
}

async function migrate(t: Target, folder: string, backupDir: string, root: string, flags: Flags): Promise<number> {
  describe(t);
  const migrations = readMigrations(folder);
  const client = await connect(t);
  let backupFile: string | null = null;
  const applied: string[] = [];
  try {
    await acquireLock(client);
    try {
      const plan = planMigrations(migrations, await readApplied(client));
      const issues = problems(plan);
      if (issues.length) {
        for (const i of issues) say(`STOPPED: ${i}`);
        return 1;
      }
      if (!plan.pending.length) {
        say(`Nothing to apply: all ${plan.applied.length} migrations are already applied. No backup needed.`);
        return 0;
      }

      const findings = plan.pending.flatMap((m) => scanDestructive(m.sql, m.file));
      if (findings.length) {
        if (!flags.allowDestructive) {
          say('STOPPED: pending migrations contain destructive SQL:');
          printFindings(findings, root);
          say('Review them. To apply anyway, run db:migrate -- --allow-destructive (it asks you to type the database name).');
          return 1;
        }
        say('Destructive SQL allowed by --allow-destructive:');
        printFindings(findings, root);
        if (!(await confirmDatabase(t.database, flags.confirmDatabase))) {
          say('STOPPED: the database name was not confirmed. Nothing was changed.');
          return 1;
        }
      }

      say(`Backing up before applying ${plan.pending.length} migration(s)…`);
      try {
        backupFile = await backup(t, backupDir, client);
      } catch (err) {
        say(`STOPPED: the backup failed, so nothing was applied. ${err instanceof Error ? err.message : err}`);
        return 1;
      }

      await ensureMigrationsTable(client);
      for (const m of plan.pending) {
        say(`Applying ${m.tag}…`);
        try {
          await applyMigration(client, m);
          applied.push(m.tag);
        } catch (err) {
          const e = err instanceof MigrationError ? err : new MigrationError(m.tag, 0, err);
          say(`FAILED: ${e.message}`);
          say(`  ${m.tag} was rolled back: the database is as it was before it.`);
          if (applied.length) say(`  Applied earlier in this run (kept): ${applied.join(', ')}`);
          say(`  Not applied: ${plan.pending.slice(plan.pending.indexOf(m)).map((x) => x.tag).join(', ')}`);
          say(`  Backup from before this run: ${backupFile}`);
          return 1;
        }
      }

      say();
      say('Summary');
      say(`  Applied (${applied.length}): ${applied.join(', ')}`);
      say(`  Skipped, already applied (${plan.applied.length}): ${plan.applied.map((m) => m.tag).join(', ') || '(none)'}`);
      say(`  Backup: ${backupFile}`);
      return 0;
    } finally {
      await releaseLock(client).catch(() => {});
    }
  } finally {
    await client.end();
  }
}

interface Flags {
  allowDestructive: boolean;
  confirmDatabase?: string;
  migrations?: string;
  backups?: string;
}

function parseFlags(args: string[]): Flags {
  const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    allowDestructive: args.includes('--allow-destructive'),
    confirmDatabase: value('confirm-database'),
    migrations: value('migrations'),
    backups: value('backups'),
  };
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const root = apiRoot();
  loadDotEnv(root); // never overrides variables already set (a host's env wins)
  const flags = parseFlags(rest);
  const folder = resolve(root, flags.migrations ?? 'drizzle');
  const backupDir = resolve(root, flags.backups ?? 'backups');
  const t = target();

  switch (command) {
    case 'status':
      return status(t, folder);
    case 'backup':
      describe(t);
      await backup(t, backupDir);
      return 0;
    case 'migrate': {
      const code = await migrate(t, folder, backupDir, root, flags);
      say();
      say('Status after migrate:');
      const after = await status(t, folder);
      return code || after;
    }
    default:
      say('Usage: db <status | backup | migrate [--allow-destructive] [--confirm-database=<name>]>');
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Messages from pg never include the password; still, never print the URL itself.
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
