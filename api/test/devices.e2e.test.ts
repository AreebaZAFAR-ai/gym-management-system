import { addDays, formatShortDate, pkToday } from '@gym/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkins, gyms, plans, users } from '../src/db/schema';
import { DEVICE_NOT_RECOGNISED, ENTRY_ALLOWED } from '../src/door/door.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { registerMember } from './helpers/seed';

/** Demo external fingerprint device: §10 POST /v1/devices/:gymId/fingerprint with x-device-key. */
describe('demo fingerprint device (§7 entry at the door, §10 device endpoint)', () => {
  let ctx: TestContext;
  const KEY_A = 'demo-device-key-gym-a';
  const KEY_B = 'demo-device-key-gym-b';
  const today = pkToday();
  const ids = {} as Record<'aMember' | 'aOverdue' | 'aGrace' | 'aFrozen' | 'bMember', string>;

  const scan = (gymId: string, key: string | null, body: unknown) => {
    const req = request(ctx.app.getHttpServer()).post(`/v1/devices/${gymId}/fingerprint`);
    if (key !== null) req.set('x-device-key', key);
    return req.send(body as object);
  };
  const checkinsOf = async (gymId: string) => ctx.db.select().from(checkins).where(eq(checkins.gymId, gymId));

  beforeAll(async () => {
    ctx = await createTestApp();
    const { db } = ctx;
    await db.insert(gyms).values([
      { id: 'gym-a', name: 'Gym A', short: 'GA', city: 'Lahore', primaryColor: '#17191C', memberPrefix: 'GA', checkinSecret: 's-a', deviceKey: KEY_A },
      { id: 'gym-b', name: 'Gym B', short: 'GB', city: 'Karachi', primaryColor: '#17191C', memberPrefix: 'GB', checkinSecret: 's-b', deviceKey: KEY_B },
      { id: 'gym-c', name: 'Gym C', short: 'GC', city: 'Multan', primaryColor: '#17191C', memberPrefix: 'GC', checkinSecret: 's-c' }, // no device
    ]);
    const [aRec] = await db.insert(users).values({ gymId: 'gym-a', phone: '3000000002', name: 'Rec A', role: 'reception', passwordHash: 'x' }).returning();
    const [bRec] = await db.insert(users).values({ gymId: 'gym-b', phone: '3000000002', name: 'Rec B', role: 'reception', passwordHash: 'x' }).returning();
    const [aPlan] = await db.insert(plans).values({ gymId: 'gym-a', name: 'Monthly', feePkr: 4000, months: 1 }).returning();
    const [bPlan] = await db.insert(plans).values({ gymId: 'gym-b', name: 'Monthly', feePkr: 5000, months: 1 }).returning();

    const regA = async (phone: string, code: string, fingerprintId: string, dueOn: string, frozenUntil: string | null = null) =>
      (await registerMember(db, {
        gymId: 'gym-a', phone, code, planId: aPlan!.id, recordedBy: aRec!.id,
        joinedOn: addDays(today, -60), dueOn, member: { fingerprintId, frozenUntil },
      })).memberId;

    ids.aMember = await regA('3000000101', 'GA-0001', '17', addDays(today, 20));
    ids.aOverdue = await regA('3000000102', 'GA-0002', '18', addDays(today, -4)); // 4 days overdue, grace 3
    ids.aGrace = await regA('3000000103', 'GA-0003', '19', addDays(today, -3)); // still within grace
    ids.aFrozen = await regA('3000000104', 'GA-0004', '20', addDays(today, 20), addDays(today, 2));
    ids.bMember = (await registerMember(db, {
      gymId: 'gym-b', phone: '3000000105', code: 'GB-0001', planId: bPlan!.id, recordedBy: bRec!.id,
      joinedOn: addDays(today, -60), dueOn: addDays(today, 20), member: { fingerprintId: '17' }, // same ID as gym A
    })).memberId;
  });

  afterAll(() => closeTestApp(ctx));

  it('allows an active member and saves the check-in with source fingerprint and no staff scanner', async () => {
    const res = await scan('gym-a', KEY_A, { fingerprintId: '17' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, allowed: true, message: ENTRY_ALLOWED, member: { memberId: ids.aMember, code: 'GA-0001', status: 'active' } });
    const saved = (await checkinsOf('gym-a')).filter((c) => c.memberId === ids.aMember);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ allowed: true, source: 'fingerprint', scannedBy: null, reason: null });
  });

  it('accepts a numeric fingerprint ID from the device', async () => {
    const res = await scan('gym-a', KEY_A, { fingerprintId: 17 });
    expect(res.body).toMatchObject({ ok: true, allowed: true, member: { memberId: ids.aMember } });
  });

  it('blocks a member more than grace days overdue, with the plan fee as the amount due', async () => {
    const res = await scan('gym-a', KEY_A, { fingerprintId: '18' });
    const message = `Fee overdue since ${formatShortDate(addDays(today, -4))}`;
    expect(res.body).toEqual(expect.objectContaining({ ok: true, allowed: false, message, amountDue: 4000 }));
    expect(res.body.member.status).toBe('overdue');
    const saved = (await checkinsOf('gym-a')).find((c) => c.memberId === ids.aOverdue);
    expect(saved).toMatchObject({ allowed: false, reason: message, source: 'fingerprint' });
  });

  it('allows a member who is overdue but still within grace days', async () => {
    const res = await scan('gym-a', KEY_A, { fingerprintId: '19' });
    expect(res.body).toMatchObject({ ok: true, allowed: true, member: { status: 'overdue' } });
  });

  it('blocks a frozen member until the freeze ends', async () => {
    const res = await scan('gym-a', KEY_A, { fingerprintId: '20' });
    expect(res.body).toMatchObject({
      ok: true, allowed: false, amountDue: null, message: `Membership frozen until ${formatShortDate(addDays(today, 2))}`,
      member: { status: 'frozen' },
    });
  });

  it('§7: saves the scan of an unknown fingerprint ID with no member (message unspecified in the PDF)', async () => {
    const before = (await checkinsOf('gym-a')).length;
    const res = await scan('gym-a', KEY_A, { fingerprintId: '999' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, message: '' });
    const after = await checkinsOf('gym-a');
    expect(after).toHaveLength(before + 1);
    expect(after.filter((c) => c.memberId === null)).toEqual([expect.objectContaining({ allowed: false, source: 'fingerprint', reason: null })]);
  });

  describe('gym isolation', () => {
    it("the same fingerprint ID resolves only to the device's own gym", async () => {
      const a = await scan('gym-a', KEY_A, { fingerprintId: '17' });
      const b = await scan('gym-b', KEY_B, { fingerprintId: '17' });
      expect(a.body.member.memberId).toBe(ids.aMember);
      expect(b.body.member.memberId).toBe(ids.bMember);
      expect(b.body.member.feePkr).toBe(5000);
      expect((await checkinsOf('gym-b')).every((c) => c.memberId === ids.bMember)).toBe(true);
    });

    it("gym B's device key cannot check in at gym A", async () => {
      const res = await scan('gym-a', KEY_B, { fingerprintId: '17' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: DEVICE_NOT_RECOGNISED });
    });
  });

  it('refuses a missing or wrong key, an unknown gym and a gym without a device, and saves nothing', async () => {
    const before = (await checkinsOf('gym-a')).length;
    for (const [gym, key] of [['gym-a', null], ['gym-a', 'wrong'], ['nope', KEY_A], ['gym-c', 'anything']] as const) {
      const res = await scan(gym, key, { fingerprintId: '17' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: DEVICE_NOT_RECOGNISED });
    }
    expect(await checkinsOf('gym-a')).toHaveLength(before);
  });

  it('requires a fingerprint ID', async () => {
    for (const body of [{}, { fingerprintId: '' }, { fingerprintId: '  ' }]) {
      const res = await scan('gym-a', KEY_A, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'fingerprintId is required.' });
    }
  });
});
