import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import {
  addDays,
  deriveMemberKey,
  entryDecision,
  heaviestSet,
  isValidFreezeDays,
  membershipStatus,
  pkToday,
  sessionVolume,
  type CheckinKey,
  type Exercise,
  type ExerciseHistory,
  type FreezeRequestSummary,
  type Membership,
  type PaymentProofSummary,
  type ProgressSummary,
  type ResolvedPlanItem,
  type SaveSessionsResponse,
  type SetEntry,
  type TodayPlan,
  type VisitLevel,
} from '@gym/shared';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Principal } from '../auth/auth.decorators';
import { pkDayStart } from '../common/db-errors';
import { isoDate, parse } from '../common/validation';
import { DB, type Database } from '../db/db.module';
import {
  checkins,
  exerciseSessions,
  exercises,
  freezeRequests,
  gyms,
  members,
  paymentProofs,
  planAssignments,
  trainerPlans,
  trainerSessions,
  users,
} from '../db/schema';
import { extensionFor, FileStore, MAX_IMAGE_BYTES, sniffImage } from '../files/file-store';
import { selectMembers } from '../members/member-view';
import { bestsByExercise } from '../training/bests';

export const NO_HISTORY_NOTE = 'No history yet for this exercise, so choose a weight you can lift with good form.';
export const IMAGE_TOO_LARGE = 'The screenshot must be 6 MB or smaller.';
export const NOT_AN_IMAGE = 'Upload an image (JPG, PNG, WebP or HEIC).';

/** §9 sets JSON: kg, reps, warmup, plates, blocks. */
const setEntry = z.object({
  kg: z.number({ error: 'Each set needs a weight.' }),
  reps: z.number({ error: 'Each set needs reps.' }),
  warmup: z.boolean({ error: 'Each set needs "warmup".' }),
  plates: z.array(z.number()).optional(),
  blocks: z.array(z.number()).optional(),
});
const sessionsBody = z.object({
  sessions: z
    .array(
      z.object({
        id: z.string().uuid('Each session needs an ID created on the phone.'),
        exerciseId: z.string().min(1),
        date: isoDate('Each session needs a date.'),
        sets: z.array(setEntry, { error: 'Each session needs its sets.' }),
        planId: z.string().uuid('Plan not found.').nullish(),
      }),
      { error: 'Send a list of sessions.' },
    ),
});
const freezeBody = z.object({
  days: z.number({ error: 'A freeze must be 3 to 15 days.' }),
  reason: z.enum(['travel', 'illness', 'other'], { error: 'Choose a reason: travel, illness or other.' }),
});

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

