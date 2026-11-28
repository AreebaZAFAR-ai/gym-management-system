/**
 * Safe migration runner for the SQL files in api/drizzle (written by `drizzle-kit generate`).
 *
 * Bookkeeping is Drizzle's own table, drizzle.__drizzle_migrations (hash = SHA-256 of the
 * SQL file, created_at = the journal's "when"), so it stays compatible with Drizzle. Unlike
 * `drizzle-kit migrate` it:
 *   - checks every applied migration's hash, so an edited applied migration is caught;
 *   - refuses destructive SQL unless explicitly allowed;
 *   - runs each migration in its own transaction (a failure leaves the database as it was
 *     before that migration);
 *   - holds a Postgres advisory lock so two runs (two deploys) cannot migrate at once.
 * `drizzle-kit push` is never used.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The part of a Postgres client this module uses (pg's Client; a PGlite adapter in tests). */
export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Migration {
  idx: number;
  tag: string;
  /** Journal "when": Drizzle stores it as created_at. */
  when: number;
  file: string;
  sql: string;
}

export interface AppliedRow {
  hash: string;
  createdAt: number;
}

export interface Plan {
  applied: Migration[];
  pending: Migration[];
  /** Applied migrations whose file no longer matches the hash recorded when it ran. */
  edited: Migration[];
  /** Pending migrations older than the newest applied one (Drizzle would silently skip them). */
  outOfOrder: Migration[];
  /** Rows in the database with no matching migration file (newer code ran here?). */
  unknown: AppliedRow[];
}

export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';
const BREAKPOINT = '--> statement-breakpoint';
/** Arbitrary constant: the advisory lock id shared by every migration run of this project. */
export const MIGRATION_LOCK_ID = 7_243_900_211;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Drizzle's hash: SHA-256 of the whole SQL file, exactly as read. */
export const migrationHash = (sql: string) => sha256(sql);

/**
 * True when the recorded hash matches the file. Line endings alone (a Windows checkout
 * with core.autocrlf) do not count as an edit.
 */
export function hashMatches(recorded: string, sql: string): boolean {
  const lf = sql.replace(/\r\n/g, '\n');
  return [sql, lf, lf.replace(/\n/g, '\r\n')].some((v) => sha256(v) === recorded);
}

/** Migrations listed in drizzle/meta/_journal.json, in order, with their SQL. */
export function readMigrations(folder: string): Migration[] {
  const journalPath = join(folder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) throw new Error(`No migration journal at ${journalPath}.`);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };
  return journal.entries.map((e, i) => {
    if (e.idx !== i) throw new Error(`Migration journal is out of order at entry ${i} (${e.tag}).`);
    const file = join(folder, `${e.tag}.sql`);
    if (!existsSync(file)) throw new Error(`Migration file missing: ${e.tag}.sql (listed in the journal).`);
    return { idx: e.idx, tag: e.tag, when: e.when, file, sql: readFileSync(file).toString() };
  });
}

/** Rows of drizzle.__drizzle_migrations; empty when the table does not exist yet. */
export async function readApplied(client: SqlClient): Promise<AppliedRow[]> {
  const [exists] = (await client.query<{ t: boolean }>(
    `select to_regclass('"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"') is not null as t`,
  )).rows;
  if (!exists?.t) return [];
  const rows = (await client.query<{ hash: string; created_at: string | number }>(
    `select hash, created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at`,
  )).rows;
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

export function planMigrations(migrations: Migration[], rows: AppliedRow[]): Plan {
  const applied: Migration[] = [];
  const pending: Migration[] = [];
  const edited: Migration[] = [];
  for (const m of migrations) {
    const row = rows.find((r) => r.createdAt === m.when);
    if (!row) pending.push(m);
    else {
      applied.push(m);
      if (!hashMatches(row.hash, m.sql)) edited.push(m);
    }
  }
  const newestApplied = Math.max(0, ...applied.map((m) => m.when));
  return {
    applied,
    pending,
    edited,
    outOfOrder: pending.filter((m) => m.when < newestApplied),
    unknown: rows.filter((r) => !migrations.some((m) => m.when === r.createdAt)),
  };
}

// ---------------------------------------------------------------- destructive SQL guard

export interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/**
 * Blanks out comments and single-quoted strings, keeping every newline (so line numbers stay
 * right). Dollar-quoted bodies stay: a DO $$ … $$ block runs during the migration.
 */
function stripCommentsAndStrings(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') { out += ' '; i++; }
      if (i < sql.length) out += '\n';
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += sql.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (c === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += sql.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j;
    } else {
      out += c;
    }
  }
  return out;
}

