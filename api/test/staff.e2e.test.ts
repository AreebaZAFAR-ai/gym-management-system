import { addDays, addMonths, applyFreeze, formatShortDate, pkToday } from '@gym/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALREADY_HANDLED } from '../src/approvals/approvals.service';
import { hashPassword } from '../src/auth/passwords';
import { checkins, dueDateChanges, gyms, members, payments, users } from '../src/db/schema';
import { CANNOT_DISABLE_SELF } from '../src/setup/setup.service';
import { OWNER_ONLY_DUE_DATE } from '../src/members/members.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { registerMember } from './helpers/seed';
import { login, seedGym, type GymFixture } from './helpers/staff';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('staff routes: door, approvals, members, dashboard, messages, setup', () => {
  let ctx: TestContext;
  let a: GymFixture;
  let b: GymFixture;
  const t = {} as Record<'reception' | 'owner' | 'trainer' | 'receptionB' | 'ownerB', string>;
  const today = pkToday();
  const http = () => request(ctx.app.getHttpServer());
  const as = (token: string) => ({
    get: (p: string) => http().get(p).set('Authorization', `Bearer ${token}`),
    post: (p: string, body: object = {}) => http().post(p).set('Authorization', `Bearer ${token}`).send(body),
    patch: (p: string, body: object) => http().patch(p).set('Authorization', `Bearer ${token}`).send(body),
    del: (p: string) => http().delete(p).set('Authorization', `Bearer ${token}`),
  });
  /** Registers a member (test fixture) and returns a logged-in member token. */
  const member = async (code: string, phone: string, dueOn: string, extra: Partial<typeof members.$inferInsert> = {}) => {
    const { memberId } = await registerMember(ctx.db, {
      gymId: 'gym-a', phone, code, planId: a.planId, recordedBy: a.reception.id, joinedOn: addDays(today, -60), dueOn, member: extra,
    });
    await ctx.db.update(users).set({ passwordHash: await hashPassword('member-pass') }).where(eq(users.id, memberId));
    const token = (await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone, password: 'member-pass' })).body.token as string;
    return { memberId, token };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await seedGym(ctx.db, 'gym-a', 'Iron House Fitness', 'IH');
    b = await seedGym(ctx.db, 'gym-b', 'Gym B', 'GB');
    await ctx.db.update(gyms).set({ deviceKey: 'device-a' }).where(eq(gyms.id, 'gym-a'));
    t.reception = await login(ctx.app, 'gym-a', a.reception.phone);
    t.owner = await login(ctx.app, 'gym-a', a.owner.phone);
    t.trainer = await login(ctx.app, 'gym-a', a.trainer.phone);
    t.receptionB = await login(ctx.app, 'gym-b', b.reception.phone);
    t.ownerB = await login(ctx.app, 'gym-b', b.owner.phone);
  });
  afterAll(() => closeTestApp(ctx));

  describe('door: scan and day log', () => {
    it('saves every scan with its source and scanner, and lists the day newest first', async () => {
      await member('IH-0001', '3001000001', addDays(today, 20));
      await member('IH-0002', '3001000002', addDays(today, -10)); // overdue beyond grace
      expect((await as(t.reception).post('/v1/checkins/scan', { code: 'ih-0001' })).body).toMatchObject({ ok: true, allowed: true });
      const blocked = await as(t.reception).post('/v1/checkins/scan', { code: 'IH-0002' });
      expect(blocked.body).toMatchObject({
        ok: true, allowed: false, amountDue: 4000, message: `Fee overdue since ${formatShortDate(addDays(today, -10))}`,
      });
      expect((await as(t.reception).post('/v1/checkins/scan', { code: 'GYM1.gym-a.IH-0001.1.AAAAAAAAAAAAAAAA' })).body)
        .toEqual({ ok: false, message: 'This code is not valid. Ask the member to open the app again.' });

      const log = await as(t.reception).get(`/v1/checkins?date=${today}`);
      expect(log.status).toBe(200);
      expect(log.body.map((c: { memberCode: string | null; allowed: boolean; source: string }) => [c.memberCode, c.allowed, c.source]))
        .toEqual([[null, false, 'qr'], ['IH-0002', false, 'manual'], ['IH-0001', true, 'manual']]);
      expect(log.body.every((c: { scannedBy: string }) => c.scannedBy === a.reception.id)).toBe(true);
      expect((await as(t.reception).get(`/v1/checkins?date=${addDays(today, -1)}`)).body).toEqual([]);
    });

    it("§11: another gym's scan and log never see this gym's members", async () => {
      expect((await as(t.receptionB).post('/v1/checkins/scan', { code: 'IH-0001' })).body).toEqual({ ok: false, message: 'No member with ID IH-0001 at this gym.' });
      const logB = await as(t.receptionB).get('/v1/checkins');
      expect(logB.body.every((c: { memberId: string | null }) => c.memberId === null)).toBe(true);
    });

  });

  describe('approvals: payment screenshots and freezes', () => {
    let memberToken: string;
    let proofId: string;

    beforeAll(async () => {
      ({ token: memberToken } = await member('IH-0010', '3001000010', addDays(today, 5)));
    });

    it('member uploads a screenshot; non-images and files over 6 MB are refused', async () => {
      const up = await http().post('/v1/me/payment-proofs').set('Authorization', `Bearer ${memberToken}`).attach('file', PNG, 'proof.png');
      expect(up.status).toBe(201);
      proofId = up.body.id;
      const text = await http().post('/v1/me/payment-proofs').set('Authorization', `Bearer ${memberToken}`).attach('file', Buffer.from('hello'), 'x.png');
      expect(text.body).toEqual({ message: 'Upload an image (JPG, PNG, WebP or HEIC).' });
      const big = await http().post('/v1/me/payment-proofs').set('Authorization', `Bearer ${memberToken}`)
        .attach('file', Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), 'big.png');
      expect(big.status).toBe(413);
      expect(big.body).toEqual({ message: 'The screenshot must be 6 MB or smaller.' });
      const none = await http().post('/v1/me/payment-proofs').set('Authorization', `Bearer ${memberToken}`);
      expect(none.body).toEqual({ message: 'Choose a screenshot to upload.' });
    });

    it('§11: reception sees it with a signed link that works, and the link cannot be forged or used without a signature', async () => {
      const list = await as(t.reception).get('/v1/payment-proofs');
      const item = list.body.find((p: { id: string }) => p.id === proofId);
      expect(item).toMatchObject({ memberCode: 'IH-0010', status: 'pending', feePkr: 4000 });
      expect(item.imageUrl).toMatch(new RegExp(`^/v1/files/proofs/${proofId}\\?exp=\\d+&sig=`));
      const img = await http().get(item.imageUrl);
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(Buffer.from(img.body).equals(PNG)).toBe(true);
      expect((await http().get(`/v1/files/proofs/${proofId}`)).status).toBe(404);
      expect((await http().get(item.imageUrl.replace(/sig=.{4}/, 'sig=AAAA'))).status).toBe(404);
      expect((await as(t.receptionB).get('/v1/payment-proofs')).body).toEqual([]);
    });

    it('approving records a payment with the confirmed amount and method, linked to the screenshot', async () => {
      const res = await as(t.reception).post(`/v1/payment-proofs/${proofId}/approve`, { amountPkr: 3900, method: 'easypaisa' });
      expect(res.status).toBe(200);
      expect(res.body.payment).toMatchObject({ amountPkr: 3900, method: 'easypaisa', proofId, recordedBy: a.reception.id, periodFrom: addDays(today, 5) });
      expect(res.body.newDueOn).toBe(addMonths(addDays(today, 5), 1));
      const again = await as(t.reception).post(`/v1/payment-proofs/${proofId}/approve`, { amountPkr: 3900, method: 'easypaisa' });
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ message: ALREADY_HANDLED });
      expect((await http().get('/v1/me/membership').set('Authorization', `Bearer ${memberToken}`)).body.pendingProof).toBeNull();
    });

    it('rejecting changes nothing else', async () => {
      const up = await http().post('/v1/me/payment-proofs').set('Authorization', `Bearer ${memberToken}`).attach('file', PNG, 'p.png');
      const before = await ctx.db.select().from(payments);
      const res = await as(t.owner).post(`/v1/payment-proofs/${up.body.id}/reject`);
      expect(res.body).toEqual({ id: up.body.id, status: 'rejected' });
      expect(await ctx.db.select().from(payments)).toHaveLength(before.length);
    });

    it('a 7-day freeze moves the due date 7 days and blocks entry during the freeze (§13 acceptance)', async () => {
      const req = await http().post('/v1/me/freeze').set('Authorization', `Bearer ${memberToken}`).send({ days: 7, reason: 'travel' });
      expect(req.status).toBe(201);
      expect((await http().post('/v1/me/freeze').set('Authorization', `Bearer ${memberToken}`).send({ days: 2, reason: 'travel' })).body)
        .toEqual({ message: 'A freeze must be 3 to 15 days.' });
      const [m] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0010'));
      const pending = (await as(t.reception).get('/v1/freeze-requests')).body.find((f: { id: string }) => f.id === req.body.id);
      expect(pending).toMatchObject({ days: 7, reason: 'travel', dueOn: m!.dueOn, newDueOn: addDays(m!.dueOn!, 7) });

      const ok = await as(t.reception).post(`/v1/freeze-requests/${req.body.id}/approve`);
      expect(ok.body).toMatchObject({ status: 'approved' });
      const [after] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0010'));
      expect(after).toMatchObject(applyFreeze(m!.dueOn, 7, today));
      expect((await as(t.reception).post('/v1/checkins/scan', { code: 'IH-0010' })).body)
        .toMatchObject({ ok: true, allowed: false, message: `Membership frozen until ${formatShortDate(addDays(today, 6))}` });
      expect((await as(t.reception).post(`/v1/freeze-requests/${req.body.id}/reject`)).status).toBe(409);
    });
  });

  describe('members: list, page, edit', () => {
    it('lists with search by name, ID or phone, and a status filter', async () => {
      const all = await as(t.reception).get('/v1/members');
      expect(all.body.map((m: { code: string }) => m.code).sort()).toEqual(['IH-0001', 'IH-0002', 'IH-0010']);
      expect((await as(t.reception).get('/v1/members?q=ih-0002')).body.map((m: { code: string }) => m.code)).toEqual(['IH-0002']);
      expect((await as(t.reception).get('/v1/members?q=0300 1000001')).body.map((m: { code: string }) => m.code)).toEqual(['IH-0001']);
      const overdue = await as(t.reception).get('/v1/members?status=overdue');
      expect(overdue.body.every((m: { status: string }) => m.status === 'overdue')).toBe(true);
      expect((await as(t.receptionB).get('/v1/members')).body).toEqual([]);
    });

    it('member page has status, payments, check-ins, WhatsApp messages and visits', async () => {
      const res = await as(t.reception).get('/v1/members/IH-0010');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ code: 'IH-0010', status: 'frozen', active: true });
      expect(res.body.payments.length).toBeGreaterThanOrEqual(2);
      expect(res.body.checkins.length).toBeGreaterThanOrEqual(1);
      expect(res.body.whatsapp[0].link).toMatch(/^https:\/\/wa\.me\/92300/);
      expect((await as(t.receptionB).get('/v1/members/IH-0010')).status).toBe(404);
    });

    it('reception edits details; only the owner changes the due date, and every change is logged', async () => {
      const edit = await as(t.reception).patch('/v1/members/IH-0001', { notes: 'Knee injury', goal: 'fitness' });
      expect(edit.body).toMatchObject({ notes: 'Knee injury', goal: 'fitness' });
      const denied = await as(t.reception).patch('/v1/members/IH-0001', { dueOn: addDays(today, 40) });
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ message: OWNER_ONLY_DUE_DATE });

      const [before] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0001'));
      const ok = await as(t.owner).patch('/v1/members/IH-0001', { dueOn: addDays(today, 40) });
      expect(ok.body.dueOn).toBe(addDays(today, 40));
      expect(ok.body.dueDateChanges[0]).toMatchObject({ oldDueOn: before!.dueOn, newDueOn: addDays(today, 40), changedBy: a.owner.id });
      expect(await ctx.db.select().from(dueDateChanges).where(eq(dueDateChanges.memberId, before!.userId))).toHaveLength(1);
    });

    it('Disable/Enable stores the account flag (§6)', async () => {
      expect((await as(t.owner).patch('/v1/members/IH-0002', { active: false })).body.active).toBe(false);
      expect((await as(t.owner).patch('/v1/members/IH-0002', { active: true })).body.active).toBe(true);
    });

    it('reset password: back to the §7 default (last 6 digits), returned once, stored hashed', async () => {
      const res = await as(t.reception).post('/v1/members/IH-0001/reset-password');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ password: '000001' });
      const [m] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0001'));
      const [u] = await ctx.db.select().from(users).where(eq(users.id, m!.userId));
      expect(u!.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect((await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: '03001000001', password: '000001' })).status).toBe(200);
      expect((await as(t.receptionB).post('/v1/members/IH-0001/reset-password')).status).toBe(404);
      expect((await as(t.trainer).post('/v1/members/IH-0001/reset-password')).status).toBe(403);
    });

    it('refuses a phone or thumbprint ID that belongs to another member', async () => {
      expect((await as(t.reception).patch('/v1/members/IH-0001', { phone: '0300 1000002' })).status).toBe(409);
      expect((await as(t.reception).patch('/v1/members/IH-0002', { fingerprintId: '33' })).status).toBe(200);
      expect((await as(t.reception).patch('/v1/members/IH-0001', { fingerprintId: '33' })).status).toBe(409);
    });

  });

  describe('dashboard and reports', () => {
    it('dashboard: counts, fees this month, overdue and due in the next 5 days', async () => {
      const res = await as(t.reception).get('/v1/dashboard');
      expect(res.status).toBe(200);
      const all = await ctx.db.select().from(payments).where(eq(payments.gymId, 'gym-a'));
      const todayScans = await ctx.db.select().from(checkins).where(eq(checkins.gymId, 'gym-a'));
      expect(res.body).toMatchObject({ feesThisMonthPkr: all.reduce((s, p) => s + p.amountPkr, 0), checkinsToday: todayScans.length, pendingFreezes: 0 });
      expect(res.body.overdue.map((m: { code: string }) => m.code)).toEqual(['IH-0002']);
      expect(res.body.overduePkr).toBe(4000);
      expect(res.body.dueSoon.every((m: { dueOn: string }) => m.dueOn >= today && m.dueOn <= addDays(today, 5))).toBe(true);
    });

    it('reports are owner only (reception gets 403, §13); fees by month, check-ins and might-quit', async () => {
      expect((await as(t.reception).get('/v1/reports')).status).toBe(403);
      const res = await as(t.owner).get('/v1/reports');
      expect(res.status).toBe(200);
      expect(res.body.feesByMonth).toHaveLength(6);
      expect(res.body.feesByMonth[5].month).toBe(today.slice(0, 7));
      expect(res.body.checkinsByHour).toHaveLength(24);
      expect(res.body.dailyCheckins).toHaveLength(30);
      const scans = await ctx.db.select().from(checkins).where(eq(checkins.gymId, 'gym-a'));
      expect(res.body.dailyCheckins[29]).toEqual({ date: today, count: scans.length });
      expect(res.body.thisMonthByMethod.map((m: { method: string }) => m.method)).toEqual(['cash', 'jazzcash', 'easypaisa', 'bank']);
      expect(res.body.mightQuit.map((m: { code: string }) => m.code)).not.toContain('IH-0001');
    });
  });

  describe('WhatsApp log and announcements', () => {
    it('lists To send / Sent with wa.me links, and Mark sent', async () => {
      const toSend = await as(t.reception).get('/v1/whatsapp?status=to_send');
      expect(toSend.body.length).toBeGreaterThan(0);
      const msg = toSend.body[0];
      expect(msg.link).toBe(`https://wa.me/92${msg.toPhone}?text=${encodeURIComponent(msg.body)}`);
      const sent = await as(t.reception).patch(`/v1/whatsapp/${msg.id}`, { status: 'sent' });
      expect(sent.body.status).toBe('sent');
      expect((await as(t.reception).get('/v1/whatsapp?status=sent')).body.map((m: { id: string }) => m.id)).toContain(msg.id);
      expect((await as(t.receptionB).patch(`/v1/whatsapp/${msg.id}`, { status: 'sent' })).status).toBe(404);
    });

    it('§7 fee reminders: overdue and due within 3 days, at most once in 7 days per member; never frozen members; an unpaid member is due from joining', async () => {
      const { memberId: dueIn2 } = await member('IH-0030', '3001000030', addDays(today, 2));
      const { memberId: dueIn4 } = await member('IH-0031', '3001000031', addDays(today, 4));
      const { memberId: frozenDue } = await member('IH-0032', '3001000032', addDays(today, 1), { frozenUntil: addDays(today, 3) });
      const { memberId: frozenOverdue } = await member('IH-0033', '3001000033', addDays(today, -9), { frozenUntil: today });
      // Fixture members above were inserted with fixed codes; move the running number past them.
      await ctx.db.update(gyms).set({ lastMemberNumber: 900 }).where(eq(gyms.id, 'gym-a'));
      const unpaid = await as(t.reception).post('/v1/members', { name: 'No Pay', phone: '0300 1000034', joinedOn: today, planId: a.planId });
      expect(unpaid.status).toBe(201);
      const [overdue] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0002'));

      const first = await as(t.reception).post('/v1/whatsapp/reminders');
      expect(first.status).toBe(200);
      const reminders = (await as(t.reception).get('/v1/whatsapp?status=to_send')).body.filter((m: { kind: string }) => m.kind === 'reminder');
      const ids = reminders.map((m: { memberId: string }) => m.memberId);
      expect(ids).toContain(overdue!.userId);
      expect(ids).toContain(dueIn2);
      expect(ids).not.toContain(dueIn4);
      expect(ids).not.toContain(frozenDue);
      expect(ids).not.toContain(frozenOverdue);
      // Registered today with no payment: due today (the joining date), so within 3 days.
      expect(ids).toContain(unpaid.body.memberId);
      expect(first.body).toEqual({ queued: reminders.length });
      expect(reminders.find((m: { memberId: string }) => m.memberId === dueIn2).body).toBe(
        `Assalam o Alaikum IH-0030, your Iron House Fitness fee of PKR 4,000 is due on ${formatShortDate(addDays(today, 2))}. Please pay to keep your membership active. Thank you!`,
      );
      expect(reminders.find((m: { memberId: string }) => m.memberId === overdue!.userId).body).toContain(`was due on ${formatShortDate(overdue!.dueOn!)}`);

      expect((await as(t.reception).post('/v1/whatsapp/reminders')).body).toEqual({ queued: 0 });
      expect((await as(t.receptionB).get('/v1/whatsapp')).body.some((m: { kind: string }) => m.kind === 'reminder')).toBe(false);
      expect((await as(t.trainer).post('/v1/whatsapp/reminders')).status).toBe(403);
    });

    it('announcements: post with an optional WhatsApp copy to active members, shown to members, delete', async () => {
      const res = await as(t.reception).post('/v1/announcements', { title: 'Closed Friday 12–2', body: 'Jummah prayers.', sendWhatsApp: true });
      expect(res.status).toBe(201);
      expect(res.body.whatsappQueued).toBeGreaterThan(0);
      const { token } = await member('IH-0020', '3001000020', addDays(today, 20));
      expect((await http().get('/v1/announcements').set('Authorization', `Bearer ${token}`)).body[0]).toMatchObject({ title: 'Closed Friday 12–2' });
      expect((await as(t.receptionB).get('/v1/announcements')).body).toEqual([]);
      expect((await as(t.reception).del(`/v1/announcements/${res.body.id}`)).status).toBe(204);
      expect((await as(t.reception).get('/v1/announcements')).body).toEqual([]);
    });
  });

  describe('setup (owner): fee plans, staff, settings; brand and exercises', () => {
    it('fee plans: reception can list; only the owner can add, edit and hide', async () => {
      expect((await as(t.reception).get('/v1/plans')).body).toHaveLength(1);
      expect((await as(t.reception).post('/v1/plans', { name: 'X', feePkr: 1, months: 1 })).status).toBe(403);
      const add = await as(t.owner).post('/v1/plans', { name: 'Quarterly', timing: null, feePkr: 11000, months: 3 });
      expect(add.body).toMatchObject({ name: 'Quarterly', feePkr: 11000, months: 3, active: true });
      const hide = await as(t.owner).patch(`/v1/plans/${add.body.id}`, { active: false });
      expect(hide.body.active).toBe(false);
      expect((await as(t.ownerB).patch(`/v1/plans/${add.body.id}`, { active: true })).status).toBe(404);
    });

    it('staff: add, disable/enable; owners cannot disable themselves', async () => {
      const add = await as(t.owner).post('/v1/staff', { name: 'New Desk', phone: '0333 1234567', role: 'reception', password: 'start-123' });
      expect(add.body).toMatchObject({ name: 'New Desk', phone: '3331234567', role: 'reception', active: true });
      expect((await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: '03331234567', password: 'start-123' })).status).toBe(200);
      expect((await as(t.owner).patch(`/v1/staff/${add.body.id}`, { active: false })).body.active).toBe(false);
      const self = await as(t.owner).patch(`/v1/staff/${a.owner.id}`, { active: false });
      expect(self.status).toBe(403);
      expect(self.body).toEqual({ message: CANNOT_DISABLE_SELF });
      expect((await as(t.owner).get('/v1/staff')).body.every((s: { role: string }) => s.role !== 'member' as string)).toBe(true);
    });

    it('§10: reception can list staff (GET staff) but only the owner can add or change staff', async () => {
      const list = await as(t.reception).get('/v1/staff');
      expect(list.status).toBe(200);
      expect(list.body.map((s: { id: string }) => s.id)).toContain(a.trainer.id);
      expect((await as(t.receptionB).get('/v1/staff')).body.map((s: { id: string }) => s.id)).not.toContain(a.trainer.id);
      expect((await as(t.reception).post('/v1/staff', { name: 'X', phone: '0333 7654321', role: 'reception', password: 'x' })).status).toBe(403);
      expect((await as(t.reception).patch(`/v1/staff/${a.trainer.id}`, { active: false })).status).toBe(403);
      expect((await as(t.trainer).get('/v1/staff')).status).toBe(403);
    });

    it('settings: owner reads and edits; the check-in secret is never returned', async () => {
      const res = await as(t.owner).patch('/v1/settings', {
        graceDays: 5, payTo: { label: 'JazzCash', number: '0300 1112223', title: 'Iron House' }, receptionWhatsapp: '03001112223',
      });
      expect(res.body).toMatchObject({ graceDays: 5, payTo: { label: 'JazzCash' }, deviceKey: 'device-a' });
      expect(JSON.stringify(res.body)).not.toContain('secret-gym-a');
      expect((await as(t.reception).get('/v1/settings')).status).toBe(403);
    });

    it('brand is public and exposes no secrets; exercises are built-in plus own gym', async () => {
      const brand = await http().get('/v1/gyms/gym-a');
      expect(brand.body).toMatchObject({ id: 'gym-a', name: 'Iron House Fitness', graceDays: 5, payTo: { label: 'JazzCash' } });
      expect(JSON.stringify(brand.body)).not.toMatch(/secret|device/);
      expect((await http().get('/v1/gyms/nope')).status).toBe(404);
      expect((await as(t.trainer).get('/v1/exercises')).body).toHaveLength(17);
    });
  });

  describe('trainer plans', () => {
    it('lists recent plans and deletes one; another trainer cannot delete it', async () => {
      const [m] = await ctx.db.select().from(members).where(eq(members.code, 'IH-0001'));
      await ctx.db.update(members).set({ trainerId: a.trainer.id }).where(eq(members.userId, m!.userId));
      const created = await as(t.trainer).post('/v1/trainer/plans', {
        name: 'Push', date: today, memberIds: [m!.userId],
        items: [{ exerciseId: 'bench', sets: 4, reps: 6, weightMode: 'fixed', kg: 60, pct: null, warmups: true, restSec: 120, note: null, canChange: false }],
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ sentTo: 1, plan: { name: 'Push', memberIds: [m!.userId] } });
      expect((await as(t.trainer).get('/v1/trainer/plans')).body.map((p: { id: string }) => p.id)).toContain(created.body.plan.id);
      const other = await login(ctx.app, 'gym-a', a.trainer2.phone);
      expect((await as(other).del(`/v1/trainer/plans/${created.body.plan.id}`)).status).toBe(404);
      expect((await as(t.trainer).del(`/v1/trainer/plans/${created.body.plan.id}`)).status).toBe(204);
    });

    it('validates the §9 plan item shape', async () => {
      const bad = await as(t.trainer).post('/v1/trainer/plans', {
        name: 'X', date: today, memberIds: [crypto.randomUUID()],
        items: [{ exerciseId: 'bench', sets: 11, reps: 6, weightMode: 'fixed', kg: 60, pct: null, warmups: true, restSec: 120, note: null, canChange: false }],
      });
      expect(bad.body).toEqual({ message: 'Sets must be 1 to 10.' });
    });
  });
});
