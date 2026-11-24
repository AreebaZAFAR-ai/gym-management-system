import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  estimatedOneRepMax,
  kgFromPct,
  membershipStatus,
  PLAN_LIMITS,
  pkToday,
  type ClientBest,
  type CreatePlanResponse,
  type PlanItem,
  type TrainerClient,
  type TrainerPlan,
  type TrainerSession,
} from '@gym/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { pkDayStart } from '../common/db-errors';
import { isoDate, optionalText, parse, uuidParam } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import { exerciseSessions, exercises, members, planAssignments, trainerPlans, trainerSessions, users } from '../db/schema';
import { bestsByExercise } from '../training/bests';

export const SESSION_NOT_FOUND = 'Session not found.';
export const PLAN_NOT_FOUND = 'Plan not found.';
export const NOT_YOUR_CLIENT = 'This is not your client.';
export const OWN_SESSIONS_ONLY = 'Trainers can only create their own sessions.';

const createSessionBody = z.object({
  trainerId: z.string().uuid('Trainer not found.').nullish(),
  memberId: z.string().uuid('Member not found.').nullish(),
  startsAt: z.iso.datetime({ offset: true, error: 'Enter the start time.' }),
  title: z.string({ error: 'Enter a title.' }).trim().min(1, 'Enter a title.'),
  meta: optionalText,
  kind: z.enum(['pt', 'class'], { error: 'Choose personal training or class.' }),
});

const doneBody = z.object({ done: z.boolean({ error: '"done" must be true or false.' }) });

const { sets, reps, pct, restSec, exercises: exLimit, clients } = PLAN_LIMITS;
const intRange = (r: { min: number; max: number }, message: string) =>
  z.number({ error: message }).int(message).min(r.min, message).max(r.max, message);
/** §9 plan item shape: sets 1–10, reps 1–50, weightMode, kg, pct 30–100, warmups, restSec 0–600, note, canChange. */
const planItem = z
  .object({
    exerciseId: z.string({ error: 'Each exercise needs an ID.' }).min(1, 'Each exercise needs an ID.'),
    sets: intRange(sets, `Sets must be ${sets.min} to ${sets.max}.`),
    reps: intRange(reps, `Reps must be ${reps.min} to ${reps.max}.`),
    weightMode: z.enum(['fixed', 'pct', 'choose', 'body'], { error: 'Choose a weight rule.' }),
    kg: z.number({ error: 'Weight must be a number.' }).nullable(),
    pct: intRange(pct, `% of best must be ${pct.min} to ${pct.max}.`).nullable(),
    warmups: z.boolean({ error: '"warmups" must be true or false.' }),
    restSec: intRange(restSec, `Rest must be ${restSec.min} to ${restSec.max} seconds.`),
    note: optionalText,
    canChange: z.boolean({ error: '"canChange" must be true or false.' }),
  })
  .refine((i) => i.weightMode !== 'fixed' || i.kg !== null, 'Set the weight, or choose another weight rule.')
  .refine((i) => i.weightMode !== 'pct' || i.pct !== null, 'Set the % of best, or choose another weight rule.');

const createPlanBody = z.object({
  name: z.string({ error: 'Give the plan a name.' }).trim().min(1, 'Give the plan a name.'),
  date: isoDate('Choose the plan date.'),
  items: z.array(planItem, { error: 'Add exercises to the plan.' })
    .min(exLimit.min, 'A plan needs 1 to 15 exercises.').max(exLimit.max, 'A plan needs 1 to 15 exercises.'),
  memberIds: z.array(z.string().uuid('Client not found.'), { error: 'Pick the clients.' })
    .min(clients.min, 'Send the plan to 1 to 100 clients.').max(clients.max, 'Send the plan to 1 to 100 clients.'),
});

/**
 * Trainer routes (§5.2, §6 Training plans, §7 Trainer plans, §10).
 * §7: "A trainer sees only their own clients and plans; the owner sees all."
 * §11 privacy: trainers see only name, ID, status, goal and workouts of their own clients.
 * Sessions: trainers create their own; the owner may assign one to a selected trainer.
 */
