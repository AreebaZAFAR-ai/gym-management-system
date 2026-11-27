import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkPassword } from '../src/auth/passwords';
import { gyms, users } from '../src/db/schema';
import { REGISTER_LIMIT, RegisterLimiter } from '../src/registration/register-limiter';
import { createGym } from '../src/setup/create-gym';
import { GYM_EMAIL_TAKEN, OWNER_EMAIL_TAKEN, TOO_MANY_REGISTRATIONS } from '../src/registration/registration.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { registerMember } from './helpers/seed';
import { login, seedGym, type GymFixture } from './helpers/staff';

const PASSWORD = 'strongpass1';

let seq = 0;
/** A valid registration with unique emails; override any field. */
const body = (over: Record<string, unknown> = {}) => {
  seq++;
  return {
    gymName: 'Iron House Fitness', gymEmail: `gym${seq}@example.pk`, gymPhone: '042-35761234',
    gymAddress: '12 Main Boulevard, Gulberg III', city: 'Lahore',
    ownerName: 'Kamran Iqbal', ownerEmail: `owner${seq}@example.pk`, ownerPhone: '0345-1234567',
    password: PASSWORD, confirmPassword: PASSWORD, ...over,
  };
};

describe('POST /v1/gyms/register: gym owner self-registration', () => {
  let ctx: TestContext;
  let existing: GymFixture;
  const http = () => request(ctx.app.getHttpServer());
  const register = (b: object) => http().post('/v1/gyms/register').send(b);
  const as = (token: string) => ({
    get: (p: string) => http().get(p).set('Authorization', `Bearer ${token}`),
    patch: (p: string, b: object) => http().patch(p).set('Authorization', `Bearer ${token}`).send(b),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    existing = await seedGym(ctx.db, 'gym-a', 'Gym A', 'GA');
    await registerMember(ctx.db, {
      gymId: 'gym-a', phone: '3009990001', code: 'GA-0001', planId: existing.planId, recordedBy: existing.reception.id,
      joinedOn: '2026-11-01', dueOn: '2026-12-01',
    });
  });
  beforeEach(() => ctx.app.get(RegisterLimiter).reset());
  afterAll(() => closeTestApp(ctx));

  it('creates the gym and its owner in one go and returns only the Gym Code and public details', async () => {
    const b = body({ gymEmail: 'Front.Desk@IronHouse.pk', ownerEmail: 'Kamran@IronHouse.pk' });
    const res = await register(b);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ gymId: 'iron-house-fitness', gymName: 'Iron House Fitness', ownerName: 'Kamran Iqbal', ownerPhone: '3451234567' });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|secret|password|token/i);

    const [g] = await ctx.db.select().from(gyms).where(eq(gyms.id, 'iron-house-fitness'));
    expect(g).toMatchObject({
      name: 'Iron House Fitness', short: 'IHF', memberPrefix: 'IHF', city: 'Lahore', primaryColor: '#17191C',
      email: 'front.desk@ironhouse.pk', phone: '042-35761234', address: '12 Main Boulevard, Gulberg III', lastMemberNumber: 0,
    });
    expect(g!.checkinSecret.length).toBeGreaterThanOrEqual(40);

    const accounts = await ctx.db.select().from(users).where(eq(users.gymId, 'iron-house-fitness'));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ role: 'owner', phone: '3451234567', name: 'Kamran Iqbal', email: 'kamran@ironhouse.pk', active: true });
    expect(accounts[0]!.passwordHash).not.toContain(PASSWORD);
    expect(await checkPassword(PASSWORD, accounts[0]!.passwordHash)).toBe(true);
  });

  it('the owner logs in with the Gym Code, mobile number and password (existing login contract)', async () => {
    const res = await http().post('/v1/auth/login').send({ gymId: 'iron-house-fitness', phone: '+92 345 1234567', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ gymId: 'iron-house-fitness', role: 'owner', name: 'Kamran Iqbal' });
    expect((await as(res.body.token).get('/v1/settings')).status).toBe(200); // owner-only route
  });

  it('the same gym name gets the next free code; the same owner mobile may own another gym', async () => {
    const res = await register(body());
    expect(res.status).toBe(201);
    expect(res.body.gymId).toBe('iron-house-fitness-2');
    expect((await register(body())).body.gymId).toBe('iron-house-fitness-3');
  });

  it('refuses a duplicate gym email or owner email (ignoring case) and creates nothing', async () => {
    const before = (await ctx.db.select({ id: gyms.id }).from(gyms)).length;
    const dupGym = await register(body({ gymName: 'Other Gym', gymEmail: 'FRONT.desk@ironhouse.pk' }));
    expect(dupGym.status).toBe(409);
    expect(dupGym.body).toEqual({ message: GYM_EMAIL_TAKEN });
    const dupOwner = await register(body({ gymName: 'Other Gym', ownerEmail: 'kamran@IRONHOUSE.pk' }));
    expect(dupOwner.status).toBe(409);
    expect(dupOwner.body).toEqual({ message: OWNER_EMAIL_TAKEN });
    expect((await ctx.db.select({ id: gyms.id }).from(gyms)).length).toBe(before);
  });

  it('the unique indexes hold even if the pre-check is skipped (race): the transaction leaves no half-made gym', async () => {
    const before = (await ctx.db.select({ id: gyms.id }).from(gyms)).length;
    await expect(createGym(ctx.db, {
      id: 'race-gym', name: 'Race', short: 'R', city: 'Lahore', primaryColor: '#17191C', memberPrefix: 'R',
      ownerName: 'X', ownerPhone: '03001112222', ownerPassword: PASSWORD, email: 'other@x.pk', ownerEmail: 'KAMRAN@ironhouse.pk',
    })).rejects.toThrow();
    expect((await ctx.db.select({ id: gyms.id }).from(gyms)).length).toBe(before);
  });

  it.each([
    [{ gymName: '  ' }, 'Gym name is required.'],
    [{ gymEmail: 'not-an-email' }, 'Enter a valid gym email.'],
    [{ gymPhone: '123' }, 'Enter a valid gym phone number (7 to 15 digits).'],
    [{ gymAddress: '' }, 'Gym address is required.'],
    [{ city: '' }, 'City is required.'],
    [{ ownerName: undefined }, 'Owner name is required.'],
    [{ ownerEmail: 'owner@nowhere' }, 'Enter a valid owner email.'],
    [{ ownerPhone: '0212345678' }, 'Owner mobile number must be a Pakistani mobile number (10 digits starting with 3).'],
    [{ gymName: 'x'.repeat(101) }, 'Gym name must be at most 100 characters.'],
  ])('rejects invalid input %j', async (over, message) => {
    const res = await register(body(over));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message });
  });

  it.each([
    [{ password: 'short1', confirmPassword: 'short1' }, 'Password must be at least 8 characters.'],
    [{ password: 'nonumbers', confirmPassword: 'nonumbers' }, 'Password must contain at least one letter and one number.'],
    [{ password: 'strongpass1', confirmPassword: 'strongpass2' }, 'Passwords do not match.'],
    [{ confirmPassword: undefined }, 'Confirm your password.'],
  ])('validates the password %j', async (over, message) => {
    const res = await register(body(over));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message });
  });

  it('ignores any role, gym code or ID in the request: the account is always the owner of a new gym', async () => {
    const res = await register(body({ gymName: 'Sneaky Gym', role: 'admin', gymId: 'gym-a', id: 'gym-a', isSuperAdmin: true }));
    expect(res.status).toBe(201);
    expect(res.body.gymId).toBe('sneaky-gym');
    const [u] = await ctx.db.select().from(users).where(eq(users.gymId, 'sneaky-gym'));
    expect(u!.role).toBe('owner');
    // gym-a still has only its own four staff and one member.
    expect(await ctx.db.select().from(users).where(eq(users.gymId, 'gym-a'))).toHaveLength(5);
  });

  it("§11: a newly registered owner cannot see or change another gym's data", async () => {
    await register(body({ gymName: 'Isolated Gym', ownerPhone: '03217654321' }));
    const token = await login(ctx.app, 'isolated-gym', '3217654321', PASSWORD);
    const own = as(token);

    expect((await own.get('/v1/members')).body).toEqual([]);
    expect((await own.get('/v1/members/GA-0001')).status).toBe(404);
    expect((await own.get('/v1/staff')).body.map((s: { phone: string }) => s.phone)).toEqual(['3217654321']);
    expect((await own.patch(`/v1/staff/${existing.reception.id}`, { active: false })).status).toBe(404);
    expect((await own.get('/v1/payments')).body).toEqual([]);
    expect((await own.get('/v1/settings')).body).toMatchObject({ name: 'Isolated Gym' });
    // A token for this gym does not work as gym-a's owner by changing the gym code at login.
    const cross = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: '3217654321', password: PASSWORD });
    expect(cross.status).toBe(401);
  });

  it('existing gym logins still work', async () => {
    const res = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: existing.owner.phone, password: 'staff-pass-123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ gymId: 'gym-a', role: 'owner' });
  });

  it('the public brand endpoint shows the new gym but never its contact emails or secret', async () => {
    const res = await http().get('/v1/gyms/iron-house-fitness');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/ironhouse\.pk|checkin|secret/i);
  });

  it(`limits registrations to ${REGISTER_LIMIT} per client per hour`, async () => {
    for (let i = 0; i < REGISTER_LIMIT; i++) expect((await register(body({ gymName: `Limit Gym ${i}` }))).status).toBe(201);
    const res = await register(body({ gymName: 'One Too Many' }));
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ message: TOO_MANY_REGISTRATIONS });
  });
});
