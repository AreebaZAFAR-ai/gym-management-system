import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  defaultPassword,
  firstPaymentPeriod,
  memberCode,
  normalizePhone,
  pkToday,
  type MemberDetail,
  type MemberListItem,
  type RegisterMemberResponse,
} from '@gym/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { hashPassword } from '../auth/passwords';
import { pkDayStart, violatedConstraint } from '../common/db-errors';
import { isoDate, optionalText, parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { checkins, dueDateChanges, gyms, members, payments, plans, users, whatsappMessages } from '../db/schema';
import { toLogItem } from '../door/door.service';
import { amountPkr, paymentMethod, toPayment } from '../payments/payments.service';
import { queueWhatsapp, receiptText, toWhatsAppMessage, type Executor } from '../whatsapp/whatsapp';
import { selectMembers, toListItem, type MemberRow } from './member-view';

export const DUPLICATE_PHONE = 'This mobile number is already registered.';
export const DUPLICATE_FINGERPRINT = 'This thumbprint ID is already assigned to another member.';
export const MEMBER_NOT_FOUND = 'Member not found.';
export const OWNER_ONLY_DUE_DATE = 'Only the owner can change a due date.';

const phoneField = z.string({ error: 'Enter a mobile number.' }).transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number, e.g. 0300 1234567.' });
  return n ?? '';
});
const gender = z.enum(['male', 'female', 'other'], { error: 'Choose a gender.' });
const goal = z.enum(['strength', 'muscle', 'fat_loss', 'fitness'], { error: 'Choose a goal.' });

const registerBody = z.object({
  name: z.string({ error: 'Enter the member’s name.' }).trim().min(1, 'Enter the member’s name.'),
  phone: phoneField,
  gender: gender.nullish(),
  joinedOn: isoDate('Enter the joining date.'),
  goal: goal.nullish(),
  emergencyContact: optionalText,
  fingerprintId: optionalText,
  notes: optionalText,
  planId: z.string({ error: 'Choose a fee plan.' }).uuid('Choose a fee plan.'),
  trainerId: z.string().uuid('Trainer not found.').nullish(),
  // Registration requires the first membership payment (clarification).
  payment: z.object(
    { amountPkr, method: paymentMethod, txnId: optionalText },
    { error: 'Registration needs the first membership payment.' },
  ),
});

const updateBody = z.object({
  name: z.string().trim().min(1, 'Enter the member’s name.').optional(),
  phone: phoneField.optional(),
  gender: gender.nullish(),
  goal: goal.nullish(),
  emergencyContact: optionalText.optional(),
  fingerprintId: optionalText.optional(),
  notes: optionalText.optional(),
  planId: z.string().uuid('Fee plan not found.').optional(),
  trainerId: z.string().uuid('Trainer not found.').nullish(),
  active: z.boolean({ error: '"active" must be true or false.' }).optional(),
  dueOn: isoDate('Enter the due date.').optional(),
});

const listQuery = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['all', 'active', 'due_soon', 'overdue', 'frozen'], { error: 'Unknown status filter.' }).optional(),
});

