import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApi } from '../../admin/src/lib/api';
import { BAD_TRUST_PROXY, HTTPS_REQUIRED } from '../src/app.setup';
import { TOO_MANY_TRIES, WRONG_LOGIN } from '../src/auth/auth.service';
import { parseEnv, trustProxySetting } from '../src/config/env';
import { TOO_MANY_REGISTRATIONS } from '../src/registration/registration.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { login, seedGym, type GymFixture } from './helpers/staff';

/**
 * §11 "HTTPS only in production" behind a hosting proxy (Railway, Render, Vercel): the proxy
 * ends HTTPS and forwards plain HTTP with X-Forwarded-Proto and X-Forwarded-For. Supertest
 * connects from 127.0.0.1, which plays the proxy (the one trusted hop).
 */
const HTTPS = { 'X-Forwarded-Proto': 'https' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('TRUST_PROXY setting', () => {
  it('defaults to one hop and accepts a number, true/false or a list of addresses', () => {
    expect(parseEnv({ DATABASE_URL: 'postgresql://x@h/db', JWT_SECRET: 'x'.repeat(32) }).TRUST_PROXY).toBe('1');
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('true')).toBe(true);
    expect(trustProxySetting('FALSE')).toBe(false);
    expect(trustProxySetting('10.0.0.1, 10.0.0.0/8')).toBe('10.0.0.1, 10.0.0.0/8');
  });

  it('an invalid value stops the API at startup with a readable message', async () => {
    await expect(createTestApp({ TRUST_PROXY: 'not-an-ip' })).rejects.toThrow(BAD_TRUST_PROXY);
  });
});

