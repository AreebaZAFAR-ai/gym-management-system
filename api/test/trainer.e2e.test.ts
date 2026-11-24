import { addDays, pkToday } from '@gym/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trainerSessions } from '../src/db/schema';
import { NOT_YOUR_CLIENT, OWN_SESSIONS_ONLY, SESSION_NOT_FOUND } from '../src/trainer/trainer.service';
import { closeTestApp, createTestApp, type TestContext } from './helpers/app';
import { registerMember } from './helpers/seed';
import { login, seedGym, type GymFixture } from './helpers/staff';

describe('trainer sessions (§5.2, §7, §10 and the sessions clarification)', () => {
  let ctx: TestContext;
  let a: GymFixture;
  let b: GymFixture;
  const tokens = {} as Record<'trainer' | 'trainer2' | 'owner' | 'trainerB', string>;
  const ids = {} as Record<'client' | 'client2' | 'clientB', string>;
  const today = pkToday();
  const at = (date: string, time: string) => `${date}T${time}:00+05:00`; // Pakistan time
  const http = () => request(ctx.app.getHttpServer());
  const as = (token: string) => ({
    post: (path: string, body: object) => http().post(path).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body: object) => http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await seedGym(ctx.db, 'gym-a', 'Gym A', 'GA');
    b = await seedGym(ctx.db, 'gym-b', 'Gym B', 'GB');
    tokens.trainer = await login(ctx.app, 'gym-a', a.trainer.phone);
    tokens.trainer2 = await login(ctx.app, 'gym-a', a.trainer2.phone);
    tokens.owner = await login(ctx.app, 'gym-a', a.owner.phone);
    tokens.trainerB = await login(ctx.app, 'gym-b', b.trainer.phone);
    const reg = (gym: GymFixture, phone: string, code: string, trainerId: string) =>
      registerMember(ctx.db, { gymId: gym.gymId, phone, code, planId: gym.planId, recordedBy: gym.reception.id, member: { trainerId } });
    ids.client = (await reg(a, '3005000001', 'GA-0001', a.trainer.id)).memberId;
    ids.client2 = (await reg(a, '3005000002', 'GA-0002', a.trainer2.id)).memberId;
    ids.clientB = (await reg(b, '3005000003', 'GB-0001', b.trainer.id)).memberId;
  });
  afterAll(() => closeTestApp(ctx));

  let trainerSession: string;
  let ownerAssigned: string;

  it('a trainer creates a session for their own client', async () => {
    const res = await as(tokens.trainer).post('/v1/trainer/sessions', {
      memberId: ids.client, startsAt: at(today, '18:00'), title: 'Ali', meta: 'Legs · session 4 of 12', kind: 'pt',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ memberId: ids.client, title: 'Ali', meta: 'Legs · session 4 of 12', kind: 'pt', done: false });
    trainerSession = res.body.id;
    const [row] = await ctx.db.select().from(trainerSessions).where(eq(trainerSessions.id, trainerSession));
    expect(row!.trainerId).toBe(a.trainer.id);
  });

  it('a trainer creates a class (no client)', async () => {
    const res = await as(tokens.trainer).post('/v1/trainer/sessions', { startsAt: at(today, '07:00'), title: 'Morning HIIT', kind: 'class' });
    expect(res.status).toBe(201);
    expect(res.body.memberId).toBeNull();
  });

  it("§7: a trainer cannot create a session for another trainer's client or for another trainer", async () => {
    const client = await as(tokens.trainer).post('/v1/trainer/sessions', { memberId: ids.client2, startsAt: at(today, '19:00'), title: 'x', kind: 'pt' });
    expect(client.status).toBe(403);
    expect(client.body).toEqual({ message: NOT_YOUR_CLIENT });
    const other = await as(tokens.trainer).post('/v1/trainer/sessions', { trainerId: a.trainer2.id, startsAt: at(today, '19:00'), title: 'x', kind: 'class' });
    expect(other.status).toBe(403);
    expect(other.body).toEqual({ message: OWN_SESSIONS_ONLY });
  });

  it('the owner creates a session assigned to a selected trainer', async () => {
    const res = await as(tokens.owner).post('/v1/trainer/sessions', {
      trainerId: a.trainer.id, memberId: ids.client, startsAt: at(today, '20:00'), title: 'Ali', kind: 'pt',
    });
    expect(res.status).toBe(201);
    ownerAssigned = res.body.id;
    const [row] = await ctx.db.select().from(trainerSessions).where(eq(trainerSessions.id, ownerAssigned));
    expect(row!.trainerId).toBe(a.trainer.id);
  });

  it('the owner can also create a session of their own', async () => {
    const res = await as(tokens.owner).post('/v1/trainer/sessions', { startsAt: at(today, '09:00'), title: 'Owner class', kind: 'class' });
    expect(res.status).toBe(201);
    const [row] = await ctx.db.select().from(trainerSessions).where(eq(trainerSessions.id, res.body.id));
    expect(row!.trainerId).toBe(a.owner.id);
  });

  it("the owner cannot assign a session to a non-trainer or another gym's trainer", async () => {
    for (const trainerId of [a.reception.id, b.trainer.id]) {
      const res = await as(tokens.owner).post('/v1/trainer/sessions', { trainerId, startsAt: at(today, '10:00'), title: 'x', kind: 'class' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Trainer not found.' });
    }
  });

  it('GET trainer/today: a trainer sees their own sessions (including owner-assigned), sorted by time', async () => {
    await as(tokens.trainer).post('/v1/trainer/sessions', { startsAt: at(addDays(today, 1), '18:00'), title: 'Tomorrow', kind: 'class' });
    const res = await as(tokens.trainer).get('/v1/trainer/today');
    expect(res.status).toBe(200);
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(['Morning HIIT', 'Ali', 'Ali']);
    expect(res.body.map((s: { id: string }) => s.id)).toContain(ownerAssigned);
    expect((await as(tokens.trainer2).get('/v1/trainer/today')).body).toEqual([]);
  });

  it("GET trainer/today: the owner sees every trainer's and their own sessions", async () => {
    const res = await as(tokens.owner).get('/v1/trainer/today');
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(['Morning HIIT', 'Owner class', 'Ali', 'Ali']);
  });

  it("§11: another gym's trainer sees nothing from this gym", async () => {
    expect((await as(tokens.trainerB).get('/v1/trainer/today')).body).toEqual([]);
  });

  it('PATCH trainer/sessions/:id: mark done and undo', async () => {
    const done = await as(tokens.trainer).patch(`/v1/trainer/sessions/${trainerSession}`, { done: true });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ id: trainerSession, done: true });
    const undone = await as(tokens.trainer).patch(`/v1/trainer/sessions/${trainerSession}`, { done: false });
    expect(undone.body.done).toBe(false);
    expect((await as(tokens.owner).patch(`/v1/trainer/sessions/${ownerAssigned}`, { done: true })).body.done).toBe(true);
  });

  it("a trainer cannot mark another trainer's or another gym's session", async () => {
    for (const token of [tokens.trainer2, tokens.trainerB]) {
      const res = await as(token).patch(`/v1/trainer/sessions/${trainerSession}`, { done: true });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: SESSION_NOT_FOUND });
    }
    expect((await as(tokens.trainer).patch('/v1/trainer/sessions/not-a-uuid', { done: true })).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await as(tokens.trainer).patch(`/v1/trainer/sessions/${trainerSession}`, { done: 'yes' })).body)
      .toEqual({ message: '"done" must be true or false.' });
    for (const [body, message] of [
      [{ startsAt: 'tonight', title: 'x', kind: 'pt' }, 'Enter the start time.'],
      [{ startsAt: at(today, '18:00'), title: ' ', kind: 'pt' }, 'Enter a title.'],
      [{ startsAt: at(today, '18:00'), title: 'x', kind: 'yoga' }, 'Choose personal training or class.'],
      [{ memberId: ids.clientB, startsAt: at(today, '18:00'), title: 'x', kind: 'pt' }, 'Member not found.'],
    ] as const) {
      const res = await as(tokens.trainer).post('/v1/trainer/sessions', body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message });
    }
  });
});
