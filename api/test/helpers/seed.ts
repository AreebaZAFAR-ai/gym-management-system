import { firstPaymentPeriod } from '@gym/shared';
import type { Database } from '../../src/db/db.module';
import { members, payments, users } from '../../src/db/schema';

export interface RegisterInput {
  gymId: string;
  phone: string;
  code: string;
  planId: string;
  recordedBy: string;
  /** Date of the first membership payment (default 2026-11-01). */
  paymentDate?: string;
  planMonths?: number;
  joinedOn?: string;
  /** Override only to set up a member in a given state (e.g. overdue) for door tests. */
  dueOn?: string;
  amountPkr?: number;
  member?: Partial<typeof members.$inferInsert>;
}

/**
 * Registers a member the only way the database accepts: user, member and the
 * first membership payment saved in one transaction. The period comes from
 * firstPaymentPeriod (starts on the payment date) unless dueOn is overridden.
 * Test fixture only; the registration endpoint belongs to the API stage.
 */
export async function registerMember(db: Database, r: RegisterInput): Promise<{ memberId: string; paymentId: string }> {
  const paymentDate = r.paymentDate ?? '2026-11-01';
  const joinedOn = r.joinedOn ?? paymentDate;
  const period = r.dueOn
    ? { periodFrom: joinedOn, periodTo: r.dueOn }
    : firstPaymentPeriod(r.planMonths ?? 1, paymentDate);
  const dueOn = period.periodTo;
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ gymId: r.gymId, phone: r.phone, name: r.code, role: 'member', passwordHash: 'x' })
      .returning();
    await tx.insert(members).values({ userId: user!.id, gymId: r.gymId, code: r.code, planId: r.planId, joinedOn, dueOn, ...r.member });
    const [payment] = await tx
      .insert(payments)
      .values({
        gymId: r.gymId, memberId: user!.id, amountPkr: r.amountPkr ?? 4000, method: 'cash',
        periodFrom: period.periodFrom, periodTo: period.periodTo, recordedBy: r.recordedBy,
      })
      .returning();
    return { memberId: user!.id, paymentId: payment!.id };
  });
}