@Injectable()
export class MembersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** GET members?q&status (§6 Members): search by name, ID or phone; filter by status. */
  async list(staff: Principal, query: unknown): Promise<MemberListItem[]> {
    const { q, status = 'all' } = parse(listQuery, query);
    const today = pkToday();
    let rows = (await selectMembers(this.db, staff.gymId)).map((m) => toListItem(m, today));
    if (status !== 'all') rows = rows.filter((m) => m.status === status);
    if (q) {
      const text = q.toLowerCase();
      const digits = q.replace(/\D/g, '');
      const phone = normalizePhone(q) ?? (digits.length >= 3 ? digits.replace(/^0/, '') : null);
      rows = rows.filter(
        (m) => m.name.toLowerCase().includes(text) || m.code.toLowerCase().includes(text) || (phone !== null && m.phone.includes(phone)),
      );
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** GET members/:code (§6 Member page). */
  async detail(staff: Principal, code: string): Promise<MemberDetail> {
    const m = await this.find(this.db, staff.gymId, code);
    return this.toDetail(staff.gymId, m);
  }

  /**
   * PATCH members/:code (§6 Edit, Disable/Enable). Reception or owner; only the
   * owner may change the due date (§2), and every due-date edit is logged (§11).
   */
  async update(staff: Principal, code: string, body: unknown): Promise<MemberDetail> {
    const input = parse(updateBody, body);
    if (input.dueOn !== undefined && staff.role !== 'owner') throw new ForbiddenException(OWNER_ONLY_DUE_DATE);

    try {
      await this.db.transaction(async (tx) => {
        const m = await this.find(tx, staff.gymId, code, true);
        if (input.planId) await this.assertPlan(tx, staff.gymId, input.planId);
        if (input.trainerId) await this.assertTrainer(tx, staff.gymId, input.trainerId);

        const userChanges = { name: input.name, phone: input.phone, active: input.active };
        if (Object.values(userChanges).some((v) => v !== undefined)) {
          await tx.update(users).set({ ...userChanges, updatedAt: new Date() })
            .where(and(eq(users.gymId, staff.gymId), eq(users.id, m.memberId)));
        }

        const memberChanges = {
          gender: input.gender, goal: input.goal, emergencyContact: input.emergencyContact, fingerprintId: input.fingerprintId,
          notes: input.notes, planId: input.planId, trainerId: input.trainerId, dueOn: input.dueOn,
        };
        if (Object.values(memberChanges).some((v) => v !== undefined)) {
          await tx.update(members).set({ ...memberChanges, updatedAt: new Date() })
            .where(and(eq(members.gymId, staff.gymId), eq(members.userId, m.memberId)));
        }
        if (input.dueOn !== undefined && input.dueOn !== m.dueOn) {
          await tx.insert(dueDateChanges).values({
            gymId: staff.gymId, memberId: m.memberId, oldDueOn: m.dueOn, newDueOn: input.dueOn, changedBy: staff.id,
          });
        }
      });
    } catch (err) {
      throw mapConflict(err);
    }
    return this.detail(staff, code);
  }

  /**
   * POST members (§6 Add member, §7 Registration). Reception or owner.
   * - Member ID = gym prefix + running number, never reused.
   * - One account per mobile number per gym.
   * - Default password = last 6 digits of the mobile number, returned once.
   * - The first payment starts on the payment date (today) and runs the plan's months.
   * - Saving the payment queues the WhatsApp receipt (§7).
   * Unresolved: §6/§7 also require a welcome WhatsApp, but the PDF gives no wording,
   * so it is not queued yet.
   */
  async register(staff: Principal, body: unknown): Promise<RegisterMemberResponse> {
    const input = parse(registerBody, body);
    const temporaryPassword = defaultPassword(input.phone);
    const passwordHash = await hashPassword(temporaryPassword);
    const today = pkToday();

    try {
      return await this.db.transaction(async (tx) => {
        const plan = await this.assertPlan(tx, staff.gymId, input.planId);
        if (input.trainerId) await this.assertTrainer(tx, staff.gymId, input.trainerId);

        const [gym] = await tx
          .update(gyms)
          .set({ lastMemberNumber: sql`${gyms.lastMemberNumber} + 1` })
          .where(eq(gyms.id, staff.gymId))
          .returning({ number: gyms.lastMemberNumber, prefix: gyms.memberPrefix, name: gyms.name });
        const code = memberCode(gym!.prefix, gym!.number);

        const [user] = await tx
          .insert(users)
          .values({ gymId: staff.gymId, phone: input.phone, name: input.name, role: 'member', passwordHash })
          .returning({ id: users.id });
        const memberId = user!.id;

        const { periodFrom, periodTo } = firstPaymentPeriod(plan.months, today);
        await tx.insert(members).values({
          userId: memberId, gymId: staff.gymId, code, planId: plan.id, trainerId: input.trainerId ?? null,
          joinedOn: input.joinedOn, dueOn: periodTo, goal: input.goal ?? null, gender: input.gender ?? null,
          emergencyContact: input.emergencyContact, fingerprintId: input.fingerprintId, notes: input.notes,
        });
        const [payment] = await tx
          .insert(payments)
          .values({
            gymId: staff.gymId, memberId, amountPkr: input.payment.amountPkr, method: input.payment.method,
            txnId: input.payment.txnId, periodFrom, periodTo, recordedBy: staff.id,
          })
          .returning();

        await queueWhatsapp(tx, {
          gymId: staff.gymId, memberId, toPhone: input.phone, kind: 'receipt',
          body: receiptText(input.name, input.payment.amountPkr, input.payment.method, gym!.name, periodTo),
        });

        return { memberId, code, temporaryPassword, dueOn: periodTo, payment: toPayment(payment!) };
      });
    } catch (err) {
      throw mapConflict(err);
    }
  }

  // ---------- Helpers ----------

  private async find(db: Executor, gymId: string, code: string, forUpdate = false): Promise<MemberRow> {
    const where = sql`upper(${members.code}) = ${code.trim().toUpperCase()}`;
    if (forUpdate) {
      // Lock the member row for the rest of the transaction.
      await db.select({ id: members.userId }).from(members).where(and(eq(members.gymId, gymId), where)).for('update');
    }
    const [m] = await selectMembers(db, gymId, where);
    if (!m) throw new NotFoundException(MEMBER_NOT_FOUND);
    return m;
  }

  private async assertPlan(db: Executor, gymId: string, planId: string) {
    const [plan] = await db.select({ id: plans.id, months: plans.months }).from(plans)
      .where(and(eq(plans.gymId, gymId), eq(plans.id, planId)));
    if (!plan) throw new BadRequestException('Fee plan not found.');
    return plan;
  }

  private async assertTrainer(db: Executor, gymId: string, trainerId: string) {
    const [t] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.gymId, gymId), eq(users.id, trainerId)));
    if (!t) throw new BadRequestException('Trainer not found.');
  }

  private async toDetail(gymId: string, m: MemberRow): Promise<MemberDetail> {
    const today = pkToday();
    const [paymentRows, checkinRows, messageRows, changeRows, visits] = await Promise.all([
      this.db.select().from(payments).where(and(eq(payments.gymId, gymId), eq(payments.memberId, m.memberId))).orderBy(desc(payments.createdAt)),
      this.db.select().from(checkins).where(and(eq(checkins.gymId, gymId), eq(checkins.memberId, m.memberId))).orderBy(desc(checkins.createdAt)).limit(20),
      this.db.select().from(whatsappMessages).where(and(eq(whatsappMessages.gymId, gymId), eq(whatsappMessages.memberId, m.memberId))).orderBy(desc(whatsappMessages.createdAt)),
      this.db.select().from(dueDateChanges).where(and(eq(dueDateChanges.gymId, gymId), eq(dueDateChanges.memberId, m.memberId))).orderBy(desc(dueDateChanges.createdAt)),
      this.db
        .select({ days: sql<number>`count(distinct ((${checkins.createdAt} at time zone 'Asia/Karachi')::date))::int` })
        .from(checkins)
        .where(and(eq(checkins.gymId, gymId), eq(checkins.memberId, m.memberId), eq(checkins.allowed, true), gte(checkins.createdAt, pkDayStart(addDays(today, -29))))),
    ]);
    return {
      ...toListItem(m, today),
      gender: m.gender,
      goal: m.goal,
      joinedOn: m.joinedOn,
      emergencyContact: m.emergencyContact,
      fingerprintId: m.fingerprintId,
      notes: m.notes,
      visitsLast30Days: Number(visits[0]?.days ?? 0),
      payments: paymentRows.map(toPayment),
      checkins: checkinRows.map((c) => toLogItem(c, m.code, m.name)),
      whatsapp: messageRows.map((w) => toWhatsAppMessage(w, m.name)),
      dueDateChanges: changeRows.map((d) => ({
        id: d.id, oldDueOn: d.oldDueOn, newDueOn: d.newDueOn, changedBy: d.changedBy, createdAt: d.createdAt.toISOString(),
      })),
    };
  }
}

function mapConflict(err: unknown): unknown {
  const constraint = violatedConstraint(err);
  if (constraint === 'users_gym_phone_unique') return new ConflictException(DUPLICATE_PHONE);
  if (constraint === 'members_gym_fingerprint_unique') return new ConflictException(DUPLICATE_FINGERPRINT);
  return err;
}
