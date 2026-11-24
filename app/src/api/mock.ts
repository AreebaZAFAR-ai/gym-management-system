/**
 * In-memory stand-in for the API so the app can be run and demoed before the
 * NestJS server exists (API_URL unset or "mock"). It applies the same business
 * rules from @gym/shared that the server will. Data resets when the app reloads.
 * Never used when API_URL points at a real server.
 */
import {
  addDays,
  bestEstimatedMax,
  defaultPassword,
  deriveMemberKey,
  entryDecision,
  estimatedOneRepMax,
  formatPKR,
  formatShortDate,
  heaviestSet,
  isCheckinQr,
  isValidFreezeDays,
  kgFromPct,
  membershipStatus,
  normalizePhone,
  PAYMENT_METHOD_LABELS,
  paymentPeriod,
  pkToday,
  sessionVolume,
  verifyCheckinQr,
  type Announcement,
  type AuthUser,
  type CheckinSource,
  type Exercise,
  type ExerciseHistory,
  type ExerciseSessionInput,
  type FreezeReason,
  type Goal,
  type Membership,
  type PlanItem,
  type ProgressSummary,
  type RequestStatus,
  type Role,
  type ScanMember,
  type SetEntry,
  type TodayPlan,
  type TrainerSession,
  type VisitLevel,
} from '@gym/shared';
import { BRAND } from '../config';
import type { GymApi } from './types';
import { ApiError } from './types';

const LATENCY_MS = 250;
const wait = () => new Promise((r) => setTimeout(r, LATENCY_MS));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---------------- Seed data ----------------

const today = pkToday();
const GYM = {
  id: BRAND.id,
  name: BRAND.name,
  short: BRAND.short,
  city: BRAND.city,
  primaryColor: BRAND.primaryColor,
  prefix: BRAND.short,
  payTo: BRAND.payTo,
  receptionWhatsapp: BRAND.receptionWhatsapp,
  graceDays: 3,
  secret: `demo-secret-${BRAND.id}`,
};

type MockUser = { id: string; phone: string; name: string; role: Role; password: string; active: boolean };
type MockMember = {
  userId: string;
  code: string;
  planId: string;
  trainerId: string | null;
  joinedOn: string;
  dueOn: string;
  frozenUntil: string | null;
  goal: Goal | null;
};
type MockSession = ExerciseSessionInput & { memberId: string };

const users: MockUser[] = [
  ['u-ali', '3001234567', 'Ali Raza', 'member'],
  ['u-sara', '3007654321', 'Sara Khan', 'member'],
  ['u-usman', '3111234567', 'Usman Tariq', 'member'],
  ['u-hina', '3121234567', 'Hina Malik', 'member'],
  ['u-ayesha', '3331234567', 'Ayesha Noor', 'reception'],
  ['u-bilal', '3441234567', 'Bilal Ahmed', 'trainer'],
  ['u-kamran', '3451234567', 'Kamran Iqbal', 'owner'],
].map(([id, phone, name, role]) => ({
  id,
  phone,
  name,
  role: role as Role,
  password: defaultPassword(phone),
  active: true,
}));

const plans = [
  { id: 'p-monthly', name: 'Monthly', timing: null, feePkr: 4000, months: 1 },
  { id: 'p-ladies', name: 'Monthly', timing: 'Ladies timings 11am–3pm', feePkr: 3500, months: 1 },
  { id: 'p-quarter', name: 'Quarterly', timing: null, feePkr: 11000, months: 3 },
];

const members: MockMember[] = [
  { userId: 'u-ali', code: 'IH-0412', planId: 'p-monthly', trainerId: 'u-bilal', joinedOn: addDays(today, -120), dueOn: addDays(today, 18), frozenUntil: null, goal: 'strength' },
  { userId: 'u-sara', code: 'IH-0418', planId: 'p-ladies', trainerId: 'u-bilal', joinedOn: addDays(today, -1), dueOn: addDays(today, 29), frozenUntil: null, goal: null },
  { userId: 'u-usman', code: 'IH-0399', planId: 'p-monthly', trainerId: 'u-bilal', joinedOn: addDays(today, -200), dueOn: addDays(today, -17), frozenUntil: null, goal: 'fat_loss' },
  { userId: 'u-hina', code: 'IH-0405', planId: 'p-ladies', trainerId: 'u-bilal', joinedOn: addDays(today, -60), dueOn: addDays(today, 3), frozenUntil: null, goal: 'muscle' },
];