@Injectable()
export class TrainerService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ---------- Sessions ----------

  /** GET trainer/today — today in Pakistan time. Trainer: their own; owner: the whole gym. */
  async today(user: Principal): Promise<TrainerSession[]> {
    const today = pkToday();
    const where: SQL[] = [
      eq(trainerSessions.gymId, user.gymId),
      gte(trainerSessions.startsAt, pkDayStart(today)),
      lt(trainerSessions.startsAt, pkDayStart(addDays(today, 1))),
    ];
    if (user.role !== 'owner') where.push(eq(trainerSessions.trainerId, user.id));
    return this.sessions(and(...where)!);
  }

  /** POST trainer/sessions */
  async createSession(user: Principal, body: unknown): Promise<TrainerSession> {
    const input = parse(createSessionBody, body);

    let trainerId = user.id;
    if (user.role === 'owner') {
      if (input.trainerId && input.trainerId !== user.id) {
        const [t] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.gymId, user.gymId), eq(users.id, input.trainerId), eq(users.role, 'trainer')));
        if (!t) throw new BadRequestException('Trainer not found.');
        trainerId = t.id;
      }
    } else if (input.trainerId && input.trainerId !== user.id) {
      throw new ForbiddenException(OWN_SESSIONS_ONLY);
    }

    if (input.memberId) await this.assertClient(user, input.memberId, 'Member not found.');

    const [row] = await this.db
      .insert(trainerSessions)
      .values({
        gymId: user.gymId, trainerId, memberId: input.memberId ?? null, startsAt: new Date(input.startsAt),
        title: input.title, meta: input.meta, kind: input.kind,
      })
      .returning({ id: trainerSessions.id });
    return (await this.sessions(eq(trainerSessions.id, row!.id)))[0]!;
  }

  /** PATCH trainer/sessions/:id {done} — a trainer only their own sessions; the owner any in the gym. */
  async setDone(user: Principal, id: string, body: unknown): Promise<TrainerSession> {
    const { done } = parse(doneBody, body);
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(SESSION_NOT_FOUND);
    const where: SQL[] = [eq(trainerSessions.gymId, user.gymId), eq(trainerSessions.id, id)];
    if (user.role !== 'owner') where.push(eq(trainerSessions.trainerId, user.id));
    const [row] = await this.db
      .update(trainerSessions)
      .set({ done, updatedAt: new Date() })
      .where(and(...where))
      .returning({ id: trainerSessions.id });
    if (!row) throw new NotFoundException(SESSION_NOT_FOUND);
    return (await this.sessions(eq(trainerSessions.id, row.id)))[0]!;
  }

  private async sessions(where: SQL): Promise<TrainerSession[]> {
    const rows = await this.db
      .select({ s: trainerSessions, trainerName: users.name })
      .from(trainerSessions)
      .innerJoin(users, and(eq(users.gymId, trainerSessions.gymId), eq(users.id, trainerSessions.trainerId)))
      .where(where)
      .orderBy(asc(trainerSessions.startsAt));
    return rows.map(({ s, trainerName }) => ({
      id: s.id,
      trainerId: s.trainerId,
      trainerName,
      memberId: s.memberId,
      startsAt: s.startsAt.toISOString(),
      title: s.title,
      meta: s.meta,
      kind: s.kind,
      done: s.done,
    }));
  }

  // ---------- Clients ----------

  /** GET trainer/clients — only name, ID, status and goal (§11 privacy). */
  async clients(user: Principal): Promise<TrainerClient[]> {
    const today = pkToday();
    const rows = await this.db
      .select({ memberId: members.userId, code: members.code, name: users.name, dueOn: members.dueOn, frozenUntil: members.frozenUntil, goal: members.goal })
      .from(members)
      .innerJoin(users, and(eq(users.gymId, members.gymId), eq(users.id, members.userId)))
      .where(and(eq(members.gymId, user.gymId), user.role === 'owner' ? undefined : eq(members.trainerId, user.id)))
      .orderBy(asc(users.name));
    return rows.map((r) => ({
      memberId: r.memberId, code: r.code, name: r.name, goal: r.goal,
      status: membershipStatus(r.dueOn, r.frozenUntil, today),
    }));
  }

  /** GET trainer/clients/:id/bests */
  async clientBests(user: Principal, memberId: string): Promise<ClientBest[]> {
    if (!uuidParam.safeParse(memberId).success) throw new NotFoundException('Member not found.');
    await this.assertClient(user, memberId, 'Member not found.', NotFoundException);
    const bests = await this.bestsFor(user.gymId, memberId);
    return [...bests.entries()].map(([exerciseId, b]) => ({
      exerciseId, kg: b.kg, reps: b.reps, estimatedMax: b.estimatedMax || estimatedOneRepMax(b.kg, b.reps),
    }));
  }

  // ---------- Plans ----------

  /** GET trainer/plans — plans of the last 14 days and later (§6 "Recent plans (last 14 days)"). */
  async plans(user: Principal): Promise<TrainerPlan[]> {
    const where: SQL[] = [eq(trainerPlans.gymId, user.gymId), gte(trainerPlans.date, addDays(pkToday(), -14))];
    if (user.role !== 'owner') where.push(eq(trainerPlans.trainerId, user.id));
    const rows = await this.db.select().from(trainerPlans).where(and(...where)).orderBy(desc(trainerPlans.date), desc(trainerPlans.createdAt));
    if (!rows.length) return [];
    const assigned = await this.db
      .select({ planId: planAssignments.planId, memberId: planAssignments.memberId })
      .from(planAssignments)
      .where(and(eq(planAssignments.gymId, user.gymId), inArray(planAssignments.planId, rows.map((r) => r.id))));
    return rows.map((p) => toPlan(p, assigned.filter((a) => a.planId === p.id).map((a) => a.memberId)));
  }

  /**
   * POST trainer/plans (§7): a date today or later, a name, 1 to 15 exercises,
   * 1 to 100 clients of the same gym (a trainer's own clients). "% of best" becomes
   * kg per member from that member's estimated max, rounded to 2.5 kg, stored as
   * the assignment's overrides; with no history it becomes "member chooses" when read.
   */
  async createPlan(user: Principal, body: unknown): Promise<CreatePlanResponse> {
    const input = parse(createPlanBody, body);
    if (input.date < pkToday()) throw new BadRequestException('Plans cannot be written for past days.');
    const memberIds = [...new Set(input.memberIds)];

    const exerciseIds = [...new Set(input.items.map((i) => i.exerciseId))];
    const known = await this.db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(inArray(exercises.id, exerciseIds), or(isNull(exercises.gymId), eq(exercises.gymId, user.gymId))));
    if (known.length !== exerciseIds.length) throw new BadRequestException('One of the exercises is not available in this gym.');

    const clientsRows = await this.db
      .select({ memberId: members.userId, trainerId: members.trainerId })
      .from(members)
      .where(and(eq(members.gymId, user.gymId), inArray(members.userId, memberIds)));
    if (clientsRows.length !== memberIds.length) throw new BadRequestException('Client not found.');
    if (user.role !== 'owner' && clientsRows.some((c) => c.trainerId !== user.id)) {
      throw new ForbiddenException('You can only send plans to your own clients.');
    }

    const items: PlanItem[] = input.items;
    const pctItems = items.filter((i) => i.weightMode === 'pct');

    // Per-member kg for "% of best", computed before the transaction opens.
    const overridesByMember = new Map<string, Record<string, number> | null>();
    for (const memberId of memberIds) {
      let overrides: Record<string, number> | null = null;
      if (pctItems.length) {
        const bests = await this.bestsFor(user.gymId, memberId);
        for (const item of pctItems) {
          const best = bests.get(item.exerciseId);
          if (best?.estimatedMax && item.pct) (overrides ??= {})[item.exerciseId] = kgFromPct(best.estimatedMax, item.pct);
        }
      }
      overridesByMember.set(memberId, overrides);
    }

    return this.db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(trainerPlans)
        .values({ gymId: user.gymId, trainerId: user.id, name: input.name, date: input.date, items })
        .returning();
      await tx.insert(planAssignments).values(
        memberIds.map((memberId) => ({ planId: plan!.id, memberId, gymId: user.gymId, overrides: overridesByMember.get(memberId) ?? null })),
      );
      return { plan: toPlan(plan!, memberIds), sentTo: memberIds.length };
    });
  }

  /** DELETE trainer/plans/:id — removes the plan and its assignments; logged workouts are kept. */
  async deletePlan(user: Principal, id: string): Promise<void> {
    if (!uuidParam.safeParse(id).success) throw new NotFoundException(PLAN_NOT_FOUND);
    const where: SQL[] = [eq(trainerPlans.gymId, user.gymId), eq(trainerPlans.id, id)];
    if (user.role !== 'owner') where.push(eq(trainerPlans.trainerId, user.id));
    const deleted = await this.db.delete(trainerPlans).where(and(...where)).returning({ id: trainerPlans.id });
    if (!deleted.length) throw new NotFoundException(PLAN_NOT_FOUND);
  }

  // ---------- Helpers ----------

  /** The member must be in this gym and, for a trainer, one of their own clients (§7). */
  private async assertClient(
    user: Principal,
    memberId: string,
    missing: string,
    Missing: new (m: string) => Error = BadRequestException,
  ): Promise<void> {
    const [m] = await this.db
      .select({ trainerId: members.trainerId })
      .from(members)
      .where(and(eq(members.gymId, user.gymId), eq(members.userId, memberId)));
    if (!m) throw new Missing(missing);
    if (user.role !== 'owner' && m.trainerId !== user.id) throw new ForbiddenException(NOT_YOUR_CLIENT);
  }

  private async bestsFor(gymId: string, memberId: string) {
    const rows = await this.db
      .select({ exerciseId: exerciseSessions.exerciseId, date: exerciseSessions.date, sets: exerciseSessions.sets })
      .from(exerciseSessions)
      .where(and(eq(exerciseSessions.gymId, gymId), eq(exerciseSessions.memberId, memberId)));
    return bestsByExercise(rows);
  }
}

function toPlan(p: typeof trainerPlans.$inferSelect, memberIds: string[]): TrainerPlan {
  return { id: p.id, trainerId: p.trainerId, name: p.name, date: p.date, items: p.items, memberIds, createdAt: p.createdAt.toISOString() };
}
