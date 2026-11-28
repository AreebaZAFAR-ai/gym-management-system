import type { PGlite } from '@electric-sql/pglite';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/db.module';
import {
  checkins,
  exerciseSessions,
  exercises,
  freezeRequests,
  gyms,
  members,
  payments,
  planAssignments,
  plans,
  trainerPlans,
  trainerSessions,
  users,
} from '../src/db/schema';
import { createTestDb } from './helpers/db';
import { registerMember } from './helpers/seed';

/** Postgres error text, unwrapped from Drizzle's query error. */
async function dbError(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    return e.cause?.message ?? e.message ?? String(err);
  }
  throw new Error('Expected the database to reject this, but it succeeded');
}

const SQUAT_ITEM = {
  exerciseId: 'squat', sets: 5, reps: 5, weightMode: 'pct' as const, kg: null, pct: 75,
  warmups: true, restSec: 120, note: null, canChange: false,
};

describe('database schema (migrations applied to PGlite)', () => {
  let db: Database;
  let pglite: PGlite;
  const ids = {} as Record<
    'aOwner' | 'aReception' | 'aTrainer' | 'aMember' | 'aPlan' | 'bOwner' | 'bReception' | 'bTrainer' | 'bMember' | 'bPlan',
    string
  >;
  let phoneSeq = 3000000100;
  const nextPhone = () => String(phoneSeq++);

  const payment = (over: Partial<typeof payments.$inferInsert> = {}): typeof payments.$inferInsert => ({
    gymId: 'gym-a', memberId: ids.aMember, amountPkr: 4000, method: 'jazzcash',
    periodFrom: '2026-12-01', periodTo: '2027-01-01', recordedBy: ids.aReception, ...over,
  });
  const registerA = (code: string, member?: Partial<typeof members.$inferInsert>) =>
    registerMember(db, { gymId: 'gym-a', phone: nextPhone(), code, planId: ids.aPlan, recordedBy: ids.aReception, member });
  const registerB = (code: string, member?: Partial<typeof members.$inferInsert>) =>
    registerMember(db, { gymId: 'gym-b', phone: nextPhone(), code, planId: ids.bPlan, recordedBy: ids.bReception, member });

  beforeAll(async () => {
    ({ db, pglite } = await createTestDb());

    await db.insert(gyms).values([
      { id: 'gym-a', name: 'Gym A', short: 'GA', city: 'Lahore', primaryColor: '#17191C', memberPrefix: 'GA', checkinSecret: 'secret-a' },
      { id: 'gym-b', name: 'Gym B', short: 'GB', city: 'Karachi', primaryColor: '#17191C', memberPrefix: 'GB', checkinSecret: 'secret-b' },
    ]);
    const addUser = async (gymId: string, phone: string, role: 'reception' | 'trainer' | 'owner') =>
      (await db.insert(users).values({ gymId, phone, name: `${role} ${phone}`, role, passwordHash: 'x' }).returning())[0]!.id;
    const addPlan = async (gymId: string) =>
      (await db.insert(plans).values({ gymId, name: 'Monthly', feePkr: 4000, months: 1 }).returning())[0]!.id;

    ids.aOwner = await addUser('gym-a', '3000000001', 'owner');
    ids.aReception = await addUser('gym-a', '3000000002', 'reception');
    ids.aTrainer = await addUser('gym-a', '3000000003', 'trainer');
    ids.bOwner = await addUser('gym-b', '3000000001', 'owner'); // same phone, other gym: allowed
    ids.bReception = await addUser('gym-b', '3000000008', 'reception');
    ids.bTrainer = await addUser('gym-b', '3000000007', 'trainer');
    ids.aPlan = await addPlan('gym-a');
    ids.bPlan = await addPlan('gym-b');

    ids.aMember = (await registerA('GA-0001', { trainerId: ids.aTrainer })).memberId;
    ids.bMember = (await registerB('GB-0001')).memberId;

    await db.insert(exercises).values([
      { id: 'sled-push', gymId: 'gym-a', name: 'Sled push', equipment: 'machine', muscle: 'legs' },
      { id: 'cable-fly', gymId: 'gym-b', name: 'Cable fly', equipment: 'machine', muscle: 'chest' },
    ]);
  });

  afterAll(() => pglite?.close());

  it('§9: creates the 15 tables plus the §11 due-date log; every table except gyms carries gym_id', async () => {
    const res = await pglite.query<{ table_name: string; has_gym: boolean }>(`
      select t.table_name,
             exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'gym_id') as has_gym
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by 1`);
    expect(res.rows.map((r) => r.table_name)).toEqual([
      'announcements', 'checkins', 'due_date_changes', 'exercise_sessions', 'exercises', 'freeze_requests',
      'gyms', 'members', 'payment_proofs', 'payments', 'plan_assignments', 'plans', 'trainer_plans',
      'trainer_sessions', 'users', 'whatsapp_messages',
    ]);
    expect(res.rows.filter((r) => r.table_name !== 'gyms' && !r.has_gym)).toEqual([]);
  });

  it('§9: the 17 built-in exercises are installed by the migrations', async () => {
    const builtIn = await db.select().from(exercises).where(sql`${exercises.gymId} is null`);
    expect(builtIn).toHaveLength(17);
    expect(builtIn.map((e) => e.id)).toContain('squat');
  });

  it('§9: index on checkins (gym_id, created_at)', async () => {
    const res = await pglite.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'checkins' and indexname = 'checkins_gym_created_idx'`,
    );
    expect(res.rows[0]?.indexdef).toContain('(gym_id, created_at)');
  });

  it('§7/§9: one account per mobile number per gym', async () => {
    const msg = await dbError(() =>
      db.insert(users).values({ gymId: 'gym-a', phone: '3000000001', name: 'Dup', role: 'member', passwordHash: 'x' }),
    );
    expect(msg).toMatch(/users_gym_phone_unique/);
  });

  it('§4.1/§9: phone is 10 digits starting with 3', async () => {
    const msg = await dbError(() =>
      db.insert(users).values({ gymId: 'gym-a', phone: '0300123456', name: 'Bad', role: 'member', passwordHash: 'x' }),
    );
    expect(msg).toMatch(/users_phone_format/);
  });

  it('§9: member code unique per gym', async () => {
    expect(await dbError(() => registerA('GA-0001'))).toMatch(/members_gym_code_unique/);
  });

  describe('§6 Add member: optional first payment (migration 0003); due date required (0006)', () => {
    it('accepts a member saved without a payment; their due date is required', async () => {
      const userId = (await db.insert(users).values({ gymId: 'gym-a', phone: nextPhone(), name: 'No pay', role: 'member', passwordHash: 'x' }).returning())[0]!.id;
      // 0006: members.due_on is NOT NULL (raw SQL, since the typed schema no longer allows null).
      expect(await dbError(() => pglite.query(
        `insert into members (user_id, gym_id, code, plan_id, joined_on, due_on) values ($1, 'gym-a', 'GA-0900', $2, '2026-11-25', null)`,
        [userId, ids.aPlan],
      ))).toMatch(/due_on|not-null|null value/i);
      await db.insert(members).values({ userId, gymId: 'gym-a', code: 'GA-0900', planId: ids.aPlan, joinedOn: '2026-11-25', dueOn: '2026-11-25' });
      const [m] = await db.select().from(members).where(eq(members.userId, userId));
      expect(m?.dueOn).toBe('2026-11-25');
      expect(await db.select().from(payments).where(eq(payments.memberId, userId))).toHaveLength(0);
    });

    it('the 0001 payment-required trigger and its function are removed', async () => {
      const t = await pglite.query(`select 1 from pg_trigger where tgname = 'members_require_payment'`);
      const f = await pglite.query(`select 1 from pg_proc where proname = 'check_member_has_payment'`);
      expect([t.rows.length, f.rows.length]).toEqual([0, 0]);
    });

    it('accepts a member saved together with the payment', async () => {
      const { memberId, paymentId } = await registerA('GA-0902');
      const [m] = await db.select().from(members).where(eq(members.userId, memberId));
      const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
      expect(m?.dueOn).toBe('2026-12-01');
      expect(p?.memberId).toBe(memberId);
    });

    it('the first payment period starts on the payment date; due date = plan months later, month-end clamped', async () => {
      const { memberId, paymentId } = await registerMember(db, {
        gymId: 'gym-a', phone: nextPhone(), code: 'GA-0904', planId: ids.aPlan, recordedBy: ids.aReception,
        paymentDate: '2026-01-31', planMonths: 1,
      });
      const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
      const [m] = await db.select().from(members).where(eq(members.userId, memberId));
      expect([p?.periodFrom, p?.periodTo]).toEqual(['2026-01-31', '2026-02-28']);
      expect(m?.dueOn).toBe('2026-02-28');
    });

    it("the registration payment cannot belong to another gym's member", async () => {
      const msg = await dbError(() =>
        db.transaction(async (tx) => {
          const [u] = await tx.insert(users).values({ gymId: 'gym-a', phone: nextPhone(), name: 'X', role: 'member', passwordHash: 'x' }).returning();
          await tx.insert(members).values({ userId: u!.id, gymId: 'gym-a', code: 'GA-0903', planId: ids.aPlan, joinedOn: '2026-11-25', dueOn: '2026-12-25' });
          await tx.insert(payments).values(payment({ gymId: 'gym-b', memberId: u!.id, recordedBy: ids.bReception }));
        }),
      );
      expect(msg).toMatch(/payments_member_fk/);
    });
  });

  describe("§11: one gym cannot change another gym's members, payments or check-ins", () => {
    it("a payment in gym A cannot reference gym B's member", async () => {
      expect(await dbError(() => db.insert(payments).values(payment({ memberId: ids.bMember })))).toMatch(/payments_member_fk/);
    });

    it('a payment cannot be recorded by staff of another gym', async () => {
      expect(await dbError(() => db.insert(payments).values(payment({ recordedBy: ids.bOwner })))).toMatch(/payments_recorded_by_fk/);
    });

    it("a member cannot be put on another gym's fee plan", async () => {
      const msg = await dbError(() =>
        registerMember(db, { gymId: 'gym-a', phone: nextPhone(), code: 'GA-0099', planId: ids.bPlan, recordedBy: ids.aReception }),
      );
      expect(msg).toMatch(/members_plan_fk/);
    });

    it("a check-in in gym A cannot reference gym B's member", async () => {
      const msg = await dbError(() =>
        db.insert(checkins).values({ gymId: 'gym-a', memberId: ids.bMember, allowed: true, source: 'manual', scannedBy: ids.aReception }),
      );
      expect(msg).toMatch(/checkins_member_fk/);
    });
  });

  describe('§9/§11: payments are append-only', () => {
    let paymentId: string;

    beforeAll(async () => {
      paymentId = (await db.insert(payments).values(payment()).returning())[0]!.id;
    });

    it('rejects UPDATE, DELETE and TRUNCATE', async () => {
      expect(await dbError(() => db.update(payments).set({ amountPkr: 1 }).where(eq(payments.id, paymentId))))
        .toMatch(/payments is append-only: UPDATE is not allowed/);
      expect(await dbError(() => db.delete(payments).where(eq(payments.id, paymentId))))
        .toMatch(/payments is append-only: DELETE is not allowed/);
      expect(await dbError(() => db.execute(sql`truncate payments`)))
        .toMatch(/payments is append-only: TRUNCATE is not allowed/);
    });

    it('stores who recorded each payment', async () => {
      const [p] = await db.insert(payments).values(payment({ recordedBy: ids.aOwner })).returning();
      expect(p?.recordedBy).toBe(ids.aOwner);
    });
  });

  describe('Corrected Payments', () => {
    it('a correction is a separate row linked to the original, which stays unchanged', async () => {
      const { memberId, paymentId: originalId } = await registerA('GA-0201');
      const [original] = await db.select().from(payments).where(eq(payments.id, originalId));
      const [corrected] = await db.insert(payments)
        .values(payment({ memberId, amountPkr: 3500, method: 'cash', recordedBy: ids.aOwner, correctsPaymentId: originalId }))
        .returning();

      // The original row is untouched and cannot be changed.
      expect((await db.select().from(payments).where(eq(payments.id, originalId)))[0]).toEqual(original);
      expect(original?.correctsPaymentId).toBeNull();
      expect(await dbError(() => db.update(payments).set({ amountPkr: 3500 }).where(eq(payments.id, originalId))))
        .toMatch(/append-only/);

      // Staff can tell them apart: the corrected payment carries the link.
      const history = await db.select().from(payments).where(eq(payments.memberId, memberId)).orderBy(payments.createdAt);
      expect(history.map((p) => [p.id, p.correctsPaymentId])).toEqual([[originalId, null], [corrected!.id, originalId]]);
      const correctedOnly = await db.select().from(payments).where(and(eq(payments.memberId, memberId), isNotNull(payments.correctsPaymentId)));
      expect(correctedOnly.map((p) => p.id)).toEqual([corrected!.id]);
    });

    it("a correction cannot point at another gym's payment", async () => {
      const [bPayment] = await db.select().from(payments).where(eq(payments.memberId, ids.bMember));
      expect(await dbError(() => db.insert(payments).values(payment({ correctsPaymentId: bPayment!.id })))).toMatch(/payments_corrects_fk/);
    });
  });

  describe('fingerprint IDs', () => {
    it('are unique within a gym, may repeat in another gym, and are optional', async () => {
      await registerA('GA-0301', { fingerprintId: '17' });
      expect(await dbError(() => registerA('GA-0302', { fingerprintId: '17' }))).toMatch(/members_gym_fingerprint_unique/);
      await registerB('GB-0301', { fingerprintId: '17' });
      await registerA('GA-0303');
      await registerA('GA-0304');
      const inA = await db.select().from(members).where(and(eq(members.gymId, 'gym-a'), eq(members.fingerprintId, '17')));
      expect(inA.map((m) => m.code)).toEqual(['GA-0301']);
    });
  });

  it('§4.6/§7: freeze requests are 3 to 15 days', async () => {
    expect(await dbError(() => db.insert(freezeRequests).values({ gymId: 'gym-a', memberId: ids.aMember, days: 2, reason: 'travel' })))
      .toMatch(/freeze_requests_days_range/);
    expect(await dbError(() => db.insert(freezeRequests).values({ gymId: 'gym-a', memberId: ids.aMember, days: 16, reason: 'travel' })))
      .toMatch(/freeze_requests_days_range/);
    await db.insert(freezeRequests).values({ gymId: 'gym-a', memberId: ids.aMember, days: 7, reason: 'travel' });
  });

  it('§7: thumbprint check-ins can be saved without a staff scanner', async () => {
    await db.insert(checkins).values({ gymId: 'gym-a', memberId: ids.aMember, allowed: true, source: 'fingerprint' });
  });

  it('§7: every scan is saved, including one that identified no member', async () => {
    const [row] = await db.insert(checkins).values({
      gymId: 'gym-a', allowed: false, reason: 'This code has expired. Ask the member to open the app again', source: 'qr', scannedBy: ids.aReception,
    }).returning();
    expect(row).toMatchObject({ memberId: null, allowed: false, source: 'qr', scannedBy: ids.aReception });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  describe('trainer sessions', () => {
    const base = { gymId: 'gym-a', startsAt: new Date('2026-11-26T13:00:00Z'), kind: 'pt' as const };

    it('a trainer creates their own; the owner creates one assigned to a selected trainer; the owner sees both', async () => {
      await db.insert(trainerSessions).values([
        { ...base, memberId: ids.aMember, trainerId: ids.aTrainer, title: 'Created by trainer' },
        { ...base, memberId: ids.aMember, trainerId: ids.aTrainer, title: 'Created by owner for the trainer' },
      ]);
      const trainers = await db.select().from(trainerSessions)
        .where(and(eq(trainerSessions.gymId, 'gym-a'), eq(trainerSessions.trainerId, ids.aTrainer)));
      expect(trainers.map((s) => s.title).sort()).toEqual(['Created by owner for the trainer', 'Created by trainer']);
      const ownerView = await db.select().from(trainerSessions).where(eq(trainerSessions.gymId, 'gym-a'));
      expect(ownerView).toHaveLength(2);
      expect(await db.select().from(trainerSessions).where(eq(trainerSessions.gymId, 'gym-b'))).toHaveLength(0);
    });

    it("cannot name another gym's trainer or member", async () => {
      expect(await dbError(() => db.insert(trainerSessions).values({ ...base, trainerId: ids.bTrainer, title: 'x' })))
        .toMatch(/trainer_sessions_trainer_fk/);
      expect(await dbError(() => db.insert(trainerSessions).values({ ...base, trainerId: ids.aTrainer, memberId: ids.bMember, title: 'x' })))
        .toMatch(/trainer_sessions_member_fk/);
    });
  });

  describe('exercises, workouts and trainer plans', () => {
    const sessionId = '0b9f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    let planId: string;
    let bPlanId: string;

    beforeAll(async () => {
      planId = (await db.insert(trainerPlans).values({
        gymId: 'gym-a', trainerId: ids.aTrainer, name: 'Legs', date: '2026-11-26',
        items: [SQUAT_ITEM, { ...SQUAT_ITEM, exerciseId: 'sled-push' }],
      }).returning())[0]!.id;
      bPlanId = (await db.insert(trainerPlans).values({
        gymId: 'gym-b', trainerId: ids.bTrainer, name: 'B plan', date: '2026-11-26', items: [SQUAT_ITEM],
      }).returning())[0]!.id;
      await db.insert(planAssignments).values({ planId, memberId: ids.aMember, gymId: 'gym-a', overrides: { squat: 80 } });
    });

    const session = (over: Partial<typeof exerciseSessions.$inferInsert> = {}): typeof exerciseSessions.$inferInsert => ({
      id: crypto.randomUUID(), gymId: 'gym-a', memberId: ids.aMember, exerciseId: 'squat', date: '2026-11-26',
      sets: [{ kg: 80, reps: 5, warmup: false, plates: [20, 10] }], ...over,
    });

    describe('duplicate exercises are not allowed (names unique per gym, ignoring case)', () => {
      const ex = (id: string, name: string, gymId: string | null = null) =>
        db.insert(exercises).values({ id, gymId, name, equipment: 'bar', muscle: 'legs' });

      it('the slug (§9 exercise ID) cannot repeat', async () => {
        expect(await dbError(() => ex('squat', 'Front squat'))).toMatch(/exercises_pkey/);
      });

      it('built-in names cannot repeat, in any case', async () => {
        expect(await dbError(() => ex('squat-2', 'Back squat'))).toMatch(/exercises_builtin_name_ci_unique/);
        expect(await dbError(() => ex('squat-3', 'BACK SQUAT'))).toMatch(/exercises_builtin_name_ci_unique/);
      });

      it("a gym's own exercise names cannot repeat in that gym, in any case", async () => {
        expect(await dbError(() => ex('sled-push-2', 'Sled push', 'gym-a'))).toMatch(/exercises_gym_name_ci_unique/);
        expect(await dbError(() => ex('sled-push-3', 'sled PUSH', 'gym-a'))).toMatch(/exercises_gym_name_ci_unique/);
      });

      it('a gym exercise cannot reuse a built-in name, and a new built-in cannot reuse a gym exercise name', async () => {
        expect(await dbError(() => ex('squat-a', 'back squat', 'gym-a'))).toMatch(/an exercise named "back squat" already exists for this gym/);
        expect(await dbError(() => ex('cable-fly-builtin', 'Cable Fly'))).toMatch(/an exercise named "Cable Fly" already exists for this gym/);
      });

      it('renaming into a duplicate is refused too', async () => {
        await ex('lunge-a', 'Walking lunge', 'gym-a');
        expect(await dbError(() => db.update(exercises).set({ name: 'BACK SQUAT' }).where(eq(exercises.id, 'lunge-a'))))
          .toMatch(/already exists for this gym/);
      });

      it('another gym may have its own exercise with the same name', async () => {
        await ex('sled-push-b', 'Sled Push', 'gym-b');
        const rows = await db.select().from(exercises).where(sql`lower(${exercises.name}) = 'sled push'`);
        expect(rows.map((r) => r.gymId).sort()).toEqual(['gym-a', 'gym-b']);
      });
    });

    it('§7: a session ID sent twice from the phone is stored once', async () => {
      const row = session({ id: sessionId, planId });
      expect(await db.insert(exerciseSessions).values(row).onConflictDoNothing().returning()).toHaveLength(1);
      expect(await db.insert(exerciseSessions).values(row).onConflictDoNothing().returning()).toHaveLength(0);
    });

    it("§11: a session can use built-in and own-gym exercises, not another gym's", async () => {
      await db.insert(exerciseSessions).values(session({ exerciseId: 'sled-push' }));
      expect(await dbError(() => db.insert(exerciseSessions).values(session({ exerciseId: 'cable-fly' }))))
        .toMatch(/exercise belongs to another gym/);
    });

    it("§11: a session cannot reference another gym's trainer plan", async () => {
      expect(await dbError(() => db.insert(exerciseSessions).values(session({ planId: bPlanId }))))
        .toMatch(/exercise_sessions_plan_fk/);
    });

    it("§11: a trainer plan cannot use another gym's exercise", async () => {
      const msg = await dbError(() =>
        db.insert(trainerPlans).values({
          gymId: 'gym-a', trainerId: ids.aTrainer, name: 'X', date: '2026-11-26', items: [{ ...SQUAT_ITEM, exerciseId: 'cable-fly' }],
        }),
      );
      expect(msg).toMatch(/exercise "cable-fly" is not available in this gym/);
    });

    it('§7: a plan goes only to clients from the same gym', async () => {
      expect(await dbError(() => db.insert(planAssignments).values({ planId, memberId: ids.bMember, gymId: 'gym-a' })))
        .toMatch(/plan_assignments_member_fk/);
    });

    it('§7: a plan has 1 to 15 exercises', async () => {
      const base = { gymId: 'gym-a', trainerId: ids.aTrainer, name: 'X', date: '2026-11-26' };
      expect(await dbError(() => db.insert(trainerPlans).values({ ...base, items: [] }))).toMatch(/trainer_plans_items_count/);
      expect(await dbError(() => db.insert(trainerPlans).values({ ...base, items: Array(16).fill(SQUAT_ITEM) })))
        .toMatch(/trainer_plans_items_count/);
    });

    it('§6/§10: deleting a plan removes its assignments and keeps the logged workouts', async () => {
      await db.delete(trainerPlans).where(eq(trainerPlans.id, planId));
      expect(await db.select().from(planAssignments).where(eq(planAssignments.planId, planId))).toHaveLength(0);
      const [kept] = await db.select().from(exerciseSessions)
        .where(and(eq(exerciseSessions.id, sessionId), eq(exerciseSessions.gymId, 'gym-a')));
      expect(kept?.planId).toBeNull();
      expect(kept?.sets).toEqual([{ kg: 80, reps: 5, warmup: false, plates: [20, 10] }]);
    });
  });
});
