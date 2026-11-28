import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquireLock,
  applyMigration,
  backupDatabase,
  ensureMigrationsTable,
  hashMatches,
  MIGRATION_LOCK_ID,
  MigrationError,
  migrationHash,
  planMigrations,
  readApplied,
  readMigrations,
  scanDestructive,
  type SqlClient,
} from '../src/db/migrator';
import { createTestDb, MIGRATIONS_FOLDER } from './helpers/db';

/** PGlite as the runner's client: parameterised queries via query(), anything else via exec(). */
const adapter = (db: PGlite): SqlClient => ({
  query: async <T,>(sql: string, params?: unknown[]) =>
    params?.length ? ((await db.query(sql, params)) as { rows: T[] }) : { rows: ((await db.exec(sql)).at(-1)?.rows ?? []) as T[] },
});

describe('destructive SQL guard', () => {
  it('finds nothing in the existing migrations (no false alarms)', () => {
    for (const m of readMigrations(MIGRATIONS_FOLDER)) expect(scanDestructive(m.sql, m.file)).toEqual([]);
  });

  it('names each destructive statement with its line', () => {
    const sql = [
      '-- DROP TABLE in a comment is fine',
      "INSERT INTO notes (body) VALUES ('please DROP TABLE x; TRUNCATE y');",
      'DROP TABLE "old";',
      'DROP SCHEMA legacy CASCADE;',
      'ALTER TABLE "members" DROP COLUMN "notes";',
      'ALTER TABLE "members" DROP "goal";',
      'TRUNCATE "checkins";',
      'DELETE FROM "payments";',
      'DELETE FROM "checkins" WHERE created_at < now() - interval \'1 year\';',
      'ALTER TABLE "members" ALTER COLUMN "code" SET DATA TYPE varchar(20);',
      'ALTER TABLE "members" ALTER "code" TYPE text;',
      'ALTER TABLE "members" ALTER COLUMN "due_on" DROP NOT NULL;',
      'ALTER TABLE "members" DROP CONSTRAINT "x";',
      'CREATE TRIGGER t BEFORE TRUNCATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION f();',
      'DO $$ BEGIN DELETE FROM users; END $$;',
    ].join('\n');
    const found = scanDestructive(sql, 'x.sql').map((f) => `${f.line} ${f.rule}`);
    expect(found).toEqual([
      '3 DROP TABLE', '4 DROP SCHEMA', '5 DROP COLUMN', '6 DROP COLUMN', '7 TRUNCATE', '8 DELETE without WHERE',
      '10 ALTER COLUMN … TYPE', '11 ALTER COLUMN … TYPE', '15 DELETE without WHERE',
    ]);
  });
});

describe('migration lock', () => {
  // PGlite has one session, where advisory locks are re-entrant, so the "another session
  // holds it" case is shown with a fake client that answers like Postgres would.
  const fake = (answers: boolean[]) => {
    const sql: string[] = [];
    const client: SqlClient = {
      query: async <T,>(q: string) => {
        sql.push(q);
        return { rows: [{ ok: answers.shift() ?? false }] as T[] };
      },
    };
    return { client, sql };
  };

  it('waits while another run holds the lock, then takes it', async () => {
    const { client, sql } = fake([false, false, true]);
    await acquireLock(client, 1_000, 1);
    expect(sql).toEqual(Array(3).fill(`select pg_try_advisory_lock(${MIGRATION_LOCK_ID}) as ok`));
  });

  it('gives up with a plain message when the lock stays taken', async () => {
    const { client } = fake([]);
    await expect(acquireLock(client, 20, 5)).rejects.toThrow('Another migration run holds the migration lock (another deploy?). Try again when it has finished.');
  });
});

describe('hashes', () => {
  it("matches Drizzle's hash, and line endings alone are not an edit", () => {
    const sql = 'CREATE TABLE a (id int);\n--> statement-breakpoint\nCREATE TABLE b (id int);\n';
    expect(hashMatches(migrationHash(sql), sql.replace(/\n/g, '\r\n'))).toBe(true);
    expect(hashMatches(migrationHash(sql), sql.replace('b', 'c'))).toBe(false);
  });
});

