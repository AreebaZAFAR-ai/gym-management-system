import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HTTPS_REQUIRED } from '../src/app.setup';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';

describe('app skeleton', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  it('GET /health reports the database is reachable', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('GET /health returns 503 with a plain message when the database is down', async () => {
    const original = ctx.db.execute.bind(ctx.db);
    ctx.db.execute = (() => Promise.reject(new Error('connection refused'))) as unknown as typeof ctx.db.execute;
    try {
      const res = await request(ctx.app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ message: 'Database unreachable' });
    } finally {
      ctx.db.execute = original;
    }
  });

  it('unknown routes return 404 as { message }', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not found.' });
  });

  it('health is not under /v1 and responses do not advertise Express', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(404);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS allows only the configured admin origin', async () => {
    const allowed = await request(ctx.app.getHttpServer()).get('/health').set('Origin', 'http://admin.test');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://admin.test');
    const other = await request(ctx.app.getHttpServer()).get('/health').set('Origin', 'http://evil.test');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('§11 HTTPS only in production', () => {
  let prod: TestContext;

  beforeAll(async () => {
    prod = await createTestApp({ NODE_ENV: 'production' });
  });
  afterAll(() => closeTestApp(prod));

  it('refuses plain HTTP and accepts HTTPS forwarded by the TLS proxy (with HSTS)', async () => {
    const plain = await request(prod.app.getHttpServer()).post('/v1/auth/login').send({});
    expect(plain.status).toBe(403);
    expect(plain.body).toEqual({ message: HTTPS_REQUIRED });
    const secure = await request(prod.app.getHttpServer()).post('/v1/auth/login').set('X-Forwarded-Proto', 'https').send({});
    expect(secure.status).toBe(400);
    expect(secure.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it("keeps /health reachable for the host's health checks", async () => {
    expect((await request(prod.app.getHttpServer()).get('/health')).status).toBe(200);
  });
});