const exercises: Exercise[] = (
  [
    ['squat', 'Back squat', 'bar', 'legs'],
    ['bench', 'Bench press', 'bar', 'chest'],
    ['deadlift', 'Deadlift', 'bar', 'back'],
    ['ohp', 'Overhead press', 'bar', 'shoulders'],
    ['row', 'Barbell row', 'bar', 'back'],
    ['incline-db', 'Incline dumbbell press', 'db', 'chest'],
    ['db-curl', 'Dumbbell curl', 'db', 'arms'],
    ['db-shoulder', 'Dumbbell shoulder press', 'db', 'shoulders'],
    ['lat-pulldown', 'Lat pulldown', 'machine', 'back'],
    ['leg-press', 'Leg press', 'machine', 'legs'],
    ['leg-curl', 'Leg curl', 'machine', 'legs'],
    ['chest-press', 'Chest press machine', 'machine', 'chest'],
    ['pushdown', 'Triceps pushdown', 'machine', 'arms'],
    ['pull-up', 'Pull-up', 'body', 'back'],
    ['push-up', 'Push-up', 'body', 'chest'],
    ['dip', 'Dip', 'body', 'arms'],
    ['crunch', 'Crunch', 'body', 'core'],
  ] as const
).map(([id, name, equipment, muscle]) => ({ id, gymId: null, name, equipment, muscle }));

const exerciseById = (id: string) => {
  const ex = exercises.find((e) => e.id === id);
  if (!ex) throw new ApiError('Exercise not found.', 404);
  return ex;
};

// Workout history for Ali (8 weeks) and Hina (4 weeks), two sessions a week.
const sessions: MockSession[] = [];
function seedHistory(memberId: string, weeks: number, lifts: [string, number, number][]) {
  for (let w = weeks; w >= 1; w--) {
    for (const dayOffset of [0, 3]) {
      const date = addDays(today, -(w * 7) + dayOffset);
      const progress = (weeks - w) * 2.5;
      for (const [exerciseId, startKg, reps] of lifts) {
        const kg = startKg + progress;
        const sets: SetEntry[] = [
          { kg: Math.round(kg * 0.5 / 2.5) * 2.5, reps: 8, warmup: true },
          { kg, reps, warmup: false },
          { kg, reps, warmup: false },
          { kg, reps: reps - 1, warmup: false },
        ];
        sessions.push({ id: uid(), memberId, exerciseId, date, sets });
      }
    }
  }
}
seedHistory('u-ali', 8, [
  ['squat', 80, 5],
  ['bench', 60, 5],
  ['deadlift', 100, 5],
]);
seedHistory('u-hina', 4, [
  ['squat', 40, 8],
  ['lat-pulldown', 30, 10],
]);

const checkins: {
  id: string;
  memberId: string;
  allowed: boolean;
  reason: string | null;
  source: CheckinSource;
  scannedBy: string;
  createdAt: string;
  date: string;
}[] = [];
for (const s of sessions) {
  if (!checkins.some((c) => c.memberId === s.memberId && c.date === s.date)) {
    checkins.push({ id: uid(), memberId: s.memberId, allowed: true, reason: null, source: 'qr', scannedBy: 'u-ayesha', createdAt: `${s.date}T13:00:00.000Z`, date: s.date });
  }
}

const proofs: { id: string; memberId: string; status: RequestStatus; createdAt: string }[] = [];
const freezes: { id: string; memberId: string; days: number; reason: FreezeReason; status: RequestStatus; createdAt: string }[] = [];
const payments: { id: string; memberId: string; amountPkr: number; createdAt: string }[] = [];

const announcements: Announcement[] = [
  { id: 'a1', title: 'Gym closed on Friday 12–2', body: 'The gym will be closed for Jummah prayers from 12 to 2 pm on Fridays.', createdAt: new Date(Date.now() - 2 * 864e5).toISOString() },
  { id: 'a2', title: 'New squat racks', body: 'Two new squat racks are now on the main floor. Please re-rack your plates.', createdAt: new Date(Date.now() - 6 * 864e5).toISOString() },
];