const NAME = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const RULES: { rule: string; re: RegExp }[] = [
  { rule: 'DROP TABLE', re: /\bDROP\s+TABLE\b/gi },
  { rule: 'DROP SCHEMA', re: /\bDROP\s+SCHEMA\b/gi },
  { rule: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/gi },
  // TRUNCATE as a command; "BEFORE TRUNCATE ON …" in a trigger definition is not one.
  { rule: 'TRUNCATE', re: /(?<!\b(?:BEFORE|AFTER|OR|INSTEAD\s+OF)\s+)\bTRUNCATE\b/gi },
  // ALTER [COLUMN] name [SET DATA] TYPE …
  { rule: 'ALTER COLUMN … TYPE', re: new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${NAME}\s+(?:SET\s+DATA\s+)?TYPE\b`, 'gi') },
];

/** Destructive statements in one migration's SQL: what --allow-destructive is needed for. */
export function scanDestructive(sql: string, file: string): Finding[] {
  const clean = stripCommentsAndStrings(sql);
  const lines = sql.split(/\r?\n/);
  const lineAt = (index: number) => clean.slice(0, index).split('\n').length;
  const found: Finding[] = [];
  const add = (rule: string, index: number) => {
    const line = lineAt(index);
    found.push({ file, line, rule, text: (lines[line - 1] ?? '').trim() });
  };
  for (const { rule, re } of RULES) for (const m of clean.matchAll(re)) add(rule, m.index);

  // Statement-level rules: split on ';' (comments and strings are already blank).
  let start = 0;
  for (const stmt of clean.split(';')) {
    const del = /\bDELETE\s+FROM\b/i.exec(stmt);
    if (del && !/\bWHERE\b/i.test(stmt.slice(del.index))) add('DELETE without WHERE', start + del.index);
    // ALTER TABLE t DROP c (COLUMN is optional in Postgres); DROP CONSTRAINT / DEFAULT / NOT NULL are fine.
    if (/^\s*ALTER\s+TABLE\b/i.test(stmt)) {
      for (const d of stmt.matchAll(new RegExp(String.raw`\bDROP\s+(?!COLUMN\b|CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)(?:IF\s+EXISTS\s+)?${NAME}`, 'gi'))) {
        add('DROP COLUMN', start + d.index);
      }
    }
    start += stmt.length + 1;
  }
  return found.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------- lock, apply, backup

/** Waits up to `waitMs` for the migration lock (one session-level advisory lock). */
export async function acquireLock(client: SqlClient, waitMs = 60_000, pollMs = 2_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const [r] = (await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(${MIGRATION_LOCK_ID}) as ok`)).rows;
    if (r?.ok) return;
    if (Date.now() >= deadline) {
      throw new Error('Another migration run holds the migration lock (another deploy?). Try again when it has finished.');
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

export async function releaseLock(client: SqlClient): Promise<void> {
  await client.query(`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
}

export async function ensureMigrationsTable(client: SqlClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
}

export class MigrationError extends Error {
  constructor(
    readonly tag: string,
    readonly statement: number,
    readonly reason: unknown,
  ) {
    super(`${tag} failed at statement ${statement}: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

/**
 * Applies one migration in its own transaction and records it. On any error the whole
 * migration is rolled back, so the database is as it was before it.
 */
export async function applyMigration(client: SqlClient, m: Migration): Promise<void> {
  const statements = m.sql.split(BREAKPOINT).map((s) => s.trim()).filter(Boolean);
  await client.query('BEGIN');
  let n = 0;
  try {
    for (const s of statements) {
      n++;
      await client.query(s);
    }
    n++;
    await client.query(
      `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) values ($1, $2)`,
      [migrationHash(m.sql), m.when],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw new MigrationError(m.tag, n, err);
  }
}

export interface BackupResult {
  file: string;
  bytes: number;
  tables: { name: string; rows: number }[];
}

/**
 * Exports every table of the public and drizzle schemas to one JSON file, from one
 * consistent snapshot (REPEATABLE READ, read-only). Written to a temporary name, read
 * back and checked, then renamed: a half-written file is never left under the final name.
 */
export async function backupDatabase(
  client: SqlClient,
  dir: string,
  meta: { host: string; database: string },
  now = new Date(),
): Promise<BackupResult> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  const safeDb = meta.database.replace(/[^\w.-]/g, '_');
  const file = join(dir, `${safeDb}-${stamp}.json`);
  const tmp = `${file}.partial`;

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables: { name: string; rows: unknown[] }[] = [];
  try {
    const list = (await client.query<{ s: string; t: string }>(
      `select table_schema as s, table_name as t from information_schema.tables
       where table_schema in ('public', '${MIGRATIONS_SCHEMA}') and table_type = 'BASE TABLE' order by 1, 2`,
    )).rows;
    for (const { s, t } of list) {
      const q = `select coalesce(json_agg(x), '[]'::json) as rows from "${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}" x`;
      const [r] = (await client.query<{ rows: unknown }>(q)).rows;
      const rows = typeof r?.rows === 'string' ? (JSON.parse(r.rows) as unknown[]) : ((r?.rows as unknown[]) ?? []);
      tables.push({ name: `${s}.${t}`, rows });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }

  const doc = {
    format: 'gym-api-backup/1',
    takenAt: now.toISOString(),
    host: meta.host,
    database: meta.database,
    note: 'One JSON array of rows per table, from one consistent snapshot. Restore by inserting rows table by table.',
    tables: Object.fromEntries(tables.map((t) => [t.name, t.rows])),
  };
  writeFileSync(tmp, JSON.stringify(doc));
  // Verify before trusting it: parse it back and compare row counts.
  const check = JSON.parse(readFileSync(tmp, 'utf8')) as { tables: Record<string, unknown[]> };
  for (const t of tables) {
    if (check.tables[t.name]?.length !== t.rows.length) throw new Error(`Backup check failed for table ${t.name}.`);
  }
  renameSync(tmp, file);
  return { file, bytes: statSync(file).size, tables: tables.map((t) => ({ name: t.name, rows: t.rows.length })) };
}
