import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  applyFreeze,
  pkToday,
  type FreezeRequestItem,
  type PaymentProofItem,
  type RecordPaymentResponse,
  type RequestStatus,
} from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Principal } from '../auth/auth.decorators';
import { signPath } from '../common/signed-url';
import { parse, uuidParam } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { freezeRequests, members, paymentProofs, plans, users } from '../db/schema';
import { amountPkr, paymentMethod, renewMembership } from '../payments/payments.service';

export const ALREADY_HANDLED = 'This request was already handled.';
export const PROOF_NOT_FOUND = 'Screenshot not found.';
export const FREEZE_NOT_FOUND = 'Freeze request not found.';

const statusQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all'], { error: 'Unknown status filter.' }).optional(),
});
const approveProofBody = z.object({ amountPkr, method: paymentMethod });

export const proofImagePath = (id: string) => `/v1/files/proofs/${id}`;

/** §6 Fees and payments: approvals first. Reception or owner. */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** GET payment-proofs?status (default pending). Images are short-lived signed links (§11). */
  async listProofs(staff: Principal, query: unknown): Promise<PaymentProofItem[]> {
    const { status = 'pending' } = parse(statusQuery, query);
    const rows = await this.db
      .select({ p: paymentProofs, code: members.code, name: users.name, feePkr: plans.feePkr })
      .from(paymentProofs)
      .innerJoin(members, and(eq(members.gymId, paymentProofs.gymId), eq(members.userId, paymentProofs.memberId)))
      .innerJoin(users, and(eq(users.gymId, paymentProofs.gymId), eq(users.id, paymentProofs.memberId)))
      .innerJoin(plans, and(eq(plans.gymId, members.gymId), eq(plans.id, members.planId)))
      .where(and(eq(paymentProofs.gymId, staff.gymId), status === 'all' ? undefined : eq(paymentProofs.status, status)))
      .orderBy(desc(paymentProofs.createdAt));
    return rows.map(({ p, code, name, feePkr }) => ({
      id: p.id, memberId: p.memberId, memberCode: code, memberName: name, status: p.status, feePkr,
      imageUrl: signPath(this.env.JWT_SECRET, proofImagePath(p.id)), createdAt: p.createdAt.toISOString(),
    }));
  }

  /**
   * POST payment-proofs/:id/approve {amountPkr, method} (§7): records a payment
   * with the amount and method reception confirms (renews the membership,
   * clears any freeze, queues the receipt) and links it to the screenshot.
   */
  async approveProof(staff: Principal, id: string, body: unknown): Promise<RecordPaymentResponse> {
    const input = parse(approveProofBody, body);
    return this.db.transaction(async (tx) => {
      const proof = await this.lockPending(tx, paymentProofs, staff.gymId, id, PROOF_NOT_FOUND);
      const result = await renewMembership(tx, staff.gymId, staff.id, eq(members.userId, proof.memberId), {
        amountPkr: input.amountPkr, method: input.method, txnId: null, proofId: proof.id,
      });
      await tx.update(paymentProofs).set({ status: 'approved' }).where(eq(paymentProofs.id, proof.id));
      return result;
    });
  }

  /** POST payment-proofs/:id/reject — "rejecting changes nothing else" (§7). */
  async rejectProof(staff: Principal, id: string): Promise<{ id: string; status: RequestStatus }> {
    return this.db.transaction(async (tx) => {
      const proof = await this.lockPending(tx, paymentProofs, staff.gymId, id, PROOF_NOT_FOUND);
      await tx.update(paymentProofs).set({ status: 'rejected' }).where(eq(paymentProofs.id, proof.id));
      return { id: proof.id, status: 'rejected' as const };
    });
  }

  /** GET freeze-requests?status (default pending), with old and new due date (§6). */
  async listFreezes(staff: Principal, query: unknown): Promise<FreezeRequestItem[]> {
    const { status = 'pending' } = parse(statusQuery, query);
    const today = pkToday();
    const rows = await this.db
      .select({ f: freezeRequests, code: members.code, name: users.name, dueOn: members.dueOn })
      .from(freezeRequests)
      .innerJoin(members, and(eq(members.gymId, freezeRequests.gymId), eq(members.userId, freezeRequests.memberId)))
      .innerJoin(users, and(eq(users.gymId, freezeRequests.gymId), eq(users.id, freezeRequests.memberId)))
      .where(and(eq(freezeRequests.gymId, staff.gymId), status === 'all' ? undefined : eq(freezeRequests.status, status)))
      .orderBy(desc(freezeRequests.createdAt));
    return rows.map(({ f, code, name, dueOn }) => toFreezeItem(f, code, name, dueOn, today));
  }

  /**
   * POST freeze-requests/:id/approve (§7 Freeze): the due date moves later by the
   * days frozen, and entry is blocked until the freeze ends (starting today).
   */
  async approveFreeze(staff: Principal, id: string): Promise<FreezeRequestItem> {
    const today = pkToday();
    return this.db.transaction(async (tx) => {
      const f = await this.lockPending(tx, freezeRequests, staff.gymId, id, FREEZE_NOT_FOUND);
      const [m] = await tx.select({ dueOn: members.dueOn, code: members.code, name: users.name })
        .from(members)
        .innerJoin(users, and(eq(users.gymId, members.gymId), eq(users.id, members.userId)))
        .where(and(eq(members.gymId, staff.gymId), eq(members.userId, f.memberId)))
        .for('update', { of: members });
      const next = applyFreeze(m!.dueOn, f.days, today);
      await tx.update(members).set({ dueOn: next.dueOn, frozenUntil: next.frozenUntil, updatedAt: new Date() })
        .where(and(eq(members.gymId, staff.gymId), eq(members.userId, f.memberId)));
      const [updated] = await tx.update(freezeRequests).set({ status: 'approved' }).where(eq(freezeRequests.id, f.id)).returning();
      return { ...toFreezeItem(updated!, m!.code, m!.name, next.dueOn, today), newDueOn: next.dueOn };
    });
  }

  /** POST freeze-requests/:id/reject */
  async rejectFreeze(staff: Principal, id: string): Promise<FreezeRequestItem> {
    const today = pkToday();
    return this.db.transaction(async (tx) => {
      const f = await this.lockPending(tx, freezeRequests, staff.gymId, id, FREEZE_NOT_FOUND);
      const [updated] = await tx.update(freezeRequests).set({ status: 'rejected' }).where(eq(freezeRequests.id, f.id)).returning();
      const [m] = await tx.select({ dueOn: members.dueOn, code: members.code, name: users.name })
        .from(members)
        .innerJoin(users, and(eq(users.gymId, members.gymId), eq(users.id, members.userId)))
        .where(and(eq(members.gymId, staff.gymId), eq(members.userId, f.memberId)));
      return toFreezeItem(updated!, m!.code, m!.name, m!.dueOn, today);
    });
  }

  /** Locks a request of this gym; 404 if missing, 409 if it is no longer pending. */
  private async lockPending<T extends typeof paymentProofs | typeof freezeRequests>(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    table: T,
    gymId: string,
    id: string,
    missing: string,
  ): Promise<T['$inferSelect']> {
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(missing);
    const [row] = (await tx.select().from(table as typeof paymentProofs)
      .where(and(eq(table.gymId, gymId), eq(table.id, id)))
      .for('update')) as T['$inferSelect'][];
    if (!row) throw new NotFoundException(missing);
    if (row.status !== 'pending') throw new ConflictException(ALREADY_HANDLED);
    return row;
  }
}

/** `dueOn` is null for a member with no payment yet: there is no due date to move (§7 Freeze). */
function toFreezeItem(f: typeof freezeRequests.$inferSelect, code: string, name: string, dueOn: string | null, today: string): FreezeRequestItem {
  return {
    id: f.id, memberId: f.memberId, memberCode: code, memberName: name, days: f.days, reason: f.reason, status: f.status,
    createdAt: f.createdAt.toISOString(), dueOn, newDueOn: applyFreeze(dueOn, f.days, today).dueOn,
  };
}
