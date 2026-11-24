import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  paymentPeriod,
  pkToday,
  type Payment,
  type PaymentMethod,
  type RecordPaymentResponse,
} from '@gym/shared';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { pkDayStart } from '../common/db-errors';
import { isoDate, optionalText, parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { gyms, members, payments, plans, users } from '../db/schema';
import { queueWhatsapp, receiptText, renewedMessage, type Executor } from '../whatsapp/whatsapp';

export const MEMBER_NOT_FOUND = 'Member not found.';

export const paymentMethod = z.enum(['cash', 'jazzcash', 'easypaisa', 'bank'], { error: 'Choose a payment method.' });
/** Whole rupees (the column is an integer). */
export const amountPkr = z.number({ error: 'Enter the amount in PKR.' }).int('Enter the amount in whole rupees.');

const recordBody = z.object({
  memberCode: z.string({ error: 'Enter the member ID.' }).trim().min(1, 'Enter the member ID.'),
  amountPkr,
  method: paymentMethod,
  txnId: optionalText,
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

/** Payment rows of one gym created in [from, to). */
export async function paymentsBetween(
  db: Executor,
  gymId: string,
  from: Date,
  to: Date,
): Promise<{ createdAt: Date; amountPkr: number; method: PaymentMethod }[]> {
  return db
    .select({ createdAt: payments.createdAt, amountPkr: payments.amountPkr, method: payments.method })
    .from(payments)
    .where(and(eq(payments.gymId, gymId), gte(payments.createdAt, from), lt(payments.createdAt, to)));
}

@Injectable()
export class PaymentsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** POST payments (§7 Recording a payment). */
  async record(staff: Principal, body: unknown): Promise<RecordPaymentResponse> {
    const input = parse(recordBody, body);
    return this.db.transaction((tx) =>
      renewMembership(tx, staff.gymId, staff.id, eq(members.code, input.memberCode), input),
    );
  }

  /** GET payments?from&to&member — Pakistan dates, inclusive; member = member ID (IH-0412). Newest first. */
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
