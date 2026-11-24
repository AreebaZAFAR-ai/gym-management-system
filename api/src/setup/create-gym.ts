import { randomBytes, randomInt } from 'node:crypto';
import { normalizePhone } from '@gym/shared';
import { z } from 'zod';
import { hashPassword } from '../auth/passwords';
import type { Database } from '../db/db.module';
import { gyms, plans, users } from '../db/schema';

/**
 * §12 White-label step 1 (super admin, "a script is enough for now"): create the
 * gym row (id, name, short letters, city, member prefix, random check-in secret)
 * and its first owner account. Fee plans, staff and members are then added by
 * the owner in the web admin.
 */
export const createGymInput = z.object({
  id: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Gym ID must be a lowercase slug like "ironhouse".'),
  name: z.string().trim().min(1, 'Gym name is required.'),
  short: z.string().trim().min(1, 'Short letters are required.'),
  city: z.string().trim().min(1, 'City is required.'),
  primaryColor: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be like #17191C.').default('#17191C'),
  memberPrefix: z.string().trim().min(1, 'Member prefix is required.'),
  ownerName: z.string().trim().min(1, 'Owner name is required.'),
  ownerPhone: z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Owner phone must be a Pakistani mobile number.' });
    return n ?? '';
  }),
  /** If omitted, a random 10-digit password is generated and returned once. */
  ownerPassword: z.string().min(8, 'Owner password must be at least 8 characters.').optional(),
});
export type CreateGymInput = z.input<typeof createGymInput>;

export async function createGym(db: Database, raw: CreateGymInput): Promise<{ gymId: string; ownerId: string; ownerPassword: string }> {
  const input = createGymInput.parse(raw);
  const ownerPassword = input.ownerPassword ?? randomInt(1_000_000_000, 9_999_999_999).toString();
  const passwordHash = await hashPassword(ownerPassword);
  return db.transaction(async (tx) => {
    await tx.insert(gyms).values({
      id: input.id, name: input.name, short: input.short, city: input.city, primaryColor: input.primaryColor,
      memberPrefix: input.memberPrefix, checkinSecret: randomBytes(32).toString('base64url'),
    });
    const [owner] = await tx.insert(users)
      .values({ gymId: input.id, phone: input.ownerPhone, name: input.ownerName, role: 'owner', passwordHash })
      .returning({ id: users.id });
    return { gymId: input.id, ownerId: owner!.id, ownerPassword };
  });
}

/** The demo gym of §13 ("a seed script with a demo gym"): the same names the app's demo mode shows. */
export const DEMO_GYM: CreateGymInput = {
  id: 'demo', name: 'Iron House Fitness (Demo)', short: 'IH', city: 'Lahore', memberPrefix: 'IH',
  ownerName: 'Kamran Iqbal', ownerPhone: '03451234567', ownerPassword: 'demo-owner-pass',
};

export async function seedDemoPlans(db: Database, gymId: string) {
  await db.insert(plans).values([
    { gymId, name: 'Monthly', timing: null, feePkr: 4000, months: 1 },
    { gymId, name: 'Monthly', timing: 'Ladies timings 11am–3pm', feePkr: 3500, months: 1 },
    { gymId, name: 'Quarterly', timing: null, feePkr: 11000, months: 3 },
  ]);
}
