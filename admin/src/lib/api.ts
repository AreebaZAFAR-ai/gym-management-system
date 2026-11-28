import type {
  Announcement,
  ApproveProofRequest,
  AuthUser,
  CheckinLogItem,
  ClientBest,
  CreateAnnouncementRequest,
  CreatePlanRequest,
  CreatePlanResponse,
  CreateStaffRequest,
  DashboardSummary,
  Exercise,
  FeePlan,
  FeePlanInput,
  FeeRemindersResponse,
  FreezeRequestItem,
  GymBrand,
  GymSettings,
  LoginRequest,
  LoginResponse,
  MemberDetail,
  MemberListItem,
  MembershipStatus,
  Payment,
  PaymentProofItem,
  RecordPaymentRequest,
  RecordPaymentResponse,
  RegisterGymRequest,
  RegisterGymResponse,
  RegisterMemberRequest,
  RegisterMemberResponse,
  ReportsSummary,
  RequestStatus,
  ResetPasswordResponse,
  ScanResult,
  StaffMember,
  TrainerClient,
  TrainerPlan,
  TrainerSession,
  UpdateGymSettings,
  UpdateMemberRequest,
  UpdateStaffRequest,
  WhatsAppMessage,
  WhatsAppStatus,
} from '@gym/shared';

/**
 * REST client for the web admin (§8: client-side pages calling the API with a
 * bearer token; no server-side data access). Framework-free so the API's
 * contract test can drive it against a live server.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the request never reached the server (offline, DNS, timeout). */
    readonly network = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiHooks {
  /** A signed-in request came back 401: the token is no longer valid. */
  onUnauthorized?: () => void;
  /** Called after every request: false when the network failed, true when the server answered. */
  onReachable?: (reachable: boolean) => void;
  networkErrorMessage?: string;
}

export type WhatsAppFilter = 'to_send' | 'sent' | 'all' | WhatsAppStatus;
export type RequestFilter = RequestStatus | 'all';

const TIMEOUT_MS = 15_000;