describe('production behind the host proxy (TRUST_PROXY default 1)', () => {
  let ctx: TestContext;
  let a: GymFixture;
  let reception: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp({ NODE_ENV: 'production' });
    a = await seedGym(ctx.db, 'gym-a', 'Iron House Fitness', 'IH');
    const res = await http().post('/v1/auth/login').set(HTTPS).send({ gymId: 'gym-a', phone: a.reception.phone, password: 'staff-pass-123' });
    reception = res.body.token;
  });
  afterAll(() => closeTestApp(ctx));

  describe('the HTTPS check', () => {
    it('accepts a request the proxy marks X-Forwarded-Proto: https (and sends HSTS)', async () => {
      const res = await http().get('/v1/gyms/gym-a').set(HTTPS);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Iron House Fitness');
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
      expect(reception).toEqual(expect.any(String));
    });

    it('refuses plain HTTP with no header: 403 "HTTPS is required."', async () => {
      const res = await http().get('/v1/gyms/gym-a');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: HTTPS_REQUIRED });
    });

    it('refuses X-Forwarded-Proto: http', async () => {
      const res = await http().get('/v1/gyms/gym-a').set('X-Forwarded-Proto', 'http');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: HTTPS_REQUIRED });
    });

    it('logins and every other route follow the same rule', async () => {
      const body = { gymId: 'gym-a', phone: a.reception.phone, password: 'staff-pass-123' };
      expect((await http().post('/v1/auth/login').send(body)).status).toBe(403);
      expect((await http().get('/v1/members').set('Authorization', `Bearer ${reception}`)).status).toBe(403);
      expect((await http().get('/v1/members').set(HTTPS).set('Authorization', `Bearer ${reception}`)).status).toBe(200);
    });

    it('/health stays reachable for the host health check', async () => {
      expect((await http().get('/health')).status).toBe(200);
    });
  });

  describe('signed screenshot links', () => {
    it('are relative signed paths, so clients open them on their own https:// API address; they work only over HTTPS', async () => {
      const reg = await http().post('/v1/members').set(HTTPS).set('Authorization', `Bearer ${reception}`)
        .send({ name: 'Ali Raza', phone: '03211234567', joinedOn: '2026-11-01', planId: a.planId });
      expect(reg.status).toBe(201);
      const member = (await http().post('/v1/auth/login').set(HTTPS).send({ gymId: 'gym-a', phone: '03211234567', password: '234567' })).body.token;
      const up = await http().post('/v1/me/payment-proofs').set(HTTPS).set('Authorization', `Bearer ${member}`).attach('file', PNG, 'p.png');
      expect(up.status).toBe(201);

      const [proof] = (await http().get('/v1/payment-proofs').set(HTTPS).set('Authorization', `Bearer ${reception}`)).body;
      // No scheme or host in the link: a proxy or a spoofed Host header can never make it http://.
      expect(proof.imageUrl).toMatch(/^\/v1\/files\/proofs\/[0-9a-f-]{36}\?exp=\d+&sig=[\w-]+$/);
      // The web admin builds the full address from its own (https) API URL.
      const admin = createAdminApi('https://api.ironhouse.pk', {});
      expect(admin.absolute(proof.imageUrl)).toBe(`https://api.ironhouse.pk${proof.imageUrl}`);

      const viaProxy = await http().get(proof.imageUrl).set(HTTPS);
      expect(viaProxy.status).toBe(200);
      expect(viaProxy.headers['content-type']).toBe('image/png');
      expect((await http().get(proof.imageUrl)).status).toBe(403);
      expect((await http().get(proof.imageUrl).set('X-Forwarded-Proto', 'http')).status).toBe(403);
    });
  });

  describe('client address and rate limits', () => {
    it('login limit is per phone number: 10 wrong tries from 10 different client IPs still lock that phone', async () => {
      const phone = a.trainer.phone;
      for (let i = 1; i <= 10; i++) {
        const res = await http().post('/v1/auth/login').set(HTTPS).set('X-Forwarded-For', `198.51.100.${i}`)
          .send({ gymId: 'gym-a', phone, password: 'wrong' });
        expect(res.body).toEqual({ message: WRONG_LOGIN });
      }
      const eleventh = await http().post('/v1/auth/login').set(HTTPS).set('X-Forwarded-For', '198.51.100.99')
        .send({ gymId: 'gym-a', phone, password: 'staff-pass-123' });
      expect(eleventh.status).toBe(429);
      expect(eleventh.body).toEqual({ message: TOO_MANY_TRIES });
    });

    it('another phone from the same client IP is not affected', async () => {
      const res = await http().post('/v1/auth/login').set(HTTPS).set('X-Forwarded-For', '198.51.100.99')
        .send({ gymId: 'gym-a', phone: a.trainer2.phone, password: 'staff-pass-123' });
      expect(res.status).toBe(200);
    });

    it('req.ip is the real client from X-Forwarded-For: the per-address registration limit counts each client separately', async () => {
      const register = (n: number, ip: string) =>
        http().post('/v1/gyms/register').set(HTTPS).set('X-Forwarded-For', ip).send({
          gymName: `Proxy Gym ${n}`, gymEmail: `gym${n}@proxy.pk`, gymPhone: '042 35761234', gymAddress: 'Main Road', city: 'Lahore',
          ownerName: 'Owner', ownerEmail: `owner${n}@proxy.pk`, ownerPhone: `0333 70000${String(n).padStart(2, '0')}`,
          password: 'goodpass1', confirmPassword: 'goodpass1',
        });
      for (let n = 1; n <= 5; n++) expect((await register(n, '203.0.113.7')).status).toBe(201);
      const sixth = await register(6, '203.0.113.7');
      expect(sixth.status).toBe(429);
      expect(sixth.body).toEqual({ message: TOO_MANY_REGISTRATIONS });
      // A different client behind the same proxy has its own allowance.
      expect((await register(7, '203.0.113.8')).status).toBe(201);
    });
  });
});

describe('production with TRUST_PROXY=false (API reachable directly, no proxy)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ NODE_ENV: 'production', TRUST_PROXY: 'false' });
  });
  afterAll(() => closeTestApp(ctx));

  it('X-Forwarded-Proto is not believed, so a plain-HTTP request is refused even with the header', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/gyms/x').set(HTTPS);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: HTTPS_REQUIRED });
  });
});

describe('outside production', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    await seedGym(ctx.db, 'gym-a', 'Iron House Fitness', 'IH');
  });
  afterAll(() => closeTestApp(ctx));

  it('plain HTTP still works for local development', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/gyms/gym-a');
    expect(res.status).toBe(200);
    expect(await login(ctx.app, 'gym-a', '3000000002')).toEqual(expect.any(String));
  });
});
