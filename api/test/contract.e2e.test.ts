import { addDays, buildCheckinQr, pkToday } from '@gym/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The mobile app's real API client (app/src/api/http.ts), not a copy.
import { createHttpApi } from '../../app/src/api/http';
import type { GymApi } from '../../app/src/api/types';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { login, seedGym, type GymFixture } from './helpers/staff';

/**
 * §11 Testing: "A contract test running the app's API client against a live server".
 * Excluded from the API's `tsc` (the client uses React Native/DOM types); the app's
 * own typecheck covers app/src/api/http.ts.
 * Starts the API on a real port and drives every method the mobile app calls.
 */
describe("contract: the mobile app's API client against a live API server", () => {
  let ctx: TestContext;
  let gym: GymFixture;
  let baseUrl: string;
  let unauthorized = 0;
  const client = (): GymApi => createHttpApi(baseUrl, () => unauthorized++);
  const today = pkToday();
  let member: GymApi;
  let reception: GymApi;
  let trainer: GymApi;
  let memberId: string;
  let memberCode: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0, '127.0.0.1');
    const address = ctx.app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    [member, reception, trainer] = [client(), client(), client()];
    gym = await seedGym(ctx.db, 'ironhouse', 'Iron House Fitness', 'IH');

    // Register a member through the API as reception would (web admin), assigned to the trainer.
    const recToken = await login(ctx.app, 'ironhouse', gym.reception.phone);
    const reg = await fetch(`${baseUrl}/v1/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${recToken}` },
      body: JSON.stringify({
        name: 'Ali Raza', phone: '0300-1234567', joinedOn: today, planId: gym.planId, trainerId: gym.trainer.id, goal: 'strength',
        payment: { amountPkr: 4000, method: 'cash' },
      }),
    }).then((r) => r.json() as Promise<{ memberId: string; code: string; temporaryPassword: string }>);
    memberId = reg.memberId;
    memberCode = reg.code;
  });
  afterAll(() => closeTestApp(ctx));

  it('login, me and the gym brand', async () => {
    const res = await member.login({ gymId: 'ironhouse', phone: '+92 300 1234567', password: '234567' });
    member.setToken(res.token);
    expect(res.user).toMatchObject({ role: 'member', memberCode, name: 'Ali Raza' });
    expect(await member.me()).toMatchObject({ id: memberId, role: 'member' });
    expect(await member.getGym('ironhouse')).toMatchObject({ id: 'ironhouse', name: 'Iron House Fitness', graceDays: 3 });

    reception.setToken((await reception.login({ gymId: 'ironhouse', phone: gym.reception.phone, password: 'staff-pass-123' })).token);
    trainer.setToken((await trainer.login({ gymId: 'ironhouse', phone: gym.trainer.phone, password: 'staff-pass-123' })).token);
  });

  it('a wrong password shows the one login error, without logging anyone out', async () => {
    await expect(client().login({ gymId: 'ironhouse', phone: '03001234567', password: 'nope' }))
      .rejects.toMatchObject({ message: 'Wrong phone number or password.', status: 401 });
    expect(unauthorized).toBe(0);
  });

  it('member: membership, progress, announcements and exercises', async () => {
    const m = await member.getMembership();
    expect(m).toMatchObject({ code: memberCode, status: 'active', entryAllowed: true, planMonths: 1, pendingProof: null, pendingFreeze: null });
    const p = await member.getProgress();
    expect(p.isNew).toBe(true);
    expect(p.visits).toHaveLength(84);
    expect(await member.getAnnouncements()).toEqual([]);
    expect((await member.getExercises()).length).toBe(17);
  });

  it('member: the check-in QR built by the app from its key is accepted at the door', async () => {
    const key = await member.getCheckinKey();
    expect(key).toMatchObject({ gymId: 'ironhouse', memberCode });
    const qr = buildCheckinQr(key.gymId, key.memberCode, key.key);
    const scan = await reception.scan(qr);
    expect(scan).toMatchObject({ ok: true, allowed: true, member: { code: memberCode } });
    expect(await reception.scan(memberCode.toLowerCase())).toMatchObject({ ok: true, allowed: true });
    expect(await reception.scan('IH-9999')).toEqual({ ok: false, message: 'No member with ID IH-9999 at this gym.' });
  });

  it('trainer: clients, a plan for today, sessions and marking done', async () => {
    const clients = await trainer.trainerClients();
    expect(clients).toEqual([{ memberId, code: memberCode, name: 'Ali Raza', status: 'active', goal: 'strength' }]);
    expect(await trainer.clientBests(memberId)).toEqual([]);
    const plan = await trainer.createPlan({
      name: 'Legs', date: today, memberIds: [memberId],
      items: [{ exerciseId: 'squat', sets: 5, reps: 5, weightMode: 'pct', kg: null, pct: 75, warmups: true, restSec: 120, note: null, canChange: false }],
    });
    expect(plan.sentTo).toBe(1);
    expect(await trainer.trainerToday()).toEqual([]);
  });

  it("member: today's plan (no history, so % of best becomes member chooses), then logging sets offline-style", async () => {
    const plan = await member.getTodayPlan();
    expect(plan).toMatchObject({ planName: 'Legs', coachName: 'Trainer', doneExerciseIds: [] });
    expect(plan!.items[0]).toMatchObject({ exerciseName: 'Back squat', weightMode: 'choose', kg: null });

    const session = { id: crypto.randomUUID(), exerciseId: 'squat', date: today, planId: plan!.planId, sets: [{ kg: 80, reps: 5, warmup: false, plates: [20, 10] }] };
    expect(await member.saveSessions([session])).toEqual({ saved: 1, duplicates: 0 });
    expect(await member.saveSessions([session])).toEqual({ saved: 0, duplicates: 1 }); // retried from the offline queue
    expect((await member.getTodayPlan())!.doneExerciseIds).toEqual(['squat']);

    const history = await member.getHistory('squat');
    expect(history).toMatchObject({ heaviest: { kg: 80, reps: 5, date: today }, estimatedMax: 93.3 });
    expect((await member.getProgress()).bests[0]).toMatchObject({ exerciseId: 'squat', kg: 80 });
    expect(await trainer.clientBests(memberId)).toEqual([{ exerciseId: 'squat', kg: 80, reps: 5, estimatedMax: 93.3 }]);
  });

  it('member: freeze request and payment screenshot upload', async () => {
    const freeze = await member.requestFreeze({ days: 7, reason: 'travel' });
    expect(freeze).toMatchObject({ days: 7, reason: 'travel', status: 'pending' });
    const png = new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' });
    const proof = await member.uploadPaymentProof(png as unknown as { uri: string; name: string; type: string });
    expect(proof.status).toBe('pending');
    expect(await member.getMembership()).toMatchObject({ pendingProof: { id: proof.id }, pendingFreeze: { id: freeze.id } });
  });

  it('reception: record a payment (early: extends from the due date)', async () => {
    const before = await member.getMembership();
    const res = await reception.recordPayment({ memberCode, amountPkr: 4000, method: 'jazzcash', txnId: null });
    expect(res.payment.periodFrom).toBe(before.dueOn);
    expect(res.message).toMatch(/^Renewed to .+\. Receipt queued for WhatsApp$/);
    expect((await member.getMembership()).dueOn).toBe(res.newDueOn);
  });

  it('trainer sessions created by the trainer show in their day; mark done', async () => {
    const created = await fetch(`${baseUrl}/v1/trainer/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await login(ctx.app, 'ironhouse', gym.trainer.phone)}` },
      body: JSON.stringify({ memberId, startsAt: `${today}T18:00:00+05:00`, title: 'Ali Raza', meta: 'Legs · session 1 of 12', kind: 'pt' }),
    }).then((r) => r.json() as Promise<{ id: string }>);
    const day = await trainer.trainerToday();
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ id: created.id, trainerId: gym.trainer.id, trainerName: 'Trainer One', done: false });
    expect(await trainer.setSessionDone(created.id, true)).toMatchObject({ done: true });
  });

  it('change password, and staff routes refuse the member (403) without logging them out', async () => {
    await member.changePassword({ currentPassword: '234567', newPassword: 'new-secret' });
    const again = await client().login({ gymId: 'ironhouse', phone: '3001234567', password: 'new-secret' });
    expect(again.user.id).toBe(memberId);
    await expect(member.scan(memberCode)).rejects.toMatchObject({ status: 403, message: 'You do not have access to this.' });
    expect(unauthorized).toBe(0);
  });

  it('an invalid token triggers the app’s log-out handler', async () => {
    const stale = client();
    stale.setToken('not-a-token');
    await expect(stale.getMembership()).rejects.toMatchObject({ status: 401, message: 'Please log in again.' });
    expect(unauthorized).toBe(1);
  });

  it('plans for past days are refused', async () => {
    await expect(trainer.createPlan({ name: 'Old', date: addDays(today, -1), memberIds: [memberId], items: [] }))
      .rejects.toMatchObject({ status: 400 });
  });
});
