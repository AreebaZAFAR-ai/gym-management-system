import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashPassword } from '../../src/auth/passwords';
import type { Database } from '../../src/db/db.module';
import { gyms, plans, users } from '../../src/db/schema';

export const STAFF_PASSWORD = 'staff-pass-123';

export interface GymFixture {
  gymId: string;
  name: string;
  planId: string;
  owner: { id: string; phone: string };
  reception: { id: string; phone: string };
  trainer: { id: string; phone: string };
  trainer2: { id: string; phone: string };
}

let passwordHash: Promise<string> | undefined;

/** A gym with one fee plan (PKR 4,000 / 1 month) and owner, reception and two trainer accounts. */
export async function seedGym(db: Database, gymId: string, name: string, prefix: string): Promise<GymFixture> {
  passwordHash ??= hashPassword(STAFF_PASSWORD);
  const hash = await passwordHash;
  await db.insert(gyms).values({ id: gymId, name, short: prefix, city: 'Lahore', primaryColor: '#17191C', memberPrefix: prefix, checkinSecret: `secret-${gymId}` });
  const [plan] = await db.insert(plans).values({ gymId, name: 'Monthly', feePkr: 4000, months: 1 }).returning();
  const add = async (phone: string, role: 'owner' | 'reception' | 'trainer', staffName: string) => {
    const [u] = await db.insert(users).values({ gymId, phone, name: staffName, role, passwordHash: hash }).returning();
    return { id: u!.id, phone };
  };
  return {
    gymId, name, planId: plan!.id,
    owner: await add('3000000001', 'owner', 'Owner'),
    reception: await add('3000000002', 'reception', 'Reception'),
    trainer: await add('3000000003', 'trainer', 'Trainer One'),
    trainer2: await add('3000000004', 'trainer', 'Trainer Two'),
  };
}

export async function login(app: INestApplication, gymId: string, phone: string, password = STAFF_PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer()).post('/v1/auth/login').send({ gymId, phone, password });
  if (res.status !== 200) throw new Error(`login failed for ${gymId}/${phone}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}
