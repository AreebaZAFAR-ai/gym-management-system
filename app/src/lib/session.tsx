import type { AuthUser, CheckinKey, Membership } from '@gym/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api, ApiError, onUnauthorized } from '../api';
import { BRAND } from '../config';
import { flushQueue } from './queue';
import { KEYS, local, secure, USER_CACHE_KEYS } from './storage';

type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser };

type SessionContextValue = {
  state: SessionState;
  login: (phone: string, password: string, remember: boolean) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const SYNC_INTERVAL_MS = 60_000;

/** Member data needed offline: check-in key (secure) and membership snapshot. */
async function cacheMemberEssentials() {
  const [key, membership] = await Promise.all([api.getCheckinKey(), api.getMembership()]);
  await secure.set(KEYS.checkinKey, JSON.stringify(key));
  await local.set(KEYS.membership, membership);
}

export async function readCheckinKey(): Promise<CheckinKey | null> {
  const raw = await secure.get(KEYS.checkinKey);
  return raw ? (JSON.parse(raw) as CheckinKey) : null;
}

export async function readCachedMembership(): Promise<Membership | null> {
  return local.get<Membership>(KEYS.membership);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const signedInRole = useRef<string | null>(null);

  const clear = useCallback(async () => {
    api.setToken(null);
    signedInRole.current = null;
    await Promise.all([secure.remove(KEYS.token), secure.remove(KEYS.user), secure.remove(KEYS.checkinKey)]);
    await local.remove(...USER_CACHE_KEYS);
    setState({ status: 'signedOut' });
  }, []);

  // Restore a remembered login. Works offline: the stored user is trusted
  // until the server says otherwise (401 signs out).
  useEffect(() => {
    onUnauthorized(() => void clear());
    (async () => {
      let token: string | null;
      let rawUser: string | null;
      try {
        [token, rawUser] = await Promise.all([secure.get(KEYS.token), secure.get(KEYS.user)]);
      } catch (e) {
        // Secure storage unreadable (e.g. Android keystore reset): the saved login
        // is unusable, so start signed out instead of waiting on the splash forever.
        console.warn('Could not restore saved login', e);
        await clear().catch(() => setState({ status: 'signedOut' }));
        return;
      }
      if (!token || !rawUser) {
        // Not remembered: drop anything left from the last session on this phone,
        // including unsent sets, so they can never be sent under someone else's login.
        await secure.remove(KEYS.checkinKey);
        await local.remove(...USER_CACHE_KEYS);
        return setState({ status: 'signedOut' });
      }
      const user = JSON.parse(rawUser) as AuthUser;
      api.setToken(token);
      signedInRole.current = user.role;
      setState({ status: 'signedIn', user });
      try {
        const fresh = await api.me();
        await secure.set(KEYS.user, JSON.stringify(fresh));
        setState({ status: 'signedIn', user: fresh });
        if (fresh.role === 'member') {
          await cacheMemberEssentials();
          void flushQueue();
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clear();
      }
    })();
  }, [clear]);

  // Members: keep sending queued workouts when the app comes back and every minute.
  useEffect(() => {
    if (state.status !== 'signedIn' || state.user.role !== 'member') return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void flushQueue());
    const timer = setInterval(() => void flushQueue(), SYNC_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [state]);

  const login = useCallback(async (phone: string, password: string, remember: boolean) => {
    const { token, user } = await api.login({ gymId: BRAND.id, phone, password });
    api.setToken(token);
    if (remember) {
      await secure.set(KEYS.token, token);
      await secure.set(KEYS.user, JSON.stringify(user));
    }
    if (user.role === 'member') await cacheMemberEssentials();
    signedInRole.current = user.role;
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    if (signedInRole.current === 'member') await flushQueue();
    await clear();
  }, [clear]);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** The signed-in user. Only call from screens behind the auth redirect. */
export function useUser(): AuthUser {
  const { state } = useSession();
  if (state.status !== 'signedIn') throw new Error('Not signed in');
  return state.user;
}
