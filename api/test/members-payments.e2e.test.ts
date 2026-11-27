import { addDays, addMonths, formatShortDate, pkToday } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { members, payments, users, whatsappMessages } from '../src/db/schema';
import { DUPLICATE_FINGERPRINT, DUPLICATE_PHONE } from '../src/members/members.service';
import { MEMBER_NOT_FOUND } from '../src/payments/payments.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { registerMember } from './helpers/seed';
import { login, seedGym, type GymFixture } from './helpers/staff';

describe('member registration and membership payments', () => {
  let ctx: TestContext;
  let a: GymFixture;
  let b: GymFixture;
  let receptionA: string;
  let ownerA: string;
  let receptionB: string;
  const today = pkToday();
  const http = () => request(ctx.app.getHttpServer());
  const as = (token: string) => ({
    post: (path: string, body: object) => http().post(path).set('Authorization', `Bearer ${token}`).send(body),
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${token}`),
  });

  const newMember = (over: Record<string, unknown> = {}) => ({
    name: 'Ali Raza', phone: '0300-1234567', gender: 'male', joinedOn: today, goal: 'strength',
    emergencyContact: '0301 7654321', fingerprintId: null, notes: null, planId: a.planId, trainerId: a.trainer.id,
    payment: { amountPkr: 4000, method: 'jazzcash', txnId: 'JC-123' }, ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await seedGym(ctx.db, 'gym-a', 'Iron House Fitness', 'IH');
    b = await seedGym(ctx.db, 'gym-b', 'Gym B', 'GB');
    receptionA = await login(ctx.app, 'gym-a', a.reception.phone);
    ownerA = await login(ctx.app, 'gym-a', a.owner.phone);
    receptionB = await login(ctx.app, 'gym-b', b.reception.phone);
  });
  afterAll(() => closeTestApp(ctx));

  describe('POST /v1/members (registration)', () => {
    let reg: request.Response;

    beforeAll(async () => {
      reg = await as(receptionA).post('/v1/members', newMember());
    });

    it('registers the member with the next member ID and the default password', () => {
      expect(reg.status).toBe(201);
      expect(reg.body).toMatchObject({ code: 'IH-0001', temporaryPassword: '234567' });
    });

    it('the first payment starts today (the payment date); due date = plan months later', async () => {
      const due = addMonths(today, 1);
      expect(reg.body.dueOn).toBe(due);
      expect(reg.body.payment).toMatchObject({
        amountPkr: 4000, method: 'jazzcash', txnId: 'JC-123', periodFrom: today, periodTo: due,
        recordedBy: a.reception.id, proofId: null, correctsPaymentId: null,
      });
      const [m] = await ctx.db.select().from(members).where(eq(members.userId, reg.body.memberId));
      expect(m).toMatchObject({ code: 'IH-0001', dueOn: due, joinedOn: today, planId: a.planId, trainerId: a.trainer.id, goal: 'strength', gender: 'male' });
    });

    it('§6/§7: registration queues the welcome WhatsApp with the gym name', async () => {
      const msgs = await ctx.db.select().from(whatsappMessages).where(eq(whatsappMessages.memberId, reg.body.memberId));
      const welcome = msgs.filter((x) => x.kind === 'welcome');
      expect(welcome).toHaveLength(1);
      expect(welcome[0]).toMatchObject({
        status: 'queued', toPhone: '3001234567',
        body: 'Welcome to Iron House Fitness! Your fitness journey starts today. Stay active, stay healthy!',
      });
    });

    it('§7: saving the registration payment queues the WhatsApp receipt', async () => {
      const msgs = await ctx.db.select().from(whatsappMessages).where(eq(whatsappMessages.memberId, reg.body.memberId));
      expect(msgs.map((x) => x.kind).sort()).toEqual(['receipt', 'welcome']);
      const receipt = msgs.find((x) => x.kind === 'receipt');
      expect(receipt).toMatchObject({ status: 'queued', toPhone: '3001234567' });
      expect(receipt!.body).toBe(
        `Assalam o Alaikum Ali, we received PKR 4,000 by JazzCash at Iron House Fitness. Your membership is paid till ${formatShortDate(addMonths(today, 1))}. Thank you!`,
      );
    });

    it('the member can log in with the temporary password; it is stored hashed', async () => {
      const res = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: '3001234567', password: '234567' });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ role: 'member', memberCode: 'IH-0001', name: 'Ali Raza' });
      const [u] = await ctx.db.select().from(users).where(eq(users.id, reg.body.memberId));
      expect(u!.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    });

    it('member IDs keep counting and the owner can register too', async () => {
      const res = await as(ownerA).post('/v1/members', newMember({ phone: '03007654321', trainerId: null }));
      expect(res.status).toBe(201);
      expect(res.body.code).toBe('IH-0002');
    });

    it('§7: one account per mobile number per gym; another gym may register the same number', async () => {
      const dup = await as(receptionA).post('/v1/members', newMember({ phone: '+92 300 1234567' }));
      expect(dup.status).toBe(409);
      expect(dup.body).toEqual({ message: DUPLICATE_PHONE });
      const other = await as(receptionB).post('/v1/members', newMember({ planId: b.planId, trainerId: null }));
      expect(other.status).toBe(201);
      expect(other.body.code).toBe('GB-0001');
    });

    it('a refused registration uses no member ID (IDs are never skipped or reused)', async () => {
      const next = await as(receptionA).post('/v1/members', newMember({ phone: '03001110000', trainerId: null }));
      expect(next.body.code).toBe('IH-0003');
    });

    it('a thumbprint ID can be given to only one member in the gym', async () => {
      expect((await as(receptionA).post('/v1/members', newMember({ phone: '03002220000', trainerId: null, fingerprintId: '55' }))).status).toBe(201);
      const dup = await as(receptionA).post('/v1/members', newMember({ phone: '03002220001', trainerId: null, fingerprintId: '55' }));
      expect(dup.status).toBe(409);
      expect(dup.body).toEqual({ message: DUPLICATE_FINGERPRINT });
    });

    describe('§6 "Optional first payment": registering without a payment', () => {
      let unpaid: request.Response;

      beforeAll(async () => {
        unpaid = await as(receptionA).post('/v1/members', newMember({ phone: '03003330000', payment: undefined }));
      });

      it('registers the member with no payment, no receipt and no due date', async () => {
        expect(unpaid.status).toBe(201);
        expect(unpaid.body).toMatchObject({ temporaryPassword: '330000', dueOn: null, payment: null });
        expect(await ctx.db.select().from(payments).where(eq(payments.memberId, unpaid.body.memberId))).toEqual([]);
        const [m] = await ctx.db.select().from(members).where(eq(members.userId, unpaid.body.memberId));
        expect(m?.dueOn).toBeNull();
        expect((await as(receptionA).post('/v1/members', newMember({ phone: '03003330001', payment: null }))).status).toBe(201);
      });

      it('queues only the welcome WhatsApp', async () => {
        const msgs = await ctx.db.select().from(whatsappMessages).where(eq(whatsappMessages.memberId, unpaid.body.memberId));
        expect(msgs.map((x) => [x.kind, x.body])).toEqual([
          ['welcome', 'Welcome to Iron House Fitness! Your fitness journey starts today. Stay active, stay healthy!'],
        ]);
      });

      it('the member list and member page show no due date', async () => {
        const detail = await as(receptionA).get(`/v1/members/${unpaid.body.code}`);
        expect(detail.body).toMatchObject({ dueOn: null, payments: [] });
        const listed = (await as(receptionA).get('/v1/members?q=3330000')).body;
        expect(listed.map((m: { dueOn: string | null }) => m.dueOn)).toEqual([null]);
      });

      it('§7 recording the first payment later: no due date to extend, so the period starts today; receipt queued', async () => {
        const res = await as(receptionA).post('/v1/payments', { memberCode: unpaid.body.code, amountPkr: 4000, method: 'cash' });
        expect(res.status).toBe(201);
        expect(res.body.payment).toMatchObject({ periodFrom: today, periodTo: addMonths(today, 1) });
        expect(res.body.newDueOn).toBe(addMonths(today, 1));
        const kinds = (await ctx.db.select().from(whatsappMessages).where(eq(whatsappMessages.memberId, unpaid.body.memberId))).map((x) => x.kind);
        expect(kinds.sort()).toEqual(['receipt', 'welcome']);
      });
    });

    it('a payment, when given, must have a valid amount and method', async () => {
      const res = await as(receptionA).post('/v1/members', newMember({ phone: '03003330009', payment: { amountPkr: 4000 } }));
      expect(res.status).toBe(400);
      expect(await ctx.db.select().from(users).where(eq(users.phone, '3003330009'))).toHaveLength(0);
    });

    it('validates the form', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ phone: '12345' }, 'Enter a valid mobile number, e.g. 0300 1234567.'],
        [{ name: '  ' }, 'Enter the member’s name.'],
        [{ joinedOn: '2026-02-30' }, 'Enter the joining date.'],
        [{ planId: 'x' }, 'Choose a fee plan.'],
        [{ payment: { amountPkr: 4000, method: 'card' } }, 'Choose a payment method.'],
      ];
      for (const [over, message] of cases) {
        const res = await as(receptionA).post('/v1/members', newMember({ phone: '03004440000', ...over }));
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ message });
      }
    });

    it("§11: cannot use another gym's fee plan or trainer", async () => {
      const plan = await as(receptionA).post('/v1/members', newMember({ phone: '03005550000', planId: b.planId }));
      expect(plan.body).toEqual({ message: 'Fee plan not found.' });
      const trainer = await as(receptionA).post('/v1/members', newMember({ phone: '03005550000', trainerId: b.trainer.id }));
      expect(trainer.body).toEqual({ message: 'Trainer not found.' });
    });
  });

  describe('POST /v1/payments (§7 recording a payment)', () => {
    const fixture = (code: string, phone: string, dueOn: string, frozenUntil: string | null = null) =>
      registerMember(ctx.db, {
        gymId: 'gym-a', phone, code, planId: a.planId, recordedBy: a.reception.id, joinedOn: addDays(today, -90), dueOn,
        member: { frozenUntil },
      });

    it('paying early extends from the current due date', async () => {
      const dueOn = addDays(today, 3);
      await fixture('IH-0901', '3009010000', dueOn);
      const res = await as(receptionA).post('/v1/payments', { memberCode: 'IH-0901', amountPkr: 4000, method: 'cash' });
      expect(res.status).toBe(201);
      expect(res.body.payment).toMatchObject({ periodFrom: dueOn, periodTo: addMonths(dueOn, 1), recordedBy: a.reception.id, txnId: null });
      expect(res.body.newDueOn).toBe(addMonths(dueOn, 1));
      expect(res.body.message).toBe(`Renewed to ${formatShortDate(addMonths(dueOn, 1))}. Receipt queued for WhatsApp`);
    });

    it('paying after the due date starts from today, and the member record is updated', async () => {
      const { memberId } = await fixture('IH-0902', '3009020000', addDays(today, -10));
      const res = await as(ownerA).post('/v1/payments', { memberCode: 'IH-0902', amountPkr: 4000, method: 'easypaisa', txnId: 'EP-9' });
      expect(res.body.payment).toMatchObject({ periodFrom: today, periodTo: addMonths(today, 1), recordedBy: a.owner.id, txnId: 'EP-9' });
      const [m] = await ctx.db.select().from(members).where(eq(members.userId, memberId));
      expect(m!.dueOn).toBe(addMonths(today, 1));
    });

    it('saving a payment clears any freeze and queues the receipt', async () => {
      const dueOn = addDays(today, 10);
      const { memberId } = await fixture('IH-0903', '3009030000', dueOn, addDays(today, 4));
      const res = await as(receptionA).post('/v1/payments', { memberCode: 'IH-0903', amountPkr: 4500, method: 'bank' });
      expect(res.status).toBe(201);
      const [m] = await ctx.db.select().from(members).where(eq(members.userId, memberId));
      expect(m!.frozenUntil).toBeNull();
      const receipts = await ctx.db.select().from(whatsappMessages)
        .where(and(eq(whatsappMessages.memberId, memberId), eq(whatsappMessages.kind, 'receipt')));
      expect(receipts.map((r) => r.body)).toEqual([
        `Assalam o Alaikum IH-0903, we received PKR 4,500 by Bank transfer at Iron House Fitness. Your membership is paid till ${formatShortDate(addMonths(dueOn, 1))}. Thank you!`,
      ]);
      expect(receipts[0]!.status).toBe('queued');
    });

    it('§11: payments stay append-only; every payment keeps who recorded it', async () => {
      const [m] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0901'));
      const rows = await ctx.db.select().from(payments).where(eq(payments.memberId, m!.userId));
      expect(rows).toHaveLength(2); // registration + renewal; nothing overwritten
      expect(rows.every((r) => r.recordedBy === a.reception.id)).toBe(true);
    });

    it("§11: cannot pay for another gym's member", async () => {
      const res = await as(receptionB).post('/v1/payments', { memberCode: 'IH-0901', amountPkr: 4000, method: 'cash' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: MEMBER_NOT_FOUND });
    });

    it('validates the payment', async () => {
      for (const [body, message] of [
        [{ memberCode: 'IH-0901', amountPkr: 10.5, method: 'cash' }, 'Enter the amount in whole rupees.'],
        [{ memberCode: 'IH-0901', amountPkr: 4000, method: 'card' }, 'Choose a payment method.'],
        [{ amountPkr: 4000, method: 'cash' }, 'Enter the member ID.'],
      ] as const) {
        const res = await as(receptionA).post('/v1/payments', body);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ message });
      }
    });

  });

  describe('GET /v1/payments?from&to&member', () => {
    it("lists this gym's payments, newest first, filtered by member ID and Pakistan dates", async () => {
      const all = await as(receptionA).get('/v1/payments');
      expect(all.status).toBe(200);
      expect(all.body.length).toBeGreaterThan(5);
      const times = all.body.map((p: { createdAt: string }) => p.createdAt);
      expect([...times].sort().reverse()).toEqual(times);

      const one = await as(receptionA).get('/v1/payments?member=IH-0901');
      expect(one.body).toHaveLength(2);

      const todayOnly = await as(receptionA).get(`/v1/payments?from=${today}&to=${today}`);
      expect(todayOnly.body.length).toBe(all.body.length);
      const tomorrow = await as(receptionA).get(`/v1/payments?from=${addDays(today, 1)}`);
      expect(tomorrow.body).toEqual([]);
    });

    it("§11: never returns another gym's payments", async () => {
      const res = await as(receptionB).get('/v1/payments');
      const [gymBMember] = await ctx.db.select().from(members).where(eq(members.gymId, 'gym-b'));
      expect(res.body.every((p: { memberId: string }) => p.memberId === gymBMember!.userId)).toBe(true);
      expect((await as(receptionB).get('/v1/payments?member=IH-0901')).body).toEqual([]);
    });

    it('rejects a bad date', async () => {
      const res = await as(receptionA).get('/v1/payments?from=25-11-2026');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: '"from" must be a date like 2026-11-25.' });
    });
  });
});
