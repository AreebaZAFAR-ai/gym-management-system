import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gyms, plans } from '../src/db/schema';
import { createGym, DEMO_GYM, seedDemoPlans } from '../src/setup/create-gym';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';

describe('§12 create a gym and its first owner (super-admin script)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  it('creates the gym with a random check-in secret, and the owner can log in', async () => {
    const res = await createGym(ctx.db, {
      id: 'ironhouse', name: 'Iron House Fitness', short: 'IH', city: 'Lahore', memberPrefix: 'IH',
      ownerName: 'Kamran Iqbal', ownerPhone: '0345-1234567',
    });
    expect(res.ownerPassword).toMatch(/^\d{10}$/);
    const [g] = await ctx.db.select().from(gyms).where(eq(gyms.id, 'ironhouse'));
    expect(g!.checkinSecret.length).toBeGreaterThanOrEqual(40);
    expect(g!.lastMemberNumber).toBe(0);
    const login = await request(ctx.app.getHttpServer()).post('/v1/auth/login')
      .send({ gymId: 'ironhouse', phone: '03451234567', password: res.ownerPassword });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ role: 'owner', name: 'Kamran Iqbal' });
  });

  it('two gyms never share a check-in secret; a gym ID cannot be reused', async () => {
    await createGym(ctx.db, { id: 'fitzone', name: 'Fit Zone', short: 'FZ', city: 'Karachi', memberPrefix: 'FZ', ownerName: 'A', ownerPhone: '03001234567' });
    const rows = await ctx.db.select({ s: gyms.checkinSecret }).from(gyms);
    expect(new Set(rows.map((r) => r.s)).size).toBe(rows.length);
    await expect(createGym(ctx.db, { id: 'fitzone', name: 'X', short: 'X', city: 'X', memberPrefix: 'X', ownerName: 'B', ownerPhone: '03001234568' }))
      .rejects.toThrow();
  });

  it('validates the input', async () => {
    await expect(createGym(ctx.db, { id: 'Bad Id', name: 'X', short: 'X', city: 'X', memberPrefix: 'X', ownerName: 'B', ownerPhone: '03001234569' }))
      .rejects.toThrow(/lowercase slug/);
    await expect(createGym(ctx.db, { id: 'okgym', name: 'X', short: 'X', city: 'X', memberPrefix: 'X', ownerName: 'B', ownerPhone: '12345' }))
      .rejects.toThrow(/Pakistani mobile/);
  });

  it('the demo gym gets the three demo fee plans', async () => {
    const res = await createGym(ctx.db, DEMO_GYM);
    await seedDemoPlans(ctx.db, res.gymId);
    expect(await ctx.db.select().from(plans).where(eq(plans.gymId, 'demo'))).toHaveLength(3);
  });
});