describe('runner on a fresh database', () => {
  let db: PGlite;
  let client: SqlClient;
  let tmp: string;
  let folder: string;

  beforeAll(() => {
    db = new PGlite();
    client = adapter(db);
    tmp = mkdtempSync(join(tmpdir(), 'gym-migrator-'));
    folder = join(tmp, 'drizzle');
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  });
  afterAll(async () => {
    await db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('applies every migration in order, each in its own transaction, and records it like Drizzle', async () => {
    const migrations = readMigrations(folder);
    const before = planMigrations(migrations, await readApplied(client));
    expect(before.pending.map((m) => m.tag)).toEqual(migrations.map((m) => m.tag));

    await ensureMigrationsTable(client);
    for (const m of before.pending) await applyMigration(client, m);

    const after = planMigrations(migrations, await readApplied(client));
    expect(after.pending).toEqual([]);
    expect(after.applied).toHaveLength(migrations.length);
    const [{ is_nullable }] = (await client.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_name = 'members' and column_name = 'due_on'",
    )).rows as [{ is_nullable: string }];
    expect(is_nullable).toBe('NO');

    // Same bookkeeping as Drizzle's own migrator (so either can read it).
    const { pglite: viaDrizzle } = await createTestDb();
    const drizzleRows = (await viaDrizzle.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at')).rows;
    await viaDrizzle.close();
    const ours = (await db.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at')).rows;
    expect(ours).toEqual(drizzleRows);
  });

  it('a second run has nothing to apply', async () => {
    expect(planMigrations(readMigrations(folder), await readApplied(client)).pending).toEqual([]);
  });

  it('a failing migration is rolled back completely and not recorded', async () => {
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries.push({ idx: journal.entries.length, version: '7', when: Date.now(), tag: '9999_broken', breakpoints: true });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(folder, '9999_broken.sql'), 'CREATE TABLE "half_done" (id int);\n--> statement-breakpoint\nSELECT no_such_function();\n');

    const plan = planMigrations(readMigrations(folder), await readApplied(client));
    expect(plan.pending.map((m) => m.tag)).toEqual(['9999_broken']);
    const err = await applyMigration(client, plan.pending[0]!).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).message).toMatch(/^9999_broken failed at statement 2: .*no_such_function/);
    const [{ t }] = (await client.query<{ t: string | null }>(`select to_regclass('public.half_done')::text as t`)).rows as [{ t: string | null }];
    expect(t).toBeNull();
    expect(planMigrations(readMigrations(folder), await readApplied(client)).pending.map((m) => m.tag)).toEqual(['9999_broken']);
  });

  it('detects an applied migration that was edited afterwards', async () => {
    const file = join(folder, '0006_due_on_required.sql');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- edited later\n`);
    const plan = planMigrations(readMigrations(folder), await readApplied(client));
    expect(plan.edited.map((m) => m.tag)).toEqual(['0006_due_on_required']);
  });

  it('backs up every table to one JSON file and leaves no partial file', async () => {
    const dir = join(tmp, 'backups');
    const result = await backupDatabase(client, dir, { host: 'local', database: 'test db' }, new Date('2026-11-28T10:20:30.456Z'));
    expect(result.file.endsWith('test_db-20261128-102030Z.json')).toBe(true);
    expect(readdirSync(dir)).toEqual(['test_db-20261128-102030Z.json']);
    const doc = JSON.parse(readFileSync(result.file, 'utf8'));
    expect(Object.keys(doc.tables)).toEqual(expect.arrayContaining(['public.members', 'public.payments', 'drizzle.__drizzle_migrations']));
    expect(doc.tables['public.exercises']).toHaveLength(17);
    expect(doc.tables['drizzle.__drizzle_migrations']).toHaveLength(readMigrations(MIGRATIONS_FOLDER).length);
    expect(existsSync(`${result.file}.partial`)).toBe(false);
  });
});
