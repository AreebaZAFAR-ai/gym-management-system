import type {
  Announcement,
  AuthUser,
  ChangePasswordRequest,
  CheckinKey,
  ClientBest,
  CreatePlanRequest,
  CreatePlanResponse,
  Exercise,
  ExerciseHistory,
  ExerciseSessionInput,
  FreezeRequestBody,
  FreezeRequestSummary,
  GymBrand,
  LoginRequest,
  LoginResponse,
  Membership,
  PaymentProofSummary,
  ProgressSummary,
  RecordPaymentRequest,
  RecordPaymentResponse,
  SaveSessionsResponse,
  ScanResult,
  TodayPlan,
  TrainerClient,
  TrainerSession,
} from '@gym/shared';

export type UploadFile = { uri: string; name: string; type: string };

/** Every /v1 call the mobile app makes (spec §10). */
export interface GymApi {
  setToken(token: string | null): void;

  login(body: LoginRequest): Promise<LoginResponse>;
  me(): Promise<AuthUser>;
  changePassword(body: ChangePasswordRequest): Promise<void>;
  getGym(gymId: string): Promise<GymBrand>;

  // Member
  getMembership(): Promise<Membership>;
  getProgress(): Promise<ProgressSummary>;
  getCheckinKey(): Promise<CheckinKey>;
  getHistory(exerciseId: string): Promise<ExerciseHistory>;
  getTodayPlan(): Promise<TodayPlan | null>;
  saveSessions(sessions: ExerciseSessionInput[]): Promise<SaveSessionsResponse>;
  uploadPaymentProof(file: UploadFile): Promise<PaymentProofSummary>;
  requestFreeze(body: FreezeRequestBody): Promise<FreezeRequestSummary>;

  // Shared
  getAnnouncements(): Promise<Announcement[]>;
  getExercises(): Promise<Exercise[]>;

  // Door (reception, owner)
  scan(code: string): Promise<ScanResult>;
  recordPayment(body: RecordPaymentRequest): Promise<RecordPaymentResponse>;

  // Trainer
  trainerToday(): Promise<TrainerSession[]>;
  setSessionDone(id: string, done: boolean): Promise<TrainerSession>;
  trainerClients(): Promise<TrainerClient[]>;
  clientBests(memberId: string): Promise<ClientBest[]>;
  createPlan(body: CreatePlanRequest): Promise<CreatePlanResponse>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the server could not be reached at all. */
    readonly network = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
