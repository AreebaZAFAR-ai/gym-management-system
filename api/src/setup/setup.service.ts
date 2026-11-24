import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePhone, type Exercise, type FeePlan, type GymBrand, type GymSettings, type StaffMember } from '@gym/shared';
import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { hashPassword } from '../auth/passwords';
import { violatedConstraint } from '../common/db-errors';
import { optionalText, parse, uuidParam } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { exercises, gyms, plans, users } from '../db/schema';
import { toExercise } from '../me/me.service';

export const PLAN_NOT_FOUND = 'Fee plan not found.';
export const STAFF_NOT_FOUND = 'Staff member not found.';
export const CANNOT_DISABLE_SELF = 'You cannot disable your own account.';
export const CANNOT_CHANGE_OWN_ROLE = 'You cannot change your own role.';
export const GYM_NOT_FOUND = 'Gym not found.';

const planFields = {
  name: z.string({ error: 'Enter the plan name.' }).trim().min(1, 'Enter the plan name.'),
  timing: optionalText,
  feePkr: z.number({ error: 'Enter the fee in PKR.' }).int('Enter the fee in whole rupees.').positive('Enter a fee above zero.'),
  months: z.number({ error: 'Enter the months covered.' }).int('Months must be a whole number.').min(1, 'A plan covers at least 1 month.'),
  active: z.boolean({ error: '"active" must be true or false.' }),
};
const createPlanBody = z.object({ ...planFields, active: planFields.active.optional() });
const updatePlanBody = z.object(planFields).partial();

const staffRole = z.enum(['reception', 'trainer', 'owner'], { error: 'Choose a role: reception, trainer or owner.' });
const staffPhone = z.string({ error: 'Enter a mobile number.' }).transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number, e.g. 0300 1234567.' });
  return n ?? '';
});
const createStaffBody = z.object({
  name: z.string({ error: 'Enter the name.' }).trim().min(1, 'Enter the name.'),
  phone: staffPhone,
  role: staffRole,
  password: z.string({ error: 'Enter a starting password.' }).min(1, 'Enter a starting password.'),
});
const updateStaffBody = z.object({
  name: z.string().trim().min(1, 'Enter the name.').optional(),
  role: staffRole.optional(),
  active: z.boolean({ error: '"active" must be true or false.' }).optional(),
  password: z.string().min(1, 'Enter a password.').optional(),
});

const settingsBody = z.object({
  name: z.string().trim().min(1, 'Enter the gym name.').optional(),
  city: z.string().trim().min(1, 'Enter the city.').optional(),
  primaryColor: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'App colour must be a hex colour like #17191C.').optional(),
  graceDays: z.number({ error: 'Grace days must be a number.' }).int('Grace days must be a whole number.').min(0, 'Grace days cannot be negative.').optional(),
  payTo: z.object({ label: z.string().trim(), number: z.string().trim(), title: z.string().trim() }, { error: 'Fill in where members send fees.' }).optional(),
  receptionWhatsapp: z.string().trim().optional(),
  deviceAddress: optionalText.optional(),
  deviceKey: optionalText.optional(),
});