const trainerPlans: { id: string; trainerId: string; name: string; date: string; items: PlanItem[]; memberIds: string[]; createdAt: string }[] = [
  {
    id: 'tp-seed',
    trainerId: 'u-bilal',
    name: 'Push day A',
    date: today,
    memberIds: ['u-ali'],
    createdAt: new Date().toISOString(),
    items: [
      { exerciseId: 'bench', sets: 4, reps: 6, weightMode: 'pct', kg: null, pct: 75, warmups: true, restSec: 120, note: 'Pause one second on the chest.', canChange: false },
      { exerciseId: 'ohp', sets: 3, reps: 8, weightMode: 'fixed', kg: 40, pct: null, warmups: true, restSec: 90, note: null, canChange: true },
      { exerciseId: 'incline-db', sets: 3, reps: 10, weightMode: 'choose', kg: null, pct: null, warmups: false, restSec: 90, note: 'Pick a weight you can do for 10 clean reps.', canChange: true },
      { exerciseId: 'dip', sets: 3, reps: 10, weightMode: 'body', kg: null, pct: null, warmups: false, restSec: 60, note: null, canChange: true },
    ],
  },
];

const nowIso = () => new Date().toISOString();
const atPk = (hhmm: string) => new Date(`${today}T${hhmm}:00+05:00`).toISOString();
const trainerSessions: TrainerSession[] = [
  { id: 'ts1', trainerId: 'u-bilal', trainerName: 'Bilal Ahmed', memberId: 'u-ali', startsAt: atPk('07:00'), title: 'Ali Raza', meta: 'Push · session 6 of 12', kind: 'pt', done: false },
  { id: 'ts2', trainerId: 'u-bilal', trainerName: 'Bilal Ahmed', memberId: 'u-hina', startsAt: atPk('11:30'), title: 'Hina Malik', meta: 'Legs · session 4 of 12', kind: 'pt', done: false },
  { id: 'ts3', trainerId: 'u-bilal', trainerName: 'Bilal Ahmed', memberId: null, startsAt: atPk('18:00'), title: 'Evening circuit', meta: 'Group class · 12 booked', kind: 'class', done: false },
];

// ---------------- Helpers ----------------

function memberOf(userId: string) {
  const m = members.find((x) => x.userId === userId);
  if (!m) throw new ApiError('Member not found.', 404);
  return m;
}
const userOf = (id: string) => users.find((u) => u.id === id)!;
const planOf = (id: string) => plans.find((p) => p.id === id)!;

function toScanMember(m: MockMember): ScanMember {
  const u = userOf(m.userId);
  const p = planOf(m.planId);
  return {
    memberId: m.userId,
    code: m.code,
    name: u.name,
    phone: u.phone,
    planName: p.timing ? `${p.name} · ${p.timing}` : p.name,
    planId: p.id,
    feePkr: p.feePkr,
    dueOn: m.dueOn,
    frozenUntil: m.frozenUntil,
    status: membershipStatus(m.dueOn, m.frozenUntil, pkToday()),
  };
}

