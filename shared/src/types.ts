/**
 * API contract shared by the mobile app, the API and the web admin.
 * Response shapes from /v1 must match these types (spec §10).
 * Dates without a time are Pakistan business dates as "YYYY-MM-DD".
 */

export type Role = 'member' | 'reception' | 'trainer' | 'owner';
export type StaffRole = Exclude<Role, 'member'>;

export type MembershipStatus = 'active' | 'due_soon' | 'overdue' | 'frozen';
export type PaymentMethod = 'cash' | 'jazzcash' | 'easypaisa' | 'bank';
export type CheckinSource = 'qr' | 'manual' | 'fingerprint';
export type Goal = 'strength' | 'muscle' | 'fat_loss' | 'fitness';
export type Gender = 'male' | 'female' | 'other';
export type FreezeReason = 'travel' | 'illness' | 'other';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type Equipment = 'bar' | 'db' | 'machine' | 'body';
export type MuscleGroup = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core';
export type WeightMode = 'fixed' | 'pct' | 'choose' | 'body';
export type WhatsAppKind = 'receipt' | 'reminder' | 'welcome' | 'announcement' | 'other';
export type WhatsAppStatus = 'queued' | 'sent' | 'failed';

/** Error body for every non-2xx response. `message` is safe to show as is. */
export interface ApiError {
  message: string;
}

// ---------- Auth ----------

export interface LoginRequest {
  gymId: string;
  /** 10 digits starting with 3, e.g. "3001234567". */
  phone: string;
  password: string;
}

