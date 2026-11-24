import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  paymentPeriod,
  pkToday,
  type Payment,
  type PaymentMethod,
  type RecordPaymentResponse,
} from '@gym/shared';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { pkDayStart } from '../common/db-errors';
import { isoDate, optionalText, parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { gyms, members, payments, plans, users } from '../db/schema';
import { queueWhatsapp, receiptText, renewedMessage, type Executor } from '../whatsapp/whatsapp';

export const MEMBER_NOT_FOUND = 'Member not found.';
export const PAYMENT_NOT_FOUND = 'Payment not found.';
export const ONLY_ORIGINAL = 'Only an original payment can be corrected. Correct the original payment instead.';
export const SAME_MEMBER = 'A correction must be for the same member as the original payment.';
export const correctionSaved = 'Correction saved. The original payment stays in the history.';

export const paymentMethod = z.enum(['cash', 'jazzcash', 'easypaisa', 'bank'], { error: 'Choose a payment method.' });
export const amountPkr = z
  .number({ error: 'Enter an amount above zero.' })
  .int('Enter the amount in whole rupees.')
  .positive('Enter an amount above zero.');

const recordBody = z.object({
  memberCode: z.string({ error: 'Enter the member ID.' }).trim().min(1, 'Enter the member ID.'),
  amountPkr,
  method: paymentMethod,
  txnId: optionalText,
  correctsPaymentId: z.string().uuid(PAYMENT_NOT_FOUND).nullish(),
});

const listQuery = z.object({
  from: isoDate('"from" must be a date like 2026-11-25.').optional(),
  to: isoDate('"to" must be a date like 2026-11-25.').optional(),
  member: z.string().trim().min(1).optional(),
});

export function toPayment(row: typeof payments.$inferSelect): Payment {
  return {
    id: row.id,
    memberId: row.memberId,
    amountPkr: row.amountPkr,
    method: row.method,
    txnId: row.txnId,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    recordedBy: row.recordedBy,
    proofId: row.proofId,
    correctsPaymentId: row.correctsPaymentId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RenewalInput {
  amountPkr: number;
  method: PaymentMethod;
  txnId: string | null;
  proofId?: string | null;
}

/**
 * §7 Recording a payment, inside the caller's transaction. Paying early extends
 * from the current due date, paying after it starts from today; new due date =
 * start + the plan's months (month-end clamped). Clears any freeze, stores who
 * recorded it and queues the WhatsApp receipt. The member row is locked so two
 * payments never race on the due date.
 */
export async function renewMembership(
  tx: Executor,
  gymId: string,
  recordedBy: string,
  memberWhere: SQL,
  input: RenewalInput,
): Promise<RecordPaymentResponse> {
  const [m] = await tx
    .select({ memberId: members.userId, dueOn: members.dueOn, name: users.name, phone: users.phone, planMonths: plans.months, gymName: gyms.name })
    .from(members)
    .innerJoin(users, and(eq(users.gymId, members.gymId), eq(users.id, members.userId)))
    .innerJoin(plans, and(eq(plans.gymId, members.gymId), eq(plans.id, members.planId)))
    .innerJoin(gyms, eq(gyms.id, members.gymId))
    .where(and(eq(members.gymId, gymId), memberWhere))
    .for('update', { of: members });
  if (!m) throw new NotFoundException(MEMBER_NOT_FOUND);

  const { periodFrom, periodTo } = paymentPeriod(m.dueOn, m.planMonths, pkToday());
  const [row] = await tx
    .insert(payments)
    .values({
      gymId, memberId: m.memberId, amountPkr: input.amountPkr, method: input.method, txnId: input.txnId,
      periodFrom, periodTo, recordedBy, proofId: input.proofId ?? null,
    })
    .returning();
  await tx
    .update(members)
    .set({ dueOn: periodTo, frozenUntil: null, updatedAt: new Date() })
    .where(and(eq(members.gymId, gymId), eq(members.userId, m.memberId)));
  await queueWhatsapp(tx, {
    gymId, memberId: m.memberId, toPhone: m.phone, kind: 'receipt',
    body: receiptText(m.name, input.amountPkr, input.method, m.gymName, periodTo),
  });
  return { payment: toPayment(row!), newDueOn: periodTo, message: renewedMessage(periodTo) };
}

/**
 * Payments counted once each, using the latest correction's amount and method
 * (the original's date). Originals created in [from, to).
 */
export async function effectivePayments(
  db: Executor & Pick<Database, 'execute'>,
  gymId: string,
  from: Date,
  to: Date,
): Promise<{ createdAt: Date; amountPkr: number; method: PaymentMethod }[]> {
  // node-postgres and PGlite both return { rows }.
  const res = (await db.execute(sql`
    select o.created_at as "createdAt",
           coalesce(c.amount_pkr, o.amount_pkr) as "amountPkr",
           coalesce(c.method, o.method) as "method"
      from payments o
      left join lateral (
        select x.amount_pkr, x.method from payments x
         where x.gym_id = o.gym_id and x.corrects_payment_id = o.id
         order by x.created_at desc, x.id desc limit 1
      ) c on true
     where o.gym_id = ${gymId} and o.corrects_payment_id is null
       and o.created_at >= ${from.toISOString()} and o.created_at < ${to.toISOString()}`)) as unknown as { rows: unknown[] };
  return (res.rows as { createdAt: Date | string; amountPkr: number | string; method: PaymentMethod }[]).map((r) => ({
    createdAt: new Date(r.createdAt),
    amountPkr: Number(r.amountPkr),
    method: r.method,
  }));
}

@Injectable()
export class PaymentsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** POST payments: a renewal (§7), or with correctsPaymentId a Corrected Payment. */
  async record(staff: Principal, body: unknown): Promise<RecordPaymentResponse> {
    const input = parse(recordBody, body);
    if (input.correctsPaymentId) return this.correct(staff, input as typeof input & { correctsPaymentId: string });
    return this.db.transaction((tx) =>
      renewMembership(tx, staff.gymId, staff.id, eq(members.code, input.memberCode), input),
    );
  }

  /**
   * Corrected Payment (§9 "corrections are new rows"; clarification: identifiable,
   * linked to the original, original never changed). Documented defaults:
   *  - the original must be an original payment (not itself a correction);
   *    it may be corrected more than once, the latest correction counts;
   *  - the correction must be for the same member;
   *  - it keeps the original's period and does not change the due date;
   *  - no new WhatsApp receipt is queued (no new money was received).
   */
  private async correct(staff: Principal, input: { memberCode: string; amountPkr: number; method: PaymentMethod; txnId: string | null; correctsPaymentId: string }): Promise<RecordPaymentResponse> {
    return this.db.transaction(async (tx) => {
      const [orig] = await tx
        .select({ p: payments, memberCode: members.code, dueOn: members.dueOn })
        .from(payments)
        .innerJoin(members, and(eq(members.gymId, payments.gymId), eq(members.userId, payments.memberId)))
        .where(and(eq(payments.gymId, staff.gymId), eq(payments.id, input.correctsPaymentId)));
      if (!orig) throw new NotFoundException(PAYMENT_NOT_FOUND);
      if (orig.p.correctsPaymentId) throw new BadRequestException(ONLY_ORIGINAL);
      if (orig.memberCode !== input.memberCode) throw new BadRequestException(SAME_MEMBER);

      const [row] = await tx
        .insert(payments)
        .values({
          gymId: staff.gymId, memberId: orig.p.memberId, amountPkr: input.amountPkr, method: input.method, txnId: input.txnId,
          periodFrom: orig.p.periodFrom, periodTo: orig.p.periodTo, recordedBy: staff.id, correctsPaymentId: orig.p.id,
        })
        .returning();
      return { payment: toPayment(row!), newDueOn: orig.dueOn, message: correctionSaved };
    });
  }

  /** GET payments?from&to&member — Pakistan dates, inclusive; member = member ID (IH-0412). Newest first; corrections included. */
  async list(staff: Principal, query: unknown): Promise<Payment[]> {
    const q = parse(listQuery, query);
    const where: SQL[] = [eq(payments.gymId, staff.gymId)];
    if (q.from) where.push(gte(payments.createdAt, pkDayStart(q.from)));
    if (q.to) where.push(lt(payments.createdAt, pkDayStart(addDays(q.to, 1))));
    if (q.member) where.push(eq(members.code, q.member));

    const rows = await this.db
      .select({ payment: payments })
      .from(payments)
      .innerJoin(members, and(eq(members.gymId, payments.gymId), eq(members.userId, payments.memberId)))
      .where(and(...where))
      .orderBy(desc(payments.createdAt));
    return rows.map((r) => toPayment(r.payment));
  }
}