/** §6 Fee plans, Staff and roles, Settings; §10 Brand and Exercises. */
@Injectable()
export class SetupService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ---------- Brand (public) and exercises (any role) ----------

  /** GET gyms/:id (public): name, colour, pay-to details (§10 Brand). Never the check-in secret or device key. */
  async brand(id: string): Promise<GymBrand> {
    const [g] = await this.db.select().from(gyms).where(eq(gyms.id, id));
    if (!g) throw new NotFoundException(GYM_NOT_FOUND);
    return {
      id: g.id, name: g.name, short: g.short, city: g.city, primaryColor: g.primaryColor,
      payTo: { label: g.payToLabel, number: g.payToNumber, title: g.payToTitle },
      receptionWhatsapp: g.receptionWhatsapp, graceDays: g.graceDays,
    };
  }

  /** GET exercises: built-in exercises plus this gym's own. */
  async exercises(user: Principal): Promise<Exercise[]> {
    const rows = await this.db.select().from(exercises)
      .where(or(isNull(exercises.gymId), eq(exercises.gymId, user.gymId)))
      .orderBy(asc(exercises.name));
    return rows.map(toExercise);
  }

  // ---------- Fee plans ----------

  /** GET plans — reception (registration) and owner. Hidden plans included, flagged by `active`. */
  async plans(staff: Principal): Promise<FeePlan[]> {
    const rows = await this.db.select().from(plans).where(eq(plans.gymId, staff.gymId)).orderBy(asc(plans.name), asc(plans.feePkr));
    return rows.map(toPlan);
  }

  async createPlan(staff: Principal, body: unknown): Promise<FeePlan> {
    const input = parse(createPlanBody, body);
    const [row] = await this.db.insert(plans).values({ ...input, gymId: staff.gymId, active: input.active ?? true }).returning();
    return toPlan(row!);
  }

  /** PATCH plans/:id — edit or Hide/Show. Hidden plans stay on existing members (§6). */
  async updatePlan(staff: Principal, id: string, body: unknown): Promise<FeePlan> {
    const input = parse(updatePlanBody, body);
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(PLAN_NOT_FOUND);
    const [row] = await this.db.update(plans).set({ ...input, updatedAt: new Date() })
      .where(and(eq(plans.gymId, staff.gymId), eq(plans.id, id))).returning();
    if (!row) throw new NotFoundException(PLAN_NOT_FOUND);
    return toPlan(row);
  }

  // ---------- Staff ----------

  /** GET staff — owner. */
  async staff(owner: Principal): Promise<StaffMember[]> {
    const rows = await this.db.select().from(users)
      .where(and(eq(users.gymId, owner.gymId), ne(users.role, 'member')))
      .orderBy(asc(users.name));
    return rows.map(toStaff);
  }

  /** POST staff {name, phone, role, starting password} — "Staff accounts are created only by the owner" (§2). */
  async createStaff(owner: Principal, body: unknown): Promise<StaffMember> {
    const input = parse(createStaffBody, body);
    try {
      const [row] = await this.db.insert(users).values({
        gymId: owner.gymId, name: input.name, phone: input.phone, role: input.role, passwordHash: await hashPassword(input.password),
      }).returning();
      return toStaff(row!);
    } catch (err) {
      if (violatedConstraint(err) === 'users_gym_phone_unique') throw new ConflictException('This mobile number is already registered.');
      throw err;
    }
  }

  /** PATCH staff/:id — Disable/Enable, rename, change role or password. Owners cannot disable themselves (§6). */
  async updateStaff(owner: Principal, id: string, body: unknown): Promise<StaffMember> {
    const input = parse(updateStaffBody, body);
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(STAFF_NOT_FOUND);
    if (id === owner.id && input.active === false) throw new ForbiddenException(CANNOT_DISABLE_SELF);
    // Assumption (documented): an owner also cannot change their own role, which would lock them out.
    if (id === owner.id && input.role && input.role !== 'owner') throw new ForbiddenException(CANNOT_CHANGE_OWN_ROLE);
    const [row] = await this.db.update(users)
      .set({
        name: input.name, role: input.role, active: input.active,
        passwordHash: input.password ? await hashPassword(input.password) : undefined, updatedAt: new Date(),
      })
      .where(and(eq(users.gymId, owner.gymId), eq(users.id, id), ne(users.role, 'member')))
      .returning();
    if (!row) throw new NotFoundException(STAFF_NOT_FOUND);
    return toStaff(row);
  }

  // ---------- Settings ----------

  /** GET settings — owner. The check-in secret is never returned. */
  async settings(owner: Principal): Promise<GymSettings> {
    const [g] = await this.db.select().from(gyms).where(eq(gyms.id, owner.gymId));
    if (!g) throw new NotFoundException(GYM_NOT_FOUND);
    return toSettings(g);
  }

  /** PATCH settings — gym name, city, app colour, grace days, pay-to, reception WhatsApp, thumbprint machine. */
  async updateSettings(owner: Principal, body: unknown): Promise<GymSettings> {
    const input = parse(settingsBody, body);
    if (input.receptionWhatsapp && !normalizePhone(input.receptionWhatsapp)) {
      throw new BadRequestException('Enter a valid reception WhatsApp number.');
    }
    const [g] = await this.db.update(gyms).set({
      name: input.name, city: input.city, primaryColor: input.primaryColor, graceDays: input.graceDays,
      payToLabel: input.payTo?.label, payToNumber: input.payTo?.number, payToTitle: input.payTo?.title,
      receptionWhatsapp: input.receptionWhatsapp, deviceAddress: input.deviceAddress, deviceKey: input.deviceKey,
      updatedAt: new Date(),
    }).where(eq(gyms.id, owner.gymId)).returning();
    return toSettings(g!);
  }
}

const toPlan = (p: typeof plans.$inferSelect): FeePlan => ({
  id: p.id, name: p.name, timing: p.timing, feePkr: p.feePkr, months: p.months, active: p.active,
});
const toStaff = (u: typeof users.$inferSelect): StaffMember => ({
  id: u.id, name: u.name, phone: u.phone, role: u.role as StaffMember['role'], active: u.active,
});
const toSettings = (g: typeof gyms.$inferSelect): GymSettings => ({
  name: g.name, city: g.city, primaryColor: g.primaryColor, graceDays: g.graceDays,
  payTo: { label: g.payToLabel, number: g.payToNumber, title: g.payToTitle },
  receptionWhatsapp: g.receptionWhatsapp, deviceAddress: g.deviceAddress, deviceKey: g.deviceKey,
});
