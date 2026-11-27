import { addDays, pkToday } from '@gym/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The web admin's real API client (admin/src/lib/api.ts), not a copy.
import { ApiError, createAdminApi, type AdminApi } from '../../admin/src/lib/api';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { seedGym, STAFF_PASSWORD, type GymFixture } from './helpers/staff';

/**
 * §11 Testing, for the web admin: runs the admin's API client against a live API
 * server (in-memory PGlite; never Neon) and drives every page's calls in a full
 * fee cycle: register → check in → blocked → pay → allowed; screenshot and freeze
 * approvals; WhatsApp log; announcements; setup pages; trainer plans; role limits.
 * Excluded from the API's `tsc`; the admin's own typecheck covers admin/src/lib/api.ts.
 */
describe("contract: the web admin's API client against a live API server", () => {
  let ctx: TestContext;
  let gym: GymFixture;
  let baseUrl: string;
  let unauthorized = 0;
  const reachable: boolean[] = [];
  const client = (): AdminApi =>
    createAdminApi(baseUrl, { onUnauthorized: () => unauthorized++, onReachable: (r) => reachable.push(r) });
  const today = pkToday();
  let owner: AdminApi;
  let reception: AdminApi;
  let trainer: AdminApi;
  let memberCode: string;
  let memberId: string;
  let memberToken: string;

  const asMember = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}/v1/${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${memberToken}` } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as { port: number }).port}`;
    gym = await seedGym(ctx.db, 'ironhouse', 'Iron House Fitness', 'IH');
    [owner, reception, trainer] = [client(), client(), client()];
  });
  afterAll(() => closeTestApp(ctx));

  it('login for each staff role (any phone format), brand, and auth/me', async () => {
    const o = await owner.login({ gymId: 'ironhouse', phone: '0300-0000001', password: STAFF_PASSWORD });
    owner.setToken(o.token);
    expect(o.user).toMatchObject({ role: 'owner', gymId: 'ironhouse' });
    reception.setToken((await reception.login({ gymId: 'ironhouse', phone: '+92 300 0000002', password: STAFF_PASSWORD })).token);
    trainer.setToken((await trainer.login({ gymId: 'ironhouse', phone: '3000000003', password: STAFF_PASSWORD })).token);
    expect(await reception.me()).toMatchObject({ role: 'reception', name: 'Reception' });
    expect(await reception.getGym('ironhouse')).toMatchObject({ name: 'Iron House Fitness', graceDays: 3 });
  });

  it('a wrong password shows the one login error and does not trigger log-out', async () => {
    await expect(client().login({ gymId: 'ironhouse', phone: '03000000002', password: 'nope' }))
      .rejects.toMatchObject({ message: 'Wrong phone number or password.', status: 401 });
    expect(unauthorized).toBe(0);
  });

  it('Register your gym: the new owner signs in with the returned Gym Code; a duplicate email is a plain error', async () => {
    const api = client();
    const form = {
      gymName: 'Fit Zone', gymEmail: 'hello@fitzone.pk', gymPhone: '021 3456 7890', gymAddress: '5 Shahrah-e-Faisal', city: 'Karachi',
      ownerName: 'Sana Ali', ownerEmail: 'sana@fitzone.pk', ownerPhone: '0333-7654321', password: 'fitzone123', confirmPassword: 'fitzone123',
    };
    const res = await api.registerGym(form);
    expect(res).toEqual({ gymId: 'fit-zone', gymName: 'Fit Zone', ownerName: 'Sana Ali', ownerPhone: '3337654321' });
    const signedIn = await api.login({ gymId: res.gymId, phone: '03337654321', password: 'fitzone123' });
    expect(signedIn.user).toMatchObject({ role: 'owner', gymId: 'fit-zone' });
    await expect(client().registerGym({ ...form, gymName: 'Fit Zone Two', ownerEmail: 'other@fitzone.pk' }))
      .rejects.toMatchObject({ message: 'A gym with this email is already registered.', status: 409 });
    expect(unauthorized).toBe(0);
  });

  it('Add member: plans and trainers for the form, register, duplicate phone refused', async () => {
    expect((await reception.feePlans()).map((p) => p.id)).toContain(gym.planId);
    expect((await reception.staff()).filter((s) => s.role === 'trainer')).toHaveLength(2);

    const reg = await reception.registerMember({
      name: 'Ali Raza', phone: '0300 1234567', joinedOn: today, planId: gym.planId, trainerId: gym.trainer.id, goal: 'strength',
      gender: 'male', payment: { amountPkr: 4000, method: 'cash', txnId: null },
    });
    expect(reg).toMatchObject({ code: 'IH-0001', temporaryPassword: '234567' });
    memberCode = reg.code;
    memberId = reg.memberId;
    await expect(reception.registerMember({
      name: 'Copy', phone: '03001234567', joinedOn: today, planId: gym.planId, payment: { amountPkr: 4000, method: 'cash' },
    })).rejects.toMatchObject({ status: 409 });

    const kinds = (await reception.whatsapp('to_send')).map((m) => m.kind).sort();
    expect(kinds).toEqual(['receipt', 'welcome']);
  });

  it('Add member without the optional first payment: no payment, no receipt, no due date; paying later sets it', async () => {
    const reg = await reception.registerMember({ name: 'Sara Khan', phone: '0321 7654321', joinedOn: today, planId: gym.planId, payment: null });
    expect(reg).toMatchObject({ code: 'IH-0002', temporaryPassword: '654321', dueOn: null, payment: null });
    const detail = await reception.member(reg.code);
    expect(detail).toMatchObject({ dueOn: null, payments: [] });
    expect(detail.whatsapp.map((m) => [m.kind, m.body])).toEqual([
      ['welcome', 'Welcome to Iron House Fitness! Your fitness journey starts today. Stay active, stay healthy!'],
    ]);
    expect(detail.whatsapp[0]!.link).toMatch(/^https:\/\/wa\.me\/923217654321\?text=Welcome%20to%20Iron%20House%20Fitness/);
    expect(await reception.payments({ member: reg.code })).toEqual([]);

    const paid = await reception.recordPayment({ memberCode: reg.code, amountPkr: 4000, method: 'cash' });
    expect(paid.payment).toMatchObject({ periodFrom: today });
    expect((await reception.member(reg.code)).dueOn).toBe(paid.newDueOn);
  });

  it('Members: search, filter and the member page', async () => {
    expect((await reception.members({ q: 'ali' })).map((m) => m.code)).toEqual([memberCode]);
    expect((await reception.members({ q: '1234567' })).map((m) => m.code)).toEqual([memberCode]);
    expect(await reception.members({ status: 'overdue' })).toEqual([]);
    const detail = await reception.member(memberCode.toLowerCase());
    expect(detail).toMatchObject({ code: memberCode, trainerName: 'Trainer One', status: 'active', visitsLast30Days: 0 });
    expect(detail.payments).toHaveLength(1);
  });

  it('Check-ins: allowed, then (owner backdates the due date) blocked, take payment, allowed', async () => {
    expect(await reception.scan(memberCode)).toMatchObject({ ok: true, allowed: true });

    const backdated = await owner.updateMember(memberCode, { dueOn: addDays(today, -10) });
    expect(backdated.dueDateChanges).toHaveLength(1);
    await expect(reception.updateMember(memberCode, { dueOn: today })).rejects.toMatchObject({ status: 403 });

    const blocked = await reception.scan(memberCode);
    expect(blocked).toMatchObject({ ok: true, allowed: false, amountDue: 4000 });
    const paid = await reception.recordPayment({ memberCode, amountPkr: 4000, method: 'jazzcash', txnId: 'TX1' });
    expect(paid.payment.periodFrom).toBe(today);
    expect(paid.message).toMatch(/^Renewed to .+\. Receipt queued for WhatsApp$/);
    expect(await reception.scan(memberCode)).toMatchObject({ ok: true, allowed: true });

    const log = await reception.checkins(today);
    expect(log.map((c) => c.allowed)).toEqual(expect.arrayContaining([true, false]));
    expect(log.every((c) => c.source === 'manual' && c.scannedBy)).toBe(true);
    expect(await reception.checkins(addDays(today, -1))).toEqual([]);
    expect(await reception.scan('IH-9999')).toEqual({ ok: false, message: 'No member with ID IH-9999 at this gym.' });
  });

  it('Fees: approvals (screenshot approve and renew, freeze approve) and payments by period', async () => {
    memberToken = (await client().login({ gymId: 'ironhouse', phone: '03001234567', password: '234567' })).token;
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' }), 'proof.png');
    expect((await asMember('me/payment-proofs', { method: 'POST', body: form })).status).toBe(201);
    const freezeRes = await asMember('me/freeze', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: 7, reason: 'travel' }),
    });
    expect(freezeRes.status).toBe(201);

    const proofs = await reception.paymentProofs('pending');
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ memberCode, feePkr: 4000 });
    const image = await fetch(reception.absolute(proofs[0]!.imageUrl));
    expect(image.status).toBe(200);

    const freezes = await reception.freezeRequests('pending');
    expect(freezes).toHaveLength(1);
    const dueBefore = (await reception.member(memberCode)).dueOn;
    expect(freezes[0]).toMatchObject({ days: 7, reason: 'travel', dueOn: dueBefore, newDueOn: addDays(dueBefore, 7) });
    expect((await reception.approveFreeze(freezes[0]!.id)).status).toBe('approved');
    expect(await reception.scan(memberCode)).toMatchObject({ ok: true, allowed: false });

    const approved = await reception.approveProof(proofs[0]!.id, { amountPkr: 3500, method: 'easypaisa' });
    expect(approved.payment).toMatchObject({ amountPkr: 3500, method: 'easypaisa', proofId: proofs[0]!.id });
    expect(await reception.paymentProofs('pending')).toEqual([]);

    const todays = (await reception.payments({ from: today, to: today })).filter((p) => p.memberId === memberId);
    expect(todays.map((p) => p.amountPkr).sort()).toEqual([3500, 4000, 4000]);
    expect((await reception.payments({ from: today, to: today, member: memberCode })).length).toBe(3);
    expect(await reception.payments({ from: addDays(today, -60), to: addDays(today, -40) })).toEqual([]);
  });

  it('Overview dashboard numbers', async () => {
    const d = await reception.dashboard();
    expect(d).toMatchObject({ pendingProofs: 0, pendingFreezes: 0, joinedThisMonth: 2, feesThisMonthPkr: 15500 });
    expect(d.checkinsToday).toBeGreaterThan(0);
  });

  it('Member actions: reset password (shown once) and disable/enable', async () => {
    expect(await reception.resetPassword(memberCode)).toEqual({ password: '234567' });
    expect((await reception.updateMember(memberCode, { active: false })).active).toBe(false);
    expect((await reception.updateMember(memberCode, { active: true, notes: 'Knee injury' })).notes).toBe('Knee injury');
  });

  it('WhatsApp: fee reminders, mark sent, sent list; announcements with a WhatsApp copy', async () => {
    expect(await reception.queueFeeReminders()).toEqual({ queued: 0 });
    const toSend = (await reception.whatsapp('to_send')).filter((m) => m.memberId === memberId);
    expect(toSend.length).toBeGreaterThan(0);
    expect(toSend[0]!.link).toMatch(/^https:\/\/wa\.me\/923001234567\?text=/);
    const sent = await reception.setWhatsappStatus(toSend[0]!.id, 'sent');
    expect(sent.status).toBe('sent');
    expect((await reception.whatsapp('sent')).map((m) => m.id)).toContain(sent.id);

    const a = await reception.createAnnouncement({ title: 'Closed Friday', body: 'Jummah 12–2', sendWhatsApp: true });
    expect(a.whatsappQueued).toBe(2);
    expect((await reception.announcements()).map((x) => x.id)).toContain(a.id);
    await reception.deleteAnnouncement(a.id);
    expect(await reception.announcements()).toEqual([]);
  });

  it('Owner setup pages: fee plans, staff, settings, reports', async () => {
    const plan = await owner.createFeePlan({ name: 'Ladies', timing: 'Ladies timings', feePkr: 3500, months: 1 });
    expect((await owner.updateFeePlan(plan.id, { active: false })).active).toBe(false);

    const s = await owner.createStaff({ name: 'Sana', phone: '0333 7654321', role: 'reception', password: 'start-123' });
    expect(s).toMatchObject({ phone: '3337654321', role: 'reception', active: true });
    expect((await owner.updateStaff(s.id, { active: false })).active).toBe(false);
    await expect(owner.updateStaff(gym.owner.id, { active: false })).rejects.toMatchObject({ status: 403 });

    const settings = await owner.settings();
    expect(settings).not.toHaveProperty('checkinSecret');
    const updated = await owner.updateSettings({ graceDays: 5, payTo: { label: 'JazzCash', number: '03001112222', title: 'Iron House' } });
    expect(updated).toMatchObject({ graceDays: 5, payTo: { label: 'JazzCash' } });

    const r = await owner.reports();
    expect(r.feesByMonth).toHaveLength(6);
    expect(r.checkinsByHour).toHaveLength(24);
    expect(r.dailyCheckins).toHaveLength(30);
  });

  it('Training plans: clients, bests, send to clients, recent plans, reuse data, delete', async () => {
    expect(await trainer.trainerToday()).toEqual([]);
    const clients = await trainer.trainerClients();
    expect(clients.map((c) => c.memberId)).toEqual([memberId]);
    expect(await trainer.clientBests(memberId)).toEqual([]);
    expect((await trainer.exercises()).length).toBe(17);

    const res = await trainer.createTrainerPlan({
      name: 'Legs', date: addDays(today, 1), memberIds: [memberId],
      items: [
        { exerciseId: 'squat', sets: 5, reps: 5, weightMode: 'pct', kg: null, pct: 75, warmups: true, restSec: 120, note: null, canChange: false },
        { exerciseId: 'squat', sets: 3, reps: 8, weightMode: 'fixed', kg: 60, pct: null, warmups: false, restSec: 90, note: 'Pause', canChange: true },
      ],
    });
    expect(res.sentTo).toBe(1);
    const recent = await trainer.trainerPlans();
    expect(recent.map((p) => p.id)).toEqual([res.plan.id]);
    expect(recent[0]!.items).toHaveLength(2);
    await expect(trainer.createTrainerPlan({ ...res.plan, date: addDays(today, -1), memberIds: [memberId] }))
      .rejects.toMatchObject({ status: 400, message: 'Plans cannot be written for past days.' });
    await trainer.deleteTrainerPlan(res.plan.id);
    expect(await trainer.trainerPlans()).toEqual([]);
    expect((await owner.trainerClients()).map((c) => c.memberId)).toContain(memberId);
    expect((await owner.trainerClients()).length).toBe(2);
  });

  it('§13: reception cannot open Reports, Staff changes, Fee plan changes or Settings; trainer cannot use the desk', async () => {
    for (const call of [
      () => reception.reports(),
      () => reception.settings(),
      () => reception.createStaff({ name: 'X', phone: '03331234567', role: 'trainer', password: 'x' }),
      () => reception.createFeePlan({ name: 'X', feePkr: 1, months: 1 }),
      () => trainer.dashboard(),
      () => trainer.members(),
      () => trainer.scan(memberCode),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
    expect(unauthorized).toBe(0);
  });

  it('a member token is refused on staff routes (the admin login page refuses members)', async () => {
    const m = client();
    const res = await m.login({ gymId: 'ironhouse', phone: '03001234567', password: '234567' });
    expect(res.user.role).toBe('member');
    m.setToken(res.token);
    await expect(m.dashboard()).rejects.toMatchObject({ status: 403 });
  });

  it('an invalid token triggers log-out; an unreachable server is a network error', async () => {
    const stale = client();
    stale.setToken('not-a-token');
    await expect(stale.dashboard()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(1);

    const down = createAdminApi('http://127.0.0.1:1', { networkErrorMessage: 'Offline' });
    const err = await down.dashboard().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ network: true, status: 0, message: 'Offline' });
    expect(reachable.every((r) => r)).toBe(true);
  });
});
