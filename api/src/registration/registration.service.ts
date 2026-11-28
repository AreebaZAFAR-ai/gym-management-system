import { ConflictException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  gymCodeFromName,
  GYM_CODE_MAX_LENGTH,
  isValidContactPhone,
  isValidEmail,
  normalizePhone,
  passwordProblem,
  prefixFromName,
  type RegisterGymResponse,
} from '@gym/shared';
import { eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { violatedConstraint } from '../common/db-errors';
import { parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { gyms, users } from '../db/schema';
import { createGym } from '../setup/create-gym';
import { RegisterLimiter } from './register-limiter';

export const GYM_EMAIL_TAKEN = 'A gym with this email is already registered.';
export const OWNER_EMAIL_TAKEN = 'An account with this owner email already exists.';
export const TOO_MANY_REGISTRATIONS = 'Too many registrations from this connection. Please try again later.';

/** §12 design guidelines: black and white; the owner can change it in Settings. */
export const DEFAULT_PRIMARY_COLOR = '#17191C';

const text = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`);

const email = (label: string) =>
  z.string({ error: `${label} is required.` }).trim().toLowerCase()
    .min(1, `${label} is required.`)
    .refine(isValidEmail, `Enter a valid ${label.toLowerCase()}.`);

/**
 * Only these keys are read; anything else in the body (role, gymId, isAdmin…) is
 * dropped by Zod, so a request cannot choose its own role or gym code.
 */
const registerBody = z
  .object({
    gymName: text('Gym name', 100),
    gymEmail: email('Gym email'),
    gymPhone: z.string({ error: 'Gym phone number is required.' }).trim()
      .min(1, 'Gym phone number is required.')
      .refine(isValidContactPhone, 'Enter a valid gym phone number (7 to 15 digits).'),
    gymAddress: text('Gym address', 300),
    city: text('City', 60),
    ownerName: text('Owner name', 100),
    ownerEmail: email('Owner email'),
    ownerPhone: z.string({ error: 'Owner mobile number is required.' }).transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'Owner mobile number must be a Pakistani mobile number (10 digits starting with 3).' });
      return n ?? '';
    }),
    password: z.string({ error: 'Password is required.' }),
    confirmPassword: z.string({ error: 'Confirm your password.' }),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.password, v.confirmPassword);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['password'] });
  });

/** Collisions on the generated gym code are retried with the next free suffix. */
const MAX_CODE_ATTEMPTS = 5;

/**
 * Gym self-registration: creates the gym and its first owner in one transaction
 * (the same `createGym` the super-admin script uses). The new account is always
 * an owner of the new gym only; there is no super-admin role in the data model.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(RegisterLimiter) private readonly limiter: RegisterLimiter,
  ) {}

  async register(body: unknown, clientKey: string): Promise<RegisterGymResponse> {
    const input = parse(registerBody, body);
    if (!this.limiter.attempt(clientKey)) throw new HttpException(TOO_MANY_REGISTRATIONS, HttpStatus.TOO_MANY_REQUESTS);

    // Friendly messages first; the unique indexes still decide under a race.
    const [gymTaken] = await this.db.select({ id: gyms.id }).from(gyms).where(eq(sql`lower(${gyms.email})`, input.gymEmail));
    if (gymTaken) throw new ConflictException(GYM_EMAIL_TAKEN);
    const [ownerTaken] = await this.db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, input.ownerEmail));
    if (ownerTaken) throw new ConflictException(OWNER_EMAIL_TAKEN);

    const prefix = prefixFromName(input.gymName);
    let code = await this.freeCode(gymCodeFromName(input.gymName));
    for (let attempt = 1; ; attempt++) {
      try {
        await createGym(this.db, {
          id: code, name: input.gymName, short: prefix, city: input.city, primaryColor: DEFAULT_PRIMARY_COLOR,
          memberPrefix: prefix, ownerName: input.ownerName, ownerPhone: input.ownerPhone, ownerPassword: input.password,
          email: input.gymEmail, phone: input.gymPhone, address: input.gymAddress, ownerEmail: input.ownerEmail,
        });
        return { gymId: code, gymName: input.gymName, ownerName: input.ownerName, ownerPhone: input.ownerPhone };
      } catch (err) {
        const constraint = violatedConstraint(err);
        if (constraint === 'gyms_email_ci_unique') throw new ConflictException(GYM_EMAIL_TAKEN);
        if (constraint === 'users_email_ci_unique') throw new ConflictException(OWNER_EMAIL_TAKEN);
        if (constraint === 'gyms_pkey' && attempt < MAX_CODE_ATTEMPTS) {
          code = await this.freeCode(gymCodeFromName(input.gymName));
          continue;
        }
        throw err;
      }
    }
  }

  /** `base`, or `base-2`, `base-3`… — the first gym code not yet used. */
  private async freeCode(base: string): Promise<string> {
    // Suffixed codes may shorten a long base, so match on the shortest stem a candidate can have.
    // Slugs contain only a-z, 0-9 and "-", so nothing needs escaping in LIKE.
    const stem = base.slice(0, GYM_CODE_MAX_LENGTH - 4).replace(/-+$/, '');
    const rows = await this.db.select({ id: gyms.id }).from(gyms).where(or(eq(gyms.id, base), like(gyms.id, `${stem}%`)));
    const used = new Set(rows.map((r) => r.id));
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) {
      const suffix = `-${n}`;
      const candidate = `${base.slice(0, GYM_CODE_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}