function memberSessions(memberId: string, exerciseId?: string) {
  return sessions
    .filter((s) => s.memberId === memberId && (!exerciseId || s.exerciseId === exerciseId))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function bestsFor(memberId: string) {
  const byEx = new Map<string, { kg: number; reps: number; e1rm: number }>();
  for (const s of memberSessions(memberId)) {
    const top = heaviestSet(s.sets);
    if (!top) continue;
    const prev = byEx.get(s.exerciseId);
    const e1rm = Math.max(prev?.e1rm ?? 0, bestEstimatedMax(s.sets));
    if (!prev || top.kg > prev.kg || (top.kg === prev.kg && top.reps > prev.reps)) {
      byEx.set(s.exerciseId, { kg: top.kg, reps: top.reps, e1rm });
    } else byEx.set(s.exerciseId, { ...prev, e1rm });
  }
  return byEx;
}

function resolvePlan(planId: string, memberId: string): TodayPlan {
  const plan = trainerPlans.find((p) => p.id === planId)!;
  const bests = bestsFor(memberId);
  const done = new Set(
    sessions.filter((s) => s.memberId === memberId && s.planId === plan.id).map((s) => s.exerciseId),
  );
  return {
    planId: plan.id,
    planName: plan.name,
    coachName: userOf(plan.trainerId).name.split(' ')[0],
    date: plan.date,
    doneExerciseIds: [...done],
    items: plan.items.map((item) => {
      const ex = exerciseById(item.exerciseId);
      let resolved = { ...item };
      let resolvedNote: string | null = null;
      if (item.weightMode === 'pct') {
        const best = bests.get(item.exerciseId);
        if (best && item.pct) resolved = { ...item, kg: kgFromPct(best.e1rm, item.pct) };
        else {
          resolved = { ...item, weightMode: 'choose', kg: null };
          resolvedNote = 'No history yet for this exercise, so choose a weight you can lift with good form.';
        }
      }
      return { ...resolved, exerciseName: ex.name, equipment: ex.equipment, resolvedNote };
    }),
  };
}

// ---------------- API ----------------

export function createMockApi(onUnauthorized: () => void): GymApi {
  let currentId: string | null = null;

  const auth = (...roles: Role[]): MockUser => {
    const u = currentId ? users.find((x) => x.id === currentId) : undefined;
    if (!u || !u.active) {
      onUnauthorized();
      throw new ApiError('Please log in again.', 401);
    }
    // Owner may call every staff route.
    const ok = roles.includes(u.role) || (u.role === 'owner' && !roles.includes('member'));
    if (!ok) throw new ApiError('You do not have access to this.', 403);
    return u;
  };

  const toAuthUser = (u: MockUser): AuthUser => ({
    id: u.id,
    gymId: GYM.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    memberCode: u.role === 'member' ? memberOf(u.id).code : undefined,
  });

  return {
    setToken(token) {
      currentId = token?.startsWith('mock.') ? token.slice(5) : null;
    },

    async login({ gymId, phone, password }) {
      await wait();
      const n = normalizePhone(phone);
      const u = users.find((x) => x.phone === n && gymId === GYM.id);
      if (!u || u.password !== password || !u.active) throw new ApiError('Wrong phone number or password.', 401);
      return { token: `mock.${u.id}`, user: toAuthUser(u) };
    },

    async me() {
      await wait();
      return toAuthUser(auth('member', 'reception', 'trainer', 'owner'));
    },

    async changePassword({ currentPassword, newPassword }) {
      await wait();
      const u = auth('member', 'reception', 'trainer', 'owner');
      if (u.password !== currentPassword) throw new ApiError('Your current password is wrong.', 400);
      if (newPassword.length < 6) throw new ApiError('Use at least 6 characters.', 400);
      u.password = newPassword;
    },

    async getGym() {
      await wait();
      return {
        id: GYM.id,
        name: GYM.name,
        short: GYM.short,
        city: GYM.city,
        primaryColor: GYM.primaryColor,
        payTo: GYM.payTo,
        receptionWhatsapp: GYM.receptionWhatsapp,
        graceDays: GYM.graceDays,
      };
    },

    async getMembership(): Promise<Membership> {
      await wait();
      const u = auth('member');
      const m = memberOf(u.id);
      const p = planOf(m.planId);
      const t0 = pkToday();
      const proof = [...proofs].reverse().find((x) => x.memberId === u.id && x.status === 'pending');
      const freeze = [...freezes].reverse().find((x) => x.memberId === u.id && x.status === 'pending');
      return {
        memberId: u.id,
        code: m.code,
        name: u.name,
        phone: u.phone,
        goal: m.goal,
        planName: p.name,
        planTiming: p.timing,
        feePkr: p.feePkr,
        planMonths: p.months,
        dueOn: m.dueOn,
        frozenUntil: m.frozenUntil,
        status: membershipStatus(m.dueOn, m.frozenUntil, t0),
        entryAllowed: entryDecision(m, t0, GYM.graceDays).allowed,
        graceDays: GYM.graceDays,
        trainerName: m.trainerId ? userOf(m.trainerId).name : null,
        payTo: GYM.payTo,
        pendingProof: proof ? { id: proof.id, status: proof.status, createdAt: proof.createdAt } : null,
        pendingFreeze: freeze
          ? { id: freeze.id, days: freeze.days, reason: freeze.reason, status: freeze.status, createdAt: freeze.createdAt }
          : null,
      };
    },

    async getProgress(): Promise<ProgressSummary> {
      await wait();
      const u = auth('member');
      const t0 = pkToday();
      const mine = memberSessions(u.id);
      const monthStart = `${t0.slice(0, 7)}-01`;
      const monthAgo = addDays(t0, -30);

      const bestNow = bestsFor(u.id);
      const bestThen = new Map<string, number>();
      let newBests = 0;
      const running = new Map<string, number>();
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

      const visitDays = new Set(checkins.filter((c) => c.memberId === u.id && c.allowed).map((c) => c.date));
      const workoutDays = new Set(mine.map((s) => s.date));
      const visits: VisitLevel[] = Array.from({ length: 84 }, (_, i) => {
        const d = addDays(t0, i - 83);
        return workoutDays.has(d) ? 2 : visitDays.has(d) ? 1 : 0;
      });

      const monthSessions = mine.filter((s) => s.date >= monthStart);
      const plan = trainerPlans.find((p) => p.date === t0 && p.memberIds.includes(u.id));

      return {
        isNew: mine.length === 0,
        todayPlan: plan
          ? { planId: plan.id, planName: plan.name, coachName: userOf(plan.trainerId).name.split(' ')[0], exerciseCount: plan.items.length }
          : null,
        bests: [...bestNow.entries()].map(([exerciseId, b]) => ({
          exerciseId,
          exerciseName: exerciseById(exerciseId).name,
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
        checklist: {
          firstCheckin: visitDays.size > 0,
          firstWorkout: mine.length > 0,
          metTrainer: trainerSessions.some((s) => s.memberId === u.id && s.done),
        },
      };
    },

    async getCheckinKey() {
      await wait();
      const u = auth('member');
      const m = memberOf(u.id);
      return { gymId: GYM.id, memberCode: m.code, key: deriveMemberKey(GYM.secret, m.code) };
    },

    async getHistory(exerciseId): Promise<ExerciseHistory> {
      await wait();
      const u = auth('member');
      const list = memberSessions(u.id, exerciseId);
      let heaviest: ExerciseHistory['heaviest'] = null;
      let bestVolume: ExerciseHistory['bestVolume'] = null;
      let e1rm = 0;
      for (const s of list) {
        const top = heaviestSet(s.sets);
        if (top && (!heaviest || top.kg > heaviest.kg)) heaviest = { kg: top.kg, reps: top.reps, date: s.date };
        const vol = sessionVolume(s.sets);
        if (!bestVolume || vol > bestVolume.kg) bestVolume = { kg: vol, date: s.date };
        e1rm = Math.max(e1rm, bestEstimatedMax(s.sets));
      }
      return {
        exercise: exerciseById(exerciseId),
        heaviest,
        estimatedMax: e1rm || null,
        bestVolume,
        topSets: list
          .slice(-8)
          .map((s) => ({ date: s.date, ...(heaviestSet(s.sets) ?? { kg: 0, reps: 0 }) }))
          .map(({ date, kg, reps }) => ({ date, kg, reps })),
        sessions: [...list].reverse().map((s) => ({ id: s.id, date: s.date, sets: s.sets })),
      };
    },

    async getTodayPlan() {
      await wait();
      const u = auth('member');
      const plan = [...trainerPlans].reverse().find((p) => p.date === pkToday() && p.memberIds.includes(u.id));
      return plan ? resolvePlan(plan.id, u.id) : null;
    },

    async saveSessions(list) {
      await wait();
      const u = auth('member');
      let saved = 0;
      let duplicates = 0;
      for (const s of list) {
        if (sessions.some((x) => x.id === s.id)) duplicates++;
        else {
          sessions.push({ ...s, memberId: u.id });
          saved++;
        }
      }
      return { saved, duplicates };
    },

    async uploadPaymentProof() {
      await wait();
      const u = auth('member');
      const p = { id: uid(), memberId: u.id, status: 'pending' as const, createdAt: nowIso() };
      proofs.push(p);
      return { id: p.id, status: p.status, createdAt: p.createdAt };
    },

    async requestFreeze({ days, reason }) {
      await wait();
      const u = auth('member');
      if (!isValidFreezeDays(days)) throw new ApiError('A freeze must be 3 to 15 days.', 400);
      if (freezes.some((f) => f.memberId === u.id && f.status === 'pending')) {
        throw new ApiError('You already have a freeze request waiting.', 409);
      }
      const f = { id: uid(), memberId: u.id, days, reason, status: 'pending' as const, createdAt: nowIso() };
      freezes.push(f);
      return { id: f.id, days, reason, status: f.status, createdAt: f.createdAt };
    },

    async getAnnouncements() {
      await wait();
      auth('member', 'reception', 'trainer', 'owner');
      return [...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async getExercises() {
      await wait();
      auth('member', 'reception', 'trainer', 'owner');
      return exercises;
    },

    async scan(raw) {
      await wait();
      const staff = auth('reception');
      const code = raw.trim();
      let member: MockMember | undefined;
      let source: CheckinSource = 'manual';
      if (isCheckinQr(code)) {
        const v = verifyCheckinQr(code, GYM.id, GYM.secret);
        if (!v.ok) return { ok: false, message: v.message };
        member = members.find((m) => m.code === v.memberCode);
        source = 'qr';
      } else {
        member = members.find((m) => m.code.toUpperCase() === code.toUpperCase());
      }
      if (!member || !userOf(member.userId).active) {
        return { ok: false, message: `No member with ID ${code.toUpperCase()} at this gym.` };
      }
      const t0 = pkToday();
      const d = entryDecision(member, t0, GYM.graceDays);
      checkins.push({
        id: uid(),
        memberId: member.userId,
        allowed: d.allowed,
        reason: d.allowed ? null : d.reason,
        source,
        scannedBy: staff.id,
        createdAt: nowIso(),
        date: t0,
      });
      const sm = toScanMember(member);
      if (d.allowed) return { ok: true, allowed: true, member: sm, message: 'Entry allowed' };
      const p = planOf(member.planId);
      return {
        ok: true,
        allowed: false,
        member: sm,
        message: d.message,
        amountDue: d.reason === 'overdue' ? p.feePkr : null,
      };
    },

    async recordPayment({ memberCode, amountPkr, method, txnId }) {
      await wait();
      const staff = auth('reception');
      const m = members.find((x) => x.code === memberCode);
      if (!m) throw new ApiError('Member not found.', 404);
      if (!(amountPkr > 0)) throw new ApiError('Enter an amount above zero.', 400);
      const p = planOf(m.planId);
      const t0 = pkToday();
      const { periodFrom, periodTo } = paymentPeriod(m.dueOn, p.months, t0);
      m.dueOn = periodTo;
      m.frozenUntil = null;
      const payment = {
        id: uid(),
        memberId: m.userId,
        amountPkr,
        method,
        txnId: txnId ?? null,
        periodFrom,
        periodTo,
        recordedBy: staff.id,
        proofId: null,
        createdAt: nowIso(),
      };
      payments.push(payment);
      const first = userOf(m.userId).name.split(' ')[0];
      const receipt = `Assalam o Alaikum ${first}, we received ${formatPKR(amountPkr)} by ${PAYMENT_METHOD_LABELS[method]} at ${GYM.name}. Your membership is paid till ${formatShortDate(periodTo)}. Thank you!`;
      return {
        payment,
        newDueOn: periodTo,
        message: `Renewed to ${formatShortDate(periodTo)}. Receipt queued for WhatsApp: "${receipt}"`,
      };
    },

    async trainerToday() {
      await wait();
      auth('trainer');
      return trainerSessions;
    },

    async setSessionDone(id, done) {
      await wait();
      auth('trainer');
      const s = trainerSessions.find((x) => x.id === id);
      if (!s) throw new ApiError('Session not found.', 404);
      s.done = done;
      return s;
    },

    async trainerClients() {
      await wait();
      const tr = auth('trainer');
      const t0 = pkToday();
      return members
        .filter((m) => tr.role === 'owner' || m.trainerId === tr.id)
        .map((m) => ({
          memberId: m.userId,
          code: m.code,
          name: userOf(m.userId).name,
          status: membershipStatus(m.dueOn, m.frozenUntil, t0),
          goal: m.goal,
        }));
    },

    async clientBests(memberId) {
      await wait();
      const tr = auth('trainer');
      const m = memberOf(memberId);
      if (tr.role !== 'owner' && m.trainerId !== tr.id) throw new ApiError('This is not your client.', 403);
      return [...bestsFor(memberId).entries()].map(([exerciseId, b]) => ({
        exerciseId,
        kg: b.kg,
        reps: b.reps,
        estimatedMax: b.e1rm || estimatedOneRepMax(b.kg, b.reps),
      }));
    },

    async createPlan({ name, date, items, memberIds }) {
      await wait();
      const tr = auth('trainer');
      if (date < pkToday()) throw new ApiError('Plans cannot be written for past days.', 400);
      if (!name.trim()) throw new ApiError('Give the plan a name.', 400);
      if (items.length < 1 || items.length > 15) throw new ApiError('A plan needs 1 to 15 exercises.', 400);
      if (memberIds.length < 1 || memberIds.length > 100) throw new ApiError('Send the plan to 1 to 100 clients.', 400);
      for (const id of memberIds) {
        const m = memberOf(id);
        if (tr.role !== 'owner' && m.trainerId !== tr.id) throw new ApiError('You can only send plans to your own clients.', 403);
      }
      const plan = { id: uid(), trainerId: tr.id, name: name.trim(), date, items, memberIds, createdAt: nowIso() };
      trainerPlans.push(plan);
      return { plan, sentTo: memberIds.length };
    },
  };
}

/** Demo logins shown on the login screen in mock mode only. */
export const MOCK_ACCOUNTS = users.map((u) => ({ name: u.name, role: u.role, phone: u.phone }));