/** The member's own data (§4, §10 me/*). Members see only their own data (§11). */
@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  /** GET me/membership (§4.6 Profile). */
  async membership(user: Principal): Promise<Membership> {
    const today = pkToday();
    const m = await this.member(user);
    const [gym] = await this.db.select().from(gyms).where(eq(gyms.id, user.gymId));
    const [proof] = await this.db.select().from(paymentProofs)
      .where(and(eq(paymentProofs.gymId, user.gymId), eq(paymentProofs.memberId, user.id), eq(paymentProofs.status, 'pending')))
      .orderBy(desc(paymentProofs.createdAt)).limit(1);
    const [freeze] = await this.db.select().from(freezeRequests)
      .where(and(eq(freezeRequests.gymId, user.gymId), eq(freezeRequests.memberId, user.id), eq(freezeRequests.status, 'pending')))
      .orderBy(desc(freezeRequests.createdAt)).limit(1);
    return {
      memberId: m.memberId,
      code: m.code,
      name: m.name,
      phone: m.phone,
      goal: m.goal,
      planName: m.planName,
      planTiming: m.planTiming,
      feePkr: m.feePkr,
      planMonths: m.planMonths,
      dueOn: m.dueOn,
      frozenUntil: m.frozenUntil,
      status: membershipStatus(m.dueOn, m.frozenUntil, today),
      entryAllowed: entryDecision(m, today, gym!.graceDays).allowed,
      graceDays: gym!.graceDays,
      trainerName: m.trainerName,
      payTo: { label: gym!.payToLabel, number: gym!.payToNumber, title: gym!.payToTitle },
      pendingProof: proof ? { id: proof.id, status: proof.status, createdAt: proof.createdAt.toISOString() } : null,
      pendingFreeze: freeze
        ? { id: freeze.id, days: freeze.days, reason: freeze.reason, status: freeze.status, createdAt: freeze.createdAt.toISOString() }
        : null,
    };
  }

  /** GET me/checkin-key (§7): HMAC-SHA256(gym secret, "member:" + member ID). The gym secret stays here. */
  async checkinKey(user: Principal): Promise<CheckinKey> {
    const m = await this.member(user);
    const [gym] = await this.db.select({ secret: gyms.checkinSecret }).from(gyms).where(eq(gyms.id, user.gymId));
    return { gymId: user.gymId, memberCode: m.code, key: deriveMemberKey(gym!.secret, m.code) };
  }

  /** GET me/progress (§4.2). */
  async progress(user: Principal): Promise<ProgressSummary> {
    const today = pkToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthAgo = addDays(today, -30);
    const mine = await this.sessionsOf(user);
    const names = await this.exerciseNames(user.gymId);

    const bestNow = bestsByExercise(mine);
    const bestThen = new Map<string, number>();
    const running = new Map<string, number>();
    let newBests = 0;
    for (const s of mine) {
      const top = heaviestSet(s.sets);
      if (!top) continue;
      const prev = running.get(s.exerciseId) ?? 0;
      if (top.kg > prev) {
        if (s.date >= monthStart && prev > 0) newBests++;
        running.set(s.exerciseId, top.kg);
      }
      if (s.date < monthAgo) bestThen.set(s.exerciseId, Math.max(bestThen.get(s.exerciseId) ?? 0, top.kg));
    }

    // 84-day visit grid: 0 none, 1 visit, 2 long session (a workout logged that day).
    const start = addDays(today, -83);
    const visitRows = await this.db
      .select({ day: sql<string>`to_char(${checkins.createdAt} at time zone 'Asia/Karachi', 'YYYY-MM-DD')` })
      .from(checkins)
      .where(and(eq(checkins.gymId, user.gymId), eq(checkins.memberId, user.id), eq(checkins.allowed, true), gte(checkins.createdAt, pkDayStart(start))));
    const visitDays = new Set(visitRows.map((r) => r.day));
    const workoutDays = new Set(mine.map((s) => s.date));
    const visits: VisitLevel[] = Array.from({ length: 84 }, (_, i) => {
      const d = addDays(start, i);
      return workoutDays.has(d) ? 2 : visitDays.has(d) ? 1 : 0;
    });
    const [anyCheckin] = await this.db.select({ id: checkins.id }).from(checkins)
      .where(and(eq(checkins.gymId, user.gymId), eq(checkins.memberId, user.id), eq(checkins.allowed, true))).limit(1);
    const [metTrainer] = await this.db.select({ id: trainerSessions.id }).from(trainerSessions)
      .where(and(eq(trainerSessions.gymId, user.gymId), eq(trainerSessions.memberId, user.id), eq(trainerSessions.done, true))).limit(1);

    const monthSessions = mine.filter((s) => s.date >= monthStart);
    const plan = await this.planFor(user, today);

    return {
      isNew: mine.length === 0,
      todayPlan: plan ? { planId: plan.id, planName: plan.name, coachName: firstName(plan.trainerName), exerciseCount: plan.items.length } : null,
      bests: [...bestNow.entries()].map(([exerciseId, b]) => ({
        exerciseId,
        exerciseName: names.get(exerciseId) ?? exerciseId,
        kg: b.kg,
        reps: b.reps,
        deltaKgMonth: bestThen.has(exerciseId) ? b.kg - bestThen.get(exerciseId)! : 0,
      })),
      visits,
      month: {
        workouts: new Set(monthSessions.map((s) => s.date)).size,
        newBests,
        tonnes: Math.round(monthSessions.reduce((sum, s) => sum + sessionVolume(s.sets), 0) / 100) / 10,
      },
      checklist: { firstCheckin: Boolean(anyCheckin), firstWorkout: mine.length > 0, metTrainer: Boolean(metTrainer) },
    };
  }

  /** GET me/history/:exerciseId (§4.5). */
  async history(user: Principal, exerciseId: string): Promise<ExerciseHistory> {
    const [ex] = await this.db.select().from(exercises)
      .where(and(eq(exercises.id, exerciseId), or(isNull(exercises.gymId), eq(exercises.gymId, user.gymId))));
    if (!ex) throw new NotFoundException('Exercise not found.');
    const list = (await this.sessionsOf(user)).filter((s) => s.exerciseId === exerciseId);

    let heaviest: ExerciseHistory['heaviest'] = null;
    let bestVolume: ExerciseHistory['bestVolume'] = null;
    for (const s of list) {
      const top = heaviestSet(s.sets);
      if (top && (!heaviest || top.kg > heaviest.kg)) heaviest = { kg: top.kg, reps: top.reps, date: s.date };
      const vol = sessionVolume(s.sets);
      if (!bestVolume || vol > bestVolume.kg) bestVolume = { kg: vol, date: s.date };
    }
    const best = bestsByExercise(list).get(exerciseId);
    return {
      exercise: toExercise(ex),
      heaviest,
      estimatedMax: best?.estimatedMax || null,
      bestVolume,
      topSets: list.slice(-8).map((s) => {
        const top = heaviestSet(s.sets);
        return { date: s.date, kg: top?.kg ?? 0, reps: top?.reps ?? 0 };
      }),
      sessions: [...list].reverse().map((s) => ({ id: s.id, date: s.date, sets: s.sets })),
    };
  }

  /**
   * GET me/plan/today (§4.4): the plan the member's trainer assigned for today.
   * "% of best" uses the kg computed for this member when the plan was sent; with
   * no history it becomes "member chooses" with a note (§7).
   */
  async todayPlan(user: Principal): Promise<TodayPlan | null> {
    const today = pkToday();
    const plan = await this.planFor(user, today);
    if (!plan) return null;
    const ids = [...new Set(plan.items.map((i) => i.exerciseId))];
    const exRows = await this.db.select().from(exercises).where(inArray(exercises.id, ids));
    const byId = new Map(exRows.map((e) => [e.id, e]));
    const done = await this.db
      .selectDistinct({ exerciseId: exerciseSessions.exerciseId })
      .from(exerciseSessions)
      .where(and(eq(exerciseSessions.gymId, user.gymId), eq(exerciseSessions.memberId, user.id), eq(exerciseSessions.planId, plan.id)));

    const items: ResolvedPlanItem[] = plan.items.map((item) => {
      const ex = byId.get(item.exerciseId);
      let resolved = { ...item };
      let resolvedNote: string | null = null;
      if (item.weightMode === 'pct') {
        const kg = plan.overrides?.[item.exerciseId];
        if (kg) resolved = { ...item, kg };
        else {
          resolved = { ...item, weightMode: 'choose', kg: null };
          resolvedNote = NO_HISTORY_NOTE;
        }
      }
      return { ...resolved, exerciseName: ex?.name ?? item.exerciseId, equipment: ex?.equipment ?? 'body', resolvedNote };
    });
    return {
      planId: plan.id, planName: plan.name, coachName: firstName(plan.trainerName), date: plan.date, items,
      doneExerciseIds: done.map((d) => d.exerciseId),
    };
  }

  /**
   * POST me/sessions {sessions} (§7 Workouts): each finished exercise with an ID
   * the phone created; IDs already stored are ignored, so offline retries never
   * create duplicates.
   */
  async saveSessions(user: Principal, body: unknown): Promise<SaveSessionsResponse> {
    const { sessions } = parse(sessionsBody, body);
    if (!sessions.length) return { saved: 0, duplicates: 0 };

    const exerciseIds = [...new Set(sessions.map((s) => s.exerciseId))];
    const visible = await this.db.select({ id: exercises.id }).from(exercises)
      .where(and(inArray(exercises.id, exerciseIds), or(isNull(exercises.gymId), eq(exercises.gymId, user.gymId))));
    const visibleIds = new Set(visible.map((e) => e.id));
    const unknown = exerciseIds.find((id) => !visibleIds.has(id));
    if (unknown) throw new BadRequestException(`Unknown exercise: ${unknown}.`);

    const planIds = [...new Set(sessions.map((s) => s.planId).filter((p): p is string => Boolean(p)))];
    if (planIds.length) {
      const found = await this.db.select({ id: trainerPlans.id }).from(trainerPlans)
        .where(and(eq(trainerPlans.gymId, user.gymId), inArray(trainerPlans.id, planIds)));
      if (found.length !== planIds.length) throw new BadRequestException('Plan not found.');
    }

    const inserted = await this.db
      .insert(exerciseSessions)
      .values(sessions.map((s) => ({
        id: s.id, gymId: user.gymId, memberId: user.id, exerciseId: s.exerciseId, date: s.date,
        sets: s.sets as SetEntry[], planId: s.planId ?? null,
      })))
      .onConflictDoNothing({ target: exerciseSessions.id })
      .returning({ id: exerciseSessions.id });
    return { saved: inserted.length, duplicates: sessions.length - inserted.length };
  }

  /** POST me/payment-proofs (multipart "file"): images only, 6 MB limit (§8). Shows "Waiting for reception". */
  async uploadProof(user: Principal, file: UploadedFile | undefined): Promise<PaymentProofSummary> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a screenshot to upload.');
    if (file.size > MAX_IMAGE_BYTES) throw new PayloadTooLargeException(IMAGE_TOO_LARGE);
    const type = sniffImage(file.buffer);
    if (!type) throw new BadRequestException(NOT_AN_IMAGE);
    await this.member(user);

    const key = `proofs/${user.gymId}/${randomUUID()}.${extensionFor(type)}`;
    await this.files.save(key, file.buffer);
    const [row] = await this.db.insert(paymentProofs).values({ gymId: user.gymId, memberId: user.id, imageUrl: key }).returning();
    return { id: row!.id, status: row!.status, createdAt: row!.createdAt.toISOString() };
  }

  /** POST me/freeze {days, reason} (§4.6, §7): 3 to 15 days with a reason; reception or owner approves. */
  async requestFreeze(user: Principal, body: unknown): Promise<FreezeRequestSummary> {
    const { days, reason } = parse(freezeBody, body);
    if (!isValidFreezeDays(days)) throw new BadRequestException('A freeze must be 3 to 15 days.');
    await this.member(user);
    const [row] = await this.db.insert(freezeRequests).values({ gymId: user.gymId, memberId: user.id, days, reason }).returning();
    return { id: row!.id, days: row!.days, reason: row!.reason, status: row!.status, createdAt: row!.createdAt.toISOString() };
  }

  // ---------- Helpers ----------

  private async member(user: Principal) {
    const [m] = await selectMembers(this.db, user.gymId, eq(members.userId, user.id));
    if (!m) throw new UnauthorizedException('Please log in again.');
    return m;
  }

  private async sessionsOf(user: Principal) {
    return this.db
      .select({ id: exerciseSessions.id, exerciseId: exerciseSessions.exerciseId, date: exerciseSessions.date, sets: exerciseSessions.sets })
      .from(exerciseSessions)
      .where(and(eq(exerciseSessions.gymId, user.gymId), eq(exerciseSessions.memberId, user.id)))
      .orderBy(asc(exerciseSessions.date), asc(exerciseSessions.createdAt));
  }

  private async exerciseNames(gymId: string) {
    const rows = await this.db.select({ id: exercises.id, name: exercises.name }).from(exercises)
      .where(or(isNull(exercises.gymId), eq(exercises.gymId, gymId)));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** The latest plan for `date` assigned to this member. */
  private async planFor(user: Principal, date: string) {
    const [row] = await this.db
      .select({ plan: trainerPlans, overrides: planAssignments.overrides, trainerName: users.name })
      .from(planAssignments)
      .innerJoin(trainerPlans, and(eq(trainerPlans.gymId, planAssignments.gymId), eq(trainerPlans.id, planAssignments.planId)))
      .innerJoin(users, and(eq(users.gymId, trainerPlans.gymId), eq(users.id, trainerPlans.trainerId)))
      .where(and(eq(planAssignments.gymId, user.gymId), eq(planAssignments.memberId, user.id), eq(trainerPlans.date, date)))
      .orderBy(desc(trainerPlans.createdAt))
      .limit(1);
    return row ? { ...row.plan, overrides: row.overrides, trainerName: row.trainerName } : null;
  }
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function toExercise(e: typeof exercises.$inferSelect): Exercise {
  return { id: e.id, gymId: e.gymId, name: e.name, equipment: e.equipment, muscle: e.muscle };
}
