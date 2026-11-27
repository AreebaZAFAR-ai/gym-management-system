import { randomBytes } from 'node:crypto';
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
  primaryColor: z.string().trim().min(1, 'App colour is required.'),
  memberPrefix: z.string().trim().min(1, 'Member prefix is required.'),
  ownerName: z.string().trim().min(1, 'Owner name is required.'),
  ownerPhone: z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Owner phone must be a Pakistani mobile number.' });
    return n ?? '';
  }),
  ownerPassword: z.string({ error: 'Owner password is required (OWNER_PASSWORD).' }).min(1, 'Owner password is required (OWNER_PASSWORD).'),
  /** Contact details, set by self-registration; the super-admin script leaves them empty. */
  email: z.string().trim().toLowerCase().nullish(),
  phone: z.string().trim().nullish(),
  address: z.string().trim().nullish(),
  ownerEmail: z.string().trim().toLowerCase().nullish(),
});
export type CreateGymInput = z.input<typeof createGymInput>;

export async function createGym(db: Database, raw: CreateGymInput): Promise<{ gymId: string; ownerId: string }> {
  const input = createGymInput.parse(raw);
  const passwordHash = await hashPassword(input.ownerPassword);
  return db.transaction(async (tx) => {
    await tx.insert(gyms).values({
      id: input.id, name: input.name, short: input.short, city: input.city, primaryColor: input.primaryColor,
      memberPrefix: input.memberPrefix, checkinSecret: randomBytes(32).toString('base64url'),
      email: input.email ?? null, phone: input.phone ?? null, address: input.address ?? null,
    });
    const [owner] = await tx.insert(users)
      .values({ gymId: input.id, phone: input.ownerPhone, name: input.ownerName, role: 'owner', passwordHash, email: input.ownerEmail ?? null })
      .returning({ id: users.id });
    return { gymId: input.id, ownerId: owner!.id };
  });
}

/**
 * The demo gym of §13 ("a seed script with a demo gym"), using the gym, owner and
 * fee plans of the app's existing demo data. The owner password is supplied by the caller.
 */
export const demoGym = (ownerPassword: string): CreateGymInput => ({
  id: 'demo', name: 'Iron House Fitness (Demo)', short: 'IH', city: 'Lahore', primaryColor: '#17191C', memberPrefix: 'IH',
  ownerName: 'Kamran Iqbal', ownerPhone: '03451234567', ownerPassword,
});

export async function seedDemoPlans(db: Database, gymId: string) {
  await db.insert(plans).values([
    { gymId, name: 'Monthly', timing: null, feePkr: 4000, months: 1 },
    { gymId, name: 'Monthly', timing: 'Ladies timings 11am–3pm', feePkr: 3500, months: 1 },
    { gymId, name: 'Quarterly', timing: null, feePkr: 11000, months: 3 },
  ]);
}
