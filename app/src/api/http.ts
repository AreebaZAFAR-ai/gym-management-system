import type { GymApi, UploadFile } from './types';
import { ApiError } from './types';
import { t } from '../strings';

const TIMEOUT_MS = 15_000;

/** REST client for the NestJS API. All routes under /v1, bearer token, `{ message }` errors. */
export function createHttpApi(baseUrl: string, onUnauthorized: () => void): GymApi {
  const root = `${baseUrl.replace(/\/$/, '')}/v1`;
  let token: string | null = null;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${root}/${path}`, { method, headers, body: payload, signal: controller.signal });
    } catch {
      throw new ApiError(t.common.networkError, 0, true);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return null as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // Login failures are also 401 but must show their own message.
      if (res.status === 401 && path !== 'auth/login') onUnauthorized();
      throw new ApiError(data?.message ?? `Request failed (${res.status})`, res.status);
    }
    return data as T;
  }

  const get = <T>(p: string) => request<T>('GET', p);
  const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
  const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
  const enc = encodeURIComponent;

  return {
    setToken: (value) => {
      token = value;
    },
    login: (body) => post('auth/login', body),
    me: () => get('auth/me'),
    changePassword: (body) => post('auth/change-password', body),
    getGym: (id) => get(`gyms/${enc(id)}`),

    getMembership: () => get('me/membership'),
    getProgress: () => get('me/progress'),
    getCheckinKey: () => get('me/checkin-key'),
    getHistory: (id) => get(`me/history/${enc(id)}`),
    getTodayPlan: () => get('me/plan/today'),
    saveSessions: (sessions) => post('me/sessions', { sessions }),
    uploadPaymentProof: (file: UploadFile) => {
      const form = new FormData();
      // React Native's FormData accepts { uri, name, type } file descriptors.
      form.append('file', file as unknown as Blob);
      return post('me/payment-proofs', form);
    },
    requestFreeze: (body) => post('me/freeze', body),

    getAnnouncements: () => get('announcements'),
    getExercises: () => get('exercises'),

    scan: (code) => post('checkins/scan', { code }),
    recordPayment: (body) => post('payments', body),

    trainerToday: () => get('trainer/today'),
    setSessionDone: (id, done) => patch(`trainer/sessions/${enc(id)}`, { done }),
    trainerClients: () => get('trainer/clients'),
    clientBests: (memberId) => get(`trainer/clients/${enc(memberId)}/bests`),
    createPlan: (body) => post('trainer/plans', body),
  };
}
