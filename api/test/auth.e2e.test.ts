import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ACCESS, LOGIN_AGAIN, roleAllowed } from '../src/auth/auth.guard';
import { TOO_MANY_TRIES, WRONG_LOGIN } from '../src/auth/auth.service';
import { users } from '../src/db/schema';
import { closeTestApp, createTestApp, TEST_ENV, type TestContext } from './helpers/app';
import { registerMember } from './helpers/seed';
import { login, seedGym, STAFF_PASSWORD, type GymFixture } from './helpers/staff';

describe('§2/§10/§11 login, tokens and roles', () => {
  let ctx: TestContext;
  let a: GymFixture;
  let b: GymFixture;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await seedGym(ctx.db, 'gym-a', 'Gym A', 'GA');
    b = await seedGym(ctx.db, 'gym-b', 'Gym B', 'GB');
  });
  afterAll(() => closeTestApp(ctx));

  describe('POST /v1/auth/login', () => {
    it('§4.1: accepts any common phone format and returns a token and the user', async () => {
      for (const phone of ['0300-0000002', '+92 300 0000002', '3000000002', '0300 0000002']) {
        const res = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone, password: STAFF_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.user).toEqual({ id: a.reception.id, gymId: 'gym-a', name: 'Reception', phone: '3000000002', role: 'reception' });
        expect(typeof res.body.token).toBe('string');
      }
    });

    it('§11: the token expires after 60 days', async () => {
      const token = await login(ctx.app, 'gym-a', a.owner.phone);
      const { exp, iat } = new JwtService({ secret: TEST_ENV.JWT_SECRET }).verify<{ exp: number; iat: number }>(token);
      expect(exp - iat).toBe(60 * 24 * 60 * 60);
    });

    it('§4.1/§11: one error for a wrong phone, a wrong password, an invalid phone or the wrong gym', async () => {
      for (const body of [
        { gymId: 'gym-a', phone: '3000000002', password: 'wrong' },
        { gymId: 'gym-a', phone: '3009999999', password: STAFF_PASSWORD },
        { gymId: 'gym-a', phone: '12345', password: STAFF_PASSWORD },
        { gymId: 'gym-zzz', phone: '3000000002', password: STAFF_PASSWORD },
      ]) {
        const res = await http().post('/v1/auth/login').send(body);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: WRONG_LOGIN });
      }
    });

    it('returns a member code for members', async () => {
      await registerMember(ctx.db, { gymId: 'gym-a', phone: '3001112222', code: 'GA-0100', planId: a.planId, recordedBy: a.reception.id });
      await ctx.db.update(users).set({ passwordHash: (await ctx.db.select().from(users).where(eq(users.id, a.owner.id)))[0]!.passwordHash }).where(eq(users.phone, '3001112222'));
      const res = await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: '03001112222', password: STAFF_PASSWORD });
      expect(res.body.user).toMatchObject({ role: 'member', memberCode: 'GA-0100' });
    });

    it('§11: allows 10 tries per phone per 15 minutes, then refuses even the right password', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await http().post('/v1/auth/login').send({ gymId: 'gym-b', phone: b.trainer2.phone, password: 'wrong' });
        expect(res.status).toBe(401);
      }
      const blocked = await http().post('/v1/auth/login').send({ gymId: 'gym-b', phone: b.trainer2.phone, password: STAFF_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ message: TOO_MANY_TRIES });
      // Other phones are not affected.
      expect((await http().post('/v1/auth/login').send({ gymId: 'gym-b', phone: b.trainer.phone, password: STAFF_PASSWORD })).status).toBe(200);
    });

  });

  describe('GET /v1/auth/me and tokens', () => {
    it('returns the signed-in user', async () => {
      const token = await login(ctx.app, 'gym-a', a.trainer.phone);
      const res = await http().get('/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: a.trainer.id, role: 'trainer', gymId: 'gym-a' });
    });

    it('refuses a missing, malformed or forged token', async () => {
      const forged = new JwtService({ secret: 'some-other-secret-that-is-long-enough' }).sign({ sub: a.owner.id, gym: 'gym-a' });
      for (const header of [undefined, 'Bearer', 'Bearer not-a-jwt', `Bearer ${forged}`, 'Basic abc']) {
        const req = http().get('/v1/auth/me');
        if (header) req.set('Authorization', header);
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: LOGIN_AGAIN });
      }
    });

    it("§11: a token cannot be pointed at another gym's user", async () => {
      const crossGym = new JwtService({ secret: TEST_ENV.JWT_SECRET }).sign({ sub: a.owner.id, gym: 'gym-b' });
      expect((await http().get('/v1/auth/me').set('Authorization', `Bearer ${crossGym}`)).status).toBe(401);
    });
  });

  describe('POST /v1/auth/change-password', () => {
    it('changes the password after checking the current one', async () => {
      const token = await login(ctx.app, 'gym-a', a.trainer2.phone);
      const wrong = await http().post('/v1/auth/change-password').set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'nope', newPassword: 'new-pass-1' });
      expect(wrong.status).toBe(400);
      expect(wrong.body).toEqual({ message: 'Your current password is wrong.' });

      const ok = await http().post('/v1/auth/change-password').set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: STAFF_PASSWORD, newPassword: 'new-pass-1' });
      expect(ok.status).toBe(204);
      expect((await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: a.trainer2.phone, password: STAFF_PASSWORD })).status).toBe(401);
      expect((await http().post('/v1/auth/login').send({ gymId: 'gym-a', phone: a.trainer2.phone, password: 'new-pass-1' })).status).toBe(200);
    });

    it('§11: stores a bcrypt hash with cost 10, never the password', async () => {
      const [u] = await ctx.db.select().from(users).where(eq(users.id, a.trainer2.id));
      expect(u!.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(u!.passwordHash).not.toContain('new-pass-1');
    });
  });

  describe('§2/§10 role access', () => {
    it('owner may call every staff route; members never may', () => {
      expect(roleAllowed('owner', ['reception'])).toBe(true);
      expect(roleAllowed('owner', ['trainer'])).toBe(true);
      expect(roleAllowed('owner', ['member'])).toBe(false);
      expect(roleAllowed('member', ['reception'])).toBe(false);
      expect(roleAllowed('trainer', ['reception'])).toBe(false);
      expect(roleAllowed('reception', ['trainer'])).toBe(false);
    });

    it('applies the §10 role table to the new routes', async () => {
      await ctx.db.update(users).set({ passwordHash: (await ctx.db.select().from(users).where(eq(users.id, a.owner.id)))[0]!.passwordHash }).where(eq(users.phone, '3001112222'));
      const tokens = {
        member: await login(ctx.app, 'gym-a', '3001112222'),
        reception: await login(ctx.app, 'gym-a', a.reception.phone),
        trainer: await login(ctx.app, 'gym-a', a.trainer.phone),
        owner: await login(ctx.app, 'gym-a', a.owner.phone),
      };
      const routes: [string, string, ('member' | 'reception' | 'trainer' | 'owner')[]][] = [
        ['post', '/v1/members', ['reception', 'owner']],
        ['post', '/v1/payments', ['reception', 'owner']],
        ['get', '/v1/payments', ['reception', 'owner']],
        ['get', '/v1/trainer/today', ['trainer', 'owner']],
        ['post', '/v1/trainer/sessions', ['trainer', 'owner']],
        ['patch', '/v1/trainer/sessions/00000000-0000-4000-8000-000000000000', ['trainer', 'owner']],
      ];
      for (const [method, path, allowed] of routes) {
        for (const role of ['member', 'reception', 'trainer', 'owner'] as const) {
          const res = await (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path)
            .set('Authorization', `Bearer ${tokens[role]}`)
            .send({});
          if (allowed.includes(role)) expect([200, 201, 400, 404], `${role} ${method} ${path}`).toContain(res.status);
          else {
            expect(res.status, `${role} ${method} ${path}`).toBe(403);
            expect(res.body).toEqual({ message: NO_ACCESS });
          }
        }
      }
    });

    it('every new route needs a token', async () => {
      for (const [method, path] of [['post', '/v1/members'], ['post', '/v1/payments'], ['get', '/v1/payments'], ['get', '/v1/trainer/today'], ['get', '/v1/auth/me']] as const) {
        const res = await (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path).send({});
        expect(res.status).toBe(401);
      }
    });
  });
});
