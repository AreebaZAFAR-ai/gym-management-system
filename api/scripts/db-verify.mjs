// Verifies the migrated database. Never leaves data behind:
//  1. read-only: tables, indexes, constraints, triggers, functions, migrations, built-in exercises
//  2. behaviour: exercises the integrity rules inside ONE transaction that is always rolled back
// Usage (from api/): node scripts/db-verify.mjs  (uses DATABASE_URL_DIRECT from api/.env)
import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_DIRECT is missing from api/.env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
let failures = 0;
const ok = (label) => console.log(`  ok    ${label}`);
const bad = (label, detail = '') => {
  failures++;
  console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ''}`);
};
const q = async (sql, params) => (await client.query(sql, params)).rows;

/**
 * Runs one statement (or a list of [sql, params] steps) inside a savepoint and
 * expects it to fail with a message matching `pattern`.
 */
async function expectReject(label, sql, params, pattern) {
  const steps = Array.isArray(sql) ? sql : [[sql, params]];
  await client.query('SAVEPOINT s');
  try {
    for (const [text, values] of steps) await client.query(text, values);
    bad(label, 'was accepted');
  } catch (err) {
    if (pattern.test(err.message)) ok(label);
    else bad(label, err.message);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT s');
  }
}

await client.connect();
try {
  console.log('\nStructure (read-only)');
  const tables = (await q(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).map((r) => r.table_name);
  tables.length === 16 ? ok(`16 tables: ${tables.join(', ')}`) : bad('table count', String(tables.length));
  const noGym = (await q(`select t.table_name from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE' and t.table_name <> 'gyms'
    and not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='gym_id')`)).map((r) => r.table_name);
  noGym.length === 0 ? ok('every table except gyms has gym_id') : bad('tables without gym_id', noGym.join(', '));
  const [{ n: idx }] = await q(`select count(*)::int n from pg_indexes where schemaname='public'`);
  const [{ n: cons }] = await q(`select count(*)::int n from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'`);
  const [{ n: fks }] = await q(`select count(*)::int n from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f'`);
  ok(`${idx} indexes, ${cons} constraints (${fks} foreign keys)`);
  const triggers = (await q(`select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1`)).map((r) => r.tgname);
  // 0003 removed the members_require_payment trigger and check_member_has_payment() (§6 optional first payment).
  triggers.length === 5 && !triggers.includes('members_require_payment') ? ok(`5 triggers: ${triggers.join(', ')}`) : bad('triggers', triggers.join(', '));
  const fns = (await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`)).map((r) => r.proname);
  fns.length === 4 && !fns.includes('check_member_has_payment') ? ok(`4 functions: ${fns.join(', ')}`) : bad('functions', fns.join(', '));
  const migrations = await q(`select count(*)::int n from drizzle.__drizzle_migrations`);
  migrations[0].n === 5 ? ok('5 migrations recorded') : bad('migrations recorded', String(migrations[0].n));
  // 0004 gym self-registration: contact columns and case-insensitive unique emails.
  const regCols = (await q(`select table_name || '.' || column_name c from information_schema.columns where table_schema='public' and ((table_name='gyms' and column_name in ('email','phone','address')) or (table_name='users' and column_name='email')) order by 1`)).map((r) => r.c);
  regCols.length === 4 ? ok(`registration columns: ${regCols.join(', ')}`) : bad('registration columns', regCols.join(', '));
  const regIdx = (await q(`select indexname from pg_indexes where schemaname='public' and indexname in ('gyms_email_ci_unique','users_email_ci_unique') order by 1`)).map((r) => r.indexname);
  regIdx.length === 2 ? ok(`unique email indexes: ${regIdx.join(', ')}`) : bad('unique email indexes', regIdx.join(', '));
  const [{ nullable }] = await q(`select is_nullable = 'YES' as nullable from information_schema.columns where table_schema='public' and table_name='members' and column_name='due_on'`);
  nullable ? ok('members.due_on allows no due date (optional first payment)') : bad('members.due_on is still NOT NULL');
  const [{ n: builtIn }] = await q(`select count(*)::int n from exercises where gym_id is null`);
  builtIn === 17 ? ok('17 built-in exercises') : bad('built-in exercises', String(builtIn));
  const rows = await q(`select relname, n_live_tup::int n from pg_stat_user_tables where schemaname='public' and relname <> 'exercises' and n_live_tup > 0`);
  ok(`data rows outside exercises: ${rows.length ? rows.map((r) => `${r.relname}=${r.n}`).join(', ') : 'none'}`);

  console.log('\nBehaviour (inside a transaction that is rolled back)');
  await client.query('BEGIN');
  for (const g of ['verify-a', 'verify-b']) {
    await q(`insert into gyms (id,name,short,city,primary_color,member_prefix,checkin_secret) values ($1,$1,'V','X','#000000','V',$1)`, [g]);
  }
  const user = async (gym, phone, role) => (await q(`insert into users (gym_id,phone,name,role,password_hash) values ($1,$2,'v',$3,'x') returning id`, [gym, phone, role]))[0].id;
  const plan = async (gym) => (await q(`insert into plans (gym_id,name,fee_pkr,months) values ($1,'M',4000,1) returning id`, [gym]))[0].id;
  const recA = await user('verify-a', '3000000001', 'reception');
  const recB = await user('verify-b', '3000000001', 'reception');
  const planA = await plan('verify-a');
  const memberA = await user('verify-a', '3000000002', 'member');
  const memberB = await user('verify-b', '3000000002', 'member');

  const unpaid = await user('verify-a', '3000000009', 'member');
  await q(`insert into members (user_id,gym_id,code,plan_id,joined_on,due_on) values ($1,'verify-a','V-9',$2,'2026-11-01',null)`, [unpaid, planA]);
  ok('member without a first payment (no due date) is accepted');

  await q(`insert into members (user_id,gym_id,code,plan_id,joined_on,due_on) values ($1,'verify-a','V-1',$2,'2026-11-01','2026-12-01')`, [memberA, planA]);
  const pay = (await q(`insert into payments (gym_id,member_id,amount_pkr,method,period_from,period_to,recorded_by) values ('verify-a',$1,4000,'cash','2026-11-01','2026-12-01',$2) returning id`, [memberA, recA]))[0].id;
  ok('member with its payment is accepted');

  await expectReject('payments: UPDATE blocked', `update payments set amount_pkr=1 where id=$1`, [pay], /append-only: UPDATE/);
  await expectReject('payments: DELETE blocked', `delete from payments where id=$1`, [pay], /append-only: DELETE/);
  await expectReject('payments: TRUNCATE blocked', `truncate payments`, [], /append-only: TRUNCATE/);
  await expectReject("payment for another gym's member refused", `insert into payments (gym_id,member_id,amount_pkr,method,period_from,period_to,recorded_by) values ('verify-a',$1,1,'cash','2026-11-01','2026-12-01',$2)`, [memberB, recA], /payments_member_fk/);
  await expectReject('payment recorded by another gym\'s staff refused', `insert into payments (gym_id,member_id,amount_pkr,method,period_from,period_to,recorded_by) values ('verify-a',$1,1,'cash','2026-11-01','2026-12-01',$2)`, [memberA, recB], /payments_recorded_by_fk/);
  await q(`insert into payments (gym_id,member_id,amount_pkr,method,period_from,period_to,recorded_by,corrects_payment_id) values ('verify-a',$1,3500,'cash','2026-11-01','2026-12-01',$2,$3)`, [memberA, recA, pay]);
  ok('corrected payment linked to the original is accepted');
  await expectReject('duplicate phone in the same gym refused', `insert into users (gym_id,phone,name,role,password_hash) values ('verify-a','3000000001','x','member','x')`, [], /users_gym_phone_unique/);
  await expectReject('phone format enforced', `insert into users (gym_id,phone,name,role,password_hash) values ('verify-a','0300000000','x','member','x')`, [], /users_phone_format/);
  await expectReject('freeze must be 3-15 days', `insert into freeze_requests (gym_id,member_id,days,reason) values ('verify-a',$1,16,'travel')`, [memberA], /freeze_requests_days_range/);
  await expectReject('built-in exercise names unique, ignoring case', `insert into exercises (id,name,equipment,muscle) values ('v-squat','BACK SQUAT','bar','legs')`, [], /exercises_builtin_name_ci_unique/);
  await expectReject('gym exercise cannot reuse a built-in name', `insert into exercises (id,gym_id,name,equipment,muscle) values ('v-sq','verify-a','back squat','bar','legs')`, [], /already exists for this gym/);
  await q(`insert into exercises (id,gym_id,name,equipment,muscle) values ('v-sled','verify-b','Sled push','machine','legs')`);
  await expectReject("session cannot use another gym's exercise", `insert into exercise_sessions (id,gym_id,member_id,exercise_id,date,sets) values (gen_random_uuid(),'verify-a',$1,'v-sled','2026-11-25','[]')`, [memberA], /belongs to another gym/);
  await q(`insert into checkins (gym_id,member_id,allowed,reason,source) values ('verify-a',null,false,'unknown','fingerprint')`);
  ok('check-in with no identified member is accepted');
  await client.query(`update members set fingerprint_id='7' where user_id=$1`, [memberA]);
  await expectReject('fingerprint ID unique within a gym', [
    [`insert into members (user_id,gym_id,code,plan_id,joined_on,due_on,fingerprint_id) values ($1,'verify-a','V-2',$2,'2026-11-01','2026-12-01','7')`, [await user('verify-a', '3000000003', 'member'), planA]],
  ], null, /members_gym_fingerprint_unique/);
} catch (err) {
  bad('verification aborted', err instanceof Error ? err.message : String(err));
} finally {
  await client.query('ROLLBACK').catch(() => {});
  const [{ n }] = await q(`select count(*)::int n from gyms where id like 'verify-%'`);
  n === 0 ? ok('rolled back: no verification data left in the database') : bad('verification data left behind', String(n));
  await client.end();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