export function createAdminApi(baseUrl: string, hooks: ApiHooks = {}) {
  const base = baseUrl.replace(/\/$/, '');
  const root = `${base}/v1`;
  let token: string | null = null;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${root}/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      hooks.onReachable?.(false);
      throw new ApiError(hooks.networkErrorMessage ?? 'No connection to the server.', 0, true);
    } finally {
      clearTimeout(timer);
    }
    hooks.onReachable?.(true);

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      // A wrong password is also 401 but must show its own message, not log out.
      if (res.status === 401 && path !== 'auth/login') hooks.onUnauthorized?.();
      const message = (data as { message?: unknown } | null)?.message;
      throw new ApiError(typeof message === 'string' && message ? message : `Request failed (${res.status})`, res.status);
    }
    return data as T;
  }

  const get = <T>(path: string, query?: Record<string, string | undefined | null>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    const s = qs.toString();
    return request<T>('GET', s ? `${path}?${s}` : path);
  };
  const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
  const del = (path: string) => request<void>('DELETE', path);
  const enc = encodeURIComponent;

  return {
    setToken(value: string | null) {
      token = value;
    },
    /** Absolute URL for a path the API returns relative to its base (e.g. signed screenshot links). */
    absolute(path: string) {
      return /^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    },

    // Auth and brand
    login: (body: LoginRequest) => post<LoginResponse>('auth/login', body),
    /** Public: a gym owner registers their gym; returns the Gym Code for login. */
    registerGym: (body: RegisterGymRequest) => post<RegisterGymResponse>('gyms/register', body),
    me: () => get<AuthUser>('auth/me'),
    getGym: (id: string) => get<GymBrand>(`gyms/${enc(id)}`),

    // Overview and reports
    dashboard: () => get<DashboardSummary>('dashboard'),
    reports: () => get<ReportsSummary>('reports'),

    // Members
    members: (q?: { q?: string; status?: MembershipStatus | 'all' }) => get<MemberListItem[]>('members', q),
    registerMember: (body: RegisterMemberRequest) => post<RegisterMemberResponse>('members', body),
    member: (code: string) => get<MemberDetail>(`members/${enc(code)}`),
    updateMember: (code: string, body: UpdateMemberRequest) => patch<MemberDetail>(`members/${enc(code)}`, body),
    resetPassword: (code: string) => post<ResetPasswordResponse>(`members/${enc(code)}/reset-password`),

    // Door
    scan: (code: string) => post<ScanResult>('checkins/scan', { code }),
    checkins: (date?: string) => get<CheckinLogItem[]>('checkins', { date }),

    // Fees
    recordPayment: (body: RecordPaymentRequest) => post<RecordPaymentResponse>('payments', body),
    payments: (q?: { from?: string; to?: string; member?: string }) => get<Payment[]>('payments', q),
    paymentProofs: (status: RequestFilter = 'pending') => get<PaymentProofItem[]>('payment-proofs', { status }),
    approveProof: (id: string, body: ApproveProofRequest) => post<RecordPaymentResponse>(`payment-proofs/${enc(id)}/approve`, body),
    rejectProof: (id: string) => post<{ id: string; status: RequestStatus }>(`payment-proofs/${enc(id)}/reject`),
    freezeRequests: (status: RequestFilter = 'pending') => get<FreezeRequestItem[]>('freeze-requests', { status }),
    approveFreeze: (id: string) => post<FreezeRequestItem>(`freeze-requests/${enc(id)}/approve`),
    rejectFreeze: (id: string) => post<FreezeRequestItem>(`freeze-requests/${enc(id)}/reject`),

    // WhatsApp and announcements
    whatsapp: (status: WhatsAppFilter = 'to_send') => get<WhatsAppMessage[]>('whatsapp', { status }),
    setWhatsappStatus: (id: string, status: WhatsAppStatus) => patch<WhatsAppMessage>(`whatsapp/${enc(id)}`, { status }),
    queueFeeReminders: () => post<FeeRemindersResponse>('whatsapp/reminders'),
    announcements: () => get<Announcement[]>('announcements'),
    createAnnouncement: (body: CreateAnnouncementRequest) =>
      post<Announcement & { whatsappQueued: number }>('announcements', body),
    deleteAnnouncement: (id: string) => del(`announcements/${enc(id)}`),

    // Setup
    exercises: () => get<Exercise[]>('exercises'),
    feePlans: () => get<FeePlan[]>('plans'),
    createFeePlan: (body: FeePlanInput) => post<FeePlan>('plans', body),
    updateFeePlan: (id: string, body: Partial<FeePlanInput>) => patch<FeePlan>(`plans/${enc(id)}`, body),
    staff: () => get<StaffMember[]>('staff'),
    createStaff: (body: CreateStaffRequest) => post<StaffMember>('staff', body),
    updateStaff: (id: string, body: UpdateStaffRequest) => patch<StaffMember>(`staff/${enc(id)}`, body),
    settings: () => get<GymSettings>('settings'),
    updateSettings: (body: UpdateGymSettings) => patch<GymSettings>('settings', body),

    // Trainer
    trainerToday: () => get<TrainerSession[]>('trainer/today'),
    setSessionDone: (id: string, done: boolean) => patch<TrainerSession>(`trainer/sessions/${enc(id)}`, { done }),
    trainerClients: () => get<TrainerClient[]>('trainer/clients'),
    clientBests: (memberId: string) => get<ClientBest[]>(`trainer/clients/${enc(memberId)}/bests`),
    trainerPlans: () => get<TrainerPlan[]>('trainer/plans'),
    createTrainerPlan: (body: CreatePlanRequest) => post<CreatePlanResponse>('trainer/plans', body),
    deleteTrainerPlan: (id: string) => del(`trainer/plans/${enc(id)}`),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
