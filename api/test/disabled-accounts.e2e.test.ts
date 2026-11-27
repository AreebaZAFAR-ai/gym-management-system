import { addDays, buildCheckinQr, pkToday } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_DISABLED, WRONG_LOGIN } from '../src/auth/auth.service';
import { checkins, gyms } from '../src/db/schema';
import { ACCOUNT_DISABLED_AT_DOOR, ENTRY_ALLOWED } from '../src/door/door.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { login, seedGym, type GymFixture } from './helpers/staff';

/**
 * §6 Member page and Staff and roles: Disable/Enable (users.active).
 * A disabled account cannot log in, its existing token stops working, and a disabled
 * member is blocked at the door by QR, typed ID and thumbprint. Enabling restores both.
 */
describe('§6 Disable/Enable accounts', () => {
  const DEVICE_KEY = 'device-key-gym-a-long-enough';
  const today = pkToday();
  let ctx: TestContext;
  let a: GymFixture;
  let owner: string;
  let reception: string;
  let memberToken: string;
  let memberKey: string;
  let memberId: string;
  const CODE = 'IH-0001';
  const PHONE = '03211234567';
  const PASSWORD = '234567';

  const http = () => request(ctx.app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) => http().post(path).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body: object) => http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
  });
  const memberLogin = () => http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: PHONE, password: PASSWORD });
  const thumb = () => http().post('/v1/devices/gym-a/fingerprint').set('x-device-key', DEVICE_KEY).send({ fingerprintId: '42' });
  const qr = () => buildCheckinQr('gym-a', CODE, memberKey);
  const lastCheckin = async () =>
    (await ctx.db.select().from(checkins).where(and(eq(checkins.gymId, 'gym-a'), eq(checkins.memberId, memberId))).orderBy(desc(checkins.createdAt)).limit(1))[0];

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await seedGym(ctx.db, 'gym-a', 'Iron House Fitness', 'IH');
    await ctx.db.update(gyms).set({ deviceKey: DEVICE_KEY }).where(eq(gyms.id, 'gym-a'));
    owner = await login(ctx.app, 'gym-a', a.owner.phone);
    reception = await login(ctx.app, 'gym-a', a.reception.phone);

    const reg = await as(reception).post('/v1/members', {
      name: 'Ali Raza', phone: PHONE, joinedOn: today, planId: a.planId, fingerprintId: '42',
      payment: { amountPkr: 4000, method: 'cash' },
    });
    expect(reg.status).toBe(201);
    memberId = reg.body.memberId;
    const res = await memberLogin();
    expect(res.status).toBe(200);
    memberToken = res.body.token;
    memberKey = (await as(memberToken).get('/v1/me/checkin-key')).body.key;

    // Paid up and enabled: every door path allows entry.
    expect((await as(reception).post('/v1/checkins/scan', { code: qr() })).body).toMatchObject({ allowed: true, message: ENTRY_ALLOWED });

    expect((await as(reception).patch(`/v1/members/${CODE}`, { active: false })).body.active).toBe(false);
  });
  afterAll(() => closeTestApp(ctx));

  describe('a disabled member', () => {
    it('cannot log in: 403 with the disabled message, only after the right password', async () => {
      const res = await memberLogin();
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: ACCOUNT_DISABLED });
      // A wrong password still gets the one login error, so the message never shows the phone exists.
      const wrong = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: PHONE, password: 'wrong' });
      expect(wrong.status).toBe(401);
      expect(wrong.body).toEqual({ message: WRONG_LOGIN });
    });

    it('their existing token is refused on the next call', async () => {
      const res = await as(memberToken).get('/v1/me/membership');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: ACCOUNT_DISABLED });
    });

    it('is blocked at the door by QR, typed ID and thumbprint; each scan is saved as blocked with source and scanner', async () => {
      const byQr = await as(reception).post('/v1/checkins/scan', { code: qr() });
      expect(byQr.status).toBe(200);
      expect(byQr.body).toMatchObject({ ok: true, allowed: false, message: ACCOUNT_DISABLED_AT_DOOR, amountDue: null, member: { code: CODE } });
      expect(await lastCheckin()).toMatchObject({ allowed: false, reason: ACCOUNT_DISABLED_AT_DOOR, source: 'qr', scannedBy: a.reception.id });

      const typed = await as(owner).post('/v1/checkins/scan', { code: CODE.toLowerCase() });
      expect(typed.body).toMatchObject({ ok: true, allowed: false, message: ACCOUNT_DISABLED_AT_DOOR });
      expect(await lastCheckin()).toMatchObject({ allowed: false, reason: ACCOUNT_DISABLED_AT_DOOR, source: 'manual', scannedBy: a.owner.id });

      const byThumb = await thumb();
      expect(byThumb.body).toMatchObject({ ok: true, allowed: false, message: ACCOUNT_DISABLED_AT_DOOR });
      expect(await lastCheckin()).toMatchObject({ allowed: false, reason: ACCOUNT_DISABLED_AT_DOOR, source: 'fingerprint', scannedBy: null });
    });

    it('is blocked for being disabled before the frozen and overdue checks', async () => {
      await as(owner).patch(`/v1/members/${CODE}`, { dueOn: addDays(today, -10) });
      const res = await as(reception).post('/v1/checkins/scan', { code: CODE });
      expect(res.body).toMatchObject({ allowed: false, message: ACCOUNT_DISABLED_AT_DOOR, amountDue: null });
      await as(owner).patch(`/v1/members/${CODE}`, { dueOn: addDays(today, 20) });
    });

    it('after Enable: logs in again, the old token works and entry is allowed by QR, typed ID and thumbprint', async () => {
      expect((await as(reception).patch(`/v1/members/${CODE}`, { active: true })).body.active).toBe(true);
      expect((await memberLogin()).status).toBe(200);
      expect((await as(memberToken).get('/v1/me/membership')).status).toBe(200);
      expect((await as(reception).post('/v1/checkins/scan', { code: qr() })).body).toMatchObject({ allowed: true, message: ENTRY_ALLOWED });
      expect((await as(reception).post('/v1/checkins/scan', { code: CODE })).body).toMatchObject({ allowed: true });
      expect((await thumb()).body).toMatchObject({ allowed: true });
    });
  });

  describe('a disabled reception user', () => {
    it('cannot log in, and their old token cannot record a payment; Enable restores access', async () => {
      expect((await as(owner).patch(`/v1/staff/${a.reception.id}`, { active: false })).body.active).toBe(false);

      const res = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: a.reception.phone, password: 'staff-pass-123' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: ACCOUNT_DISABLED });

      const pay = await as(reception).post('/v1/payments', { memberCode: CODE, amountPkr: 4000, method: 'cash' });
      expect(pay.status).toBe(401);
      expect(pay.body).toEqual({ message: ACCOUNT_DISABLED });

      expect((await as(owner).patch(`/v1/staff/${a.reception.id}`, { active: true })).body.active).toBe(true);
      expect((await as(reception).post('/v1/payments', { memberCode: CODE, amountPkr: 4000, method: 'cash' })).status).toBe(201);
    });

    it('owners still cannot disable themselves', async () => {
      const res = await as(owner).patch(`/v1/staff/${a.owner.id}`, { active: false });
      expect(res.status).toBe(403);
      expect((await as(owner).get('/v1/auth/me')).status).toBe(200);
    });
  });
});