export interface AuthUser {
  id: string;
  gymId: string;
  name: string;
  phone: string;
  role: Role;
  /** Member code (IH-0412); members only. */
  memberCode?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ---------- Gym self-registration (public, web admin) ----------

/**
 * POST gyms/register. Creates a gym and its first owner account. The role is
 * always "owner"; any role sent by the client is ignored.
 */
export interface RegisterGymRequest {
  gymName: string;
  gymEmail: string;
  /** Any common format; 7 to 15 digits. */
  gymPhone: string;
  gymAddress: string;
  city: string;
  ownerName: string;
  ownerEmail: string;
  /** Pakistani mobile number in any common format; the owner logs in with it. */
  ownerPhone: string;
  password: string;
  confirmPassword: string;
}

export interface RegisterGymResponse {
  /** The Gym Code used at login (gyms.id). */
  gymId: string;
  gymName: string;
  ownerName: string;
  /** 10 digits starting with 3. */
  ownerPhone: string;
}

// ---------- Gym brand (public) ----------

export interface PayTo {
  /** e.g. "JazzCash", "Easypaisa", "Meezan Bank" */
  label: string;
  number: string;
  title: string;
}

export interface GymBrand {
  id: string;
  name: string;
  short: string;
  city: string;
  primaryColor: string;
  payTo: PayTo;
  receptionWhatsapp: string;
  graceDays: number;
}

// ---------- Member ----------

export interface Membership {
  memberId: string;
  code: string;
  name: string;
  phone: string;
  goal: Goal | null;
  planName: string;
  planTiming: string | null;
  feePkr: number;
  planMonths: number;
  dueOn: string;
  frozenUntil: string | null;
  status: MembershipStatus;
  /** Whether the member may enter today (status + grace days). */
  entryAllowed: boolean;
  graceDays: number;
  trainerName: string | null;
  payTo: PayTo;
  pendingProof: PaymentProofSummary | null;
  pendingFreeze: FreezeRequestSummary | null;
}

export interface PaymentProofSummary {
  id: string;
  status: RequestStatus;
  createdAt: string;
}

export interface FreezeRequestSummary {
  id: string;
  days: number;
  reason: FreezeReason;
  status: RequestStatus;
  createdAt: string;
}

export interface FreezeRequestBody {
  days: number;
  reason: FreezeReason;
}

export interface CheckinKey {
  gymId: string;
  memberCode: string;
  /** base64url of HMAC-SHA256(gym secret, "member:" + code). */
  key: string;
}

/** 0 = no visit, 1 = visit, 2 = long session (90+ min or a workout logged). */
export type VisitLevel = 0 | 1 | 2;

export interface PersonalBest {
  exerciseId: string;
  exerciseName: string;
  kg: number;
  reps: number;
  /** Change in best kg compared with 30 days ago; 0 when unchanged. */
  deltaKgMonth: number;
}

export interface ProgressSummary {
  isNew: boolean;
  todayPlan: { planId: string; planName: string; coachName: string; exerciseCount: number } | null;
  bests: PersonalBest[];
  /** 84 entries, oldest first, ending today (12 weeks). */
  visits: VisitLevel[];
  month: { workouts: number; newBests: number; tonnes: number };
  checklist: { firstCheckin: boolean; firstWorkout: boolean; metTrainer: boolean };
}

export interface SetEntry {
  kg: number;
  reps: number;
  warmup: boolean;
  /** Barbell: plates on one side, e.g. [20, 10]. */
  plates?: number[];
  /** Machine: blocks added, e.g. [10, 5, 5]. */
  blocks?: number[];
}

export interface ExerciseSessionInput {
  /** Created on the phone (UUID). The server ignores IDs it already has. */
  id: string;
  exerciseId: string;
  date: string;
  sets: SetEntry[];
  planId?: string | null;
}

export interface SaveSessionsResponse {
  saved: number;
  duplicates: number;
}

export interface ExerciseHistory {
  exercise: Exercise;
  heaviest: { kg: number; reps: number; date: string } | null;
  estimatedMax: number | null;
  bestVolume: { kg: number; date: string } | null;
  /** Most recent last; max 8. */
  topSets: { date: string; kg: number; reps: number }[];
  sessions: { id: string; date: string; sets: SetEntry[] }[];
}

// ---------- Exercises & plans ----------

export interface Exercise {
  id: string;
  gymId: string | null;
  name: string;
  equipment: Equipment;
  muscle: MuscleGroup;
}

export interface PlanItem {
  exerciseId: string;
  sets: number; // 1–10
  reps: number; // 1–50
  weightMode: WeightMode;
  kg: number | null;
  pct: number | null; // 30–100
  warmups: boolean;
  restSec: number; // 0–600
  note: string | null;
  canChange: boolean;
}

/** A plan item resolved for one member (pct already turned into kg). */
export interface ResolvedPlanItem extends PlanItem {
  exerciseName: string;
  equipment: Equipment;
  /** Explanation when pct fell back to "member chooses". */
  resolvedNote: string | null;
}

export interface TodayPlan {
  planId: string;
  planName: string;
  coachName: string;
  date: string;
  items: ResolvedPlanItem[];
  /** exerciseIds already logged today for this plan. */
  doneExerciseIds: string[];
}

export interface TrainerPlan {
  id: string;
  trainerId: string;
  name: string;
  date: string;
  items: PlanItem[];
  memberIds: string[];
  createdAt: string;
}

export interface CreatePlanRequest {
  name: string;
  date: string;
  items: PlanItem[];
  memberIds: string[];
}

export interface CreatePlanResponse {
  plan: TrainerPlan;
  sentTo: number;
}

// ---------- Trainer ----------

export interface TrainerSession {
  id: string;
  /** The trainer the session belongs to (the owner sees every trainer's sessions). */
  trainerId: string;
  trainerName: string;
  memberId: string | null;
  startsAt: string;
  title: string;
  meta: string | null;
  kind: 'pt' | 'class';
  done: boolean;
}

export interface TrainerClient {
  memberId: string;
  code: string;
  name: string;
  status: MembershipStatus;
  goal: Goal | null;
}

export interface ClientBest {
  exerciseId: string;
  kg: number;
  reps: number;
  estimatedMax: number;
}

// ---------- Door ----------

export interface ScanRequest {
  /** A QR payload (GYM1.…) or a typed member code (IH-0412). */
  code: string;
}

export interface ScanMember {
  memberId: string;
  code: string;
  name: string;
  phone: string;
  planName: string;
  planId: string;
  feePkr: number;
  dueOn: string;
  frozenUntil: string | null;
  status: MembershipStatus;
}

export type ScanResult =
  | { ok: true; allowed: true; member: ScanMember; message: string }
  | { ok: true; allowed: false; member: ScanMember; message: string; amountDue: number | null }
  /** Code could not be used at all (expired, forged, other gym, unknown ID). */
  | { ok: false; message: string };

// ---------- Payments ----------

export interface RecordPaymentRequest {
  memberCode: string;
  amountPkr: number;
  method: PaymentMethod;
  txnId?: string | null;
}

export interface Payment {
  id: string;
  memberId: string;
  amountPkr: number;
  method: PaymentMethod;
  txnId: string | null;
  periodFrom: string;
  periodTo: string;
  recordedBy: string;
  proofId: string | null;
  /** Corrected Payment: the original payment this row corrects (the original is kept unchanged). */
  correctsPaymentId?: string | null;
  createdAt: string;
}

export interface RecordPaymentResponse {
  payment: Payment;
  newDueOn: string;
  message: string;
}

// ---------- Member registration (reception, owner) ----------

export interface RegisterMemberRequest {
  name: string;
  /** Any common format; stored as 10 digits starting with 3. */
  phone: string;
  gender?: Gender | null;
  /** "YYYY-MM-DD" */
  joinedOn: string;
  goal?: Goal | null;
  emergencyContact?: string | null;
  /** Thumbprint ID from the gym's fingerprint device. */
  fingerprintId?: string | null;
  notes?: string | null;
  /** Fee plan. */
  planId: string;
  trainerId?: string | null;
  /** §6 "Optional first payment with method". Omit (or null) to register without one. */
  payment?: { amountPkr: number; method: PaymentMethod; txnId?: string | null } | null;
}

export interface RegisterMemberResponse {
  memberId: string;
  code: string;
  /** Default password (last 6 digits of the mobile number), shown once to reception. */
  temporaryPassword: string;
  /** From the first payment, or the joining date when registered without one. */
  dueOn: string;
  /** The first payment, or null when registered without one (no receipt is queued). */
  payment: Payment | null;
}

/** POST members/:code/reset-password: the new password (the §7 default), shown once to reception. */
export interface ResetPasswordResponse {
  password: string;
}

// ---------- Staff screens (web admin and reception) ----------

/** §6 Fee plans. Hidden plans (active = false) stay on existing members. */
export interface FeePlan {
  id: string;
  name: string;
  timing: string | null;
  feePkr: number;
  months: number;
  active: boolean;
}

export interface FeePlanInput {
  name: string;
  timing?: string | null;
  feePkr: number;
  months: number;
  active?: boolean;
}

/** §6 Members list row. */
export interface MemberListItem {
  memberId: string;
  code: string;
  name: string;
  phone: string;
  planId: string;
  planName: string;
  planTiming: string | null;
  feePkr: number;
  dueOn: string;
  frozenUntil: string | null;
  status: MembershipStatus;
  /** Account enabled (Disable/Enable on the member page). */
  active: boolean;
  trainerId: string | null;
  trainerName: string | null;
}

export interface CheckinLogItem {
  id: string;
  /** Null when the scan identified no member. */
  memberId: string | null;
  memberCode: string | null;
  memberName: string | null;
  allowed: boolean;
  reason: string | null;
  source: CheckinSource;
  scannedBy: string | null;
  createdAt: string;
}

export interface WhatsAppMessage {
  id: string;
  memberId: string | null;
  memberName: string | null;
  toPhone: string;
  kind: WhatsAppKind;
  body: string;
  status: WhatsAppStatus;
  createdAt: string;
  /** wa.me link with the text filled in (§6 "Open in WhatsApp"). */
  link: string;
}

export interface DueDateChange {
  id: string;
  oldDueOn: string;
  newDueOn: string;
  changedBy: string;
  createdAt: string;
}

/** §6 Member page. */
export interface MemberDetail extends MemberListItem {
  gender: Gender | null;
  goal: Goal | null;
  joinedOn: string;
  emergencyContact: string | null;
  fingerprintId: string | null;
  notes: string | null;
  visitsLast30Days: number;
  payments: Payment[];
  checkins: CheckinLogItem[];
  whatsapp: WhatsAppMessage[];
  dueDateChanges: DueDateChange[];
}

/** §6 Edit member. `dueOn` is owner only and is logged (§11). */
export interface UpdateMemberRequest {
  name?: string;
  phone?: string;
  gender?: Gender | null;
  goal?: Goal | null;
  emergencyContact?: string | null;
  fingerprintId?: string | null;
  notes?: string | null;
  planId?: string;
  trainerId?: string | null;
  active?: boolean;
  dueOn?: string;
}

/** POST whatsapp/reminders (§6 "Add fee reminders"): how many reminders were queued. */
export interface FeeRemindersResponse {
  queued: number;
}

/** §6 Fees and payments: approvals. */
export interface PaymentProofItem {
  id: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  status: RequestStatus;
  /** Short-lived signed link (§11: screenshots are not public URLs). Relative to the API base URL. */
  imageUrl: string;
  /** Plan fee, to pre-fill the editable amount. */
  feePkr: number;
  createdAt: string;
}

export interface ApproveProofRequest {
  amountPkr: number;
  method: PaymentMethod;
}

export interface FreezeRequestItem {
  id: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  days: number;
  reason: FreezeReason;
  status: RequestStatus;
  createdAt: string;
  dueOn: string;
  /** Due date if approved today. */
  newDueOn: string;
}

/** §6 Overview. */
export interface DashboardSummary {
  activeMembers: number;
  joinedThisMonth: number;
  checkinsToday: number;
  feesThisMonthPkr: number;
  overdueCount: number;
  overduePkr: number;
  pendingProofs: number;
  pendingFreezes: number;
  overdue: MemberListItem[];
  dueSoon: MemberListItem[];
}

/** §6 Reports (owner). */
export interface ReportsSummary {
  feesByMonth: { month: string; totalPkr: number }[];
  checkinsByHour: { hour: number; count: number }[];
  dailyCheckins: { date: string; count: number }[];
  thisMonthByMethod: { method: PaymentMethod; totalPkr: number }[];
  mightQuit: MemberListItem[];
}

/** §6 Staff and roles (owner). */
export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: StaffRole;
  active: boolean;
}

export interface CreateStaffRequest {
  name: string;
  phone: string;
  role: StaffRole;
  password: string;
}

export interface UpdateStaffRequest {
  name?: string;
  role?: StaffRole;
  active?: boolean;
  password?: string;
}

/** §6 Settings (owner). The check-in secret is never returned. */
export interface GymSettings {
  name: string;
  city: string;
  primaryColor: string;
  graceDays: number;
  payTo: PayTo;
  receptionWhatsapp: string;
  deviceAddress: string | null;
  deviceKey: string | null;
}

export type UpdateGymSettings = Partial<GymSettings>;

export interface CreateAnnouncementRequest {
  title: string;
  body: string;
  /** Optional WhatsApp copy to all active members (§6). */
  sendWhatsApp?: boolean;
}

// ---------- Trainer sessions (trainer, owner) ----------

export interface CreateTrainerSessionRequest {
  /** Owner only: the trainer the session is assigned to. Trainers always create their own. */
  trainerId?: string | null;
  /** Client; null for a class. */
  memberId?: string | null;
  /** ISO timestamp. */
  startsAt: string;
  title: string;
  meta?: string | null;
  kind: 'pt' | 'class';
}

// ---------- Announcements ----------

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}
