'use client';

import type { AuthUser, GymBrand } from '@gym/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createAdminApi, type AdminApi } from './api';
import { isStaffDesk } from './nav';
import { t } from './strings';

/** Base URL of the API, built into the bundle (admin/.env.local). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const STORAGE_KEY = 'gym-admin-session';
const APPROVALS_POLL_MS = 60_000;

interface Stored {
  token: string;
  user: AuthUser;
}

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return s?.token && s.user?.gymId ? s : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored | null) {
  try {
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the session lasts until the tab closes.
  }
}

export type SessionState = 'loading' | 'signed-out' | 'signed-in';

interface SessionValue {
  state: SessionState;
  api: AdminApi;
  user: AuthUser | null;
  gym: GymBrand | null;
  online: boolean;
  /** Payment screenshots + freeze requests waiting (reception, owner). */
  approvalsWaiting: number;
  refreshApprovals: () => void;
  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [gym, setGym] = useState<GymBrand | null>(null);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [approvalsWaiting, setApprovalsWaiting] = useState(0);
  const signOutRef = useRef<() => void>(() => {});

  const api = useMemo(
    () =>
      createAdminApi(API_URL, {
        onUnauthorized: () => signOutRef.current(),
        onReachable: setReachable,
        networkErrorMessage: t.common.networkError,
      }),
    [],
  );

  const signOut = useCallback(() => {
    writeStored(null);
    api.setToken(null);
    setUser(null);
    setGym(null);
    setApprovalsWaiting(0);
    setState('signed-out');
  }, [api]);
  signOutRef.current = signOut;

  const signIn = useCallback(
    (token: string, u: AuthUser) => {
      writeStored({ token, user: u });
      api.setToken(token);
      setUser(u);
      setState('signed-in');
    },
    [api],
  );

  // Restore the session, then confirm the token and refresh the user.
  useEffect(() => {
    const stored = readStored();
    if (!stored) {
      setState('signed-out');
      return;
    }
    api.setToken(stored.token);
    setUser(stored.user);
    setState('signed-in');
    api
      .me()
      .then((me) => {
        if (me.role === 'member') return signOut();
        setUser(me);
        writeStored({ token: stored.token, user: me });
      })
      .catch(() => {
        // 401 signs out through onUnauthorized; offline keeps the stored session.
      });
  }, [api, signOut]);

  // Gym name and brand colour (§6 sidebar shows the gym name; §12 brand colour on primary buttons).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getGym(user.gymId).then((g) => !cancelled && setGym(g)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, user]);

  useEffect(() => {
    if (gym?.primaryColor) applyBrandColor(gym.primaryColor);
  }, [gym]);

  // §11: "Admin shows an Offline chip".
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // §6: "a red count on Fees when approvals are waiting".
  const refreshApprovals = useCallback(() => {
    if (!user || !isStaffDesk(user.role)) return;
    Promise.all([api.paymentProofs('pending'), api.freezeRequests('pending')])
      .then(([p, f]) => setApprovalsWaiting(p.length + f.length))
      .catch(() => {});
  }, [api, user]);

  useEffect(() => {
    refreshApprovals();
    if (!user || !isStaffDesk(user.role)) return;
    const id = window.setInterval(refreshApprovals, APPROVALS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshApprovals, user]);

  const value: SessionValue = {
    state,
    api,
    user,
    gym,
    online: browserOnline && reachable,
    approvalsWaiting,
    refreshApprovals,
    signIn,
    signOut,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * §12: the gym's brand colour replaces black on primary buttons and the active item.
 * Text on it is white or near-black, whichever has more contrast (§11: at least 4.5:1).
 */
export function applyBrandColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const onWhite = 1.05 / (lum + 0.05);
  const onDark = (lum + 0.05) / (0.0098 + 0.05); // #17191C
  const root = document.documentElement.style;
  root.setProperty('--brand', `#${m[1]}`);
  root.setProperty('--brand-text', onWhite >= onDark ? '#FFFFFF' : '#17191C');
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

/** The signed-in user; only call inside the signed-in admin shell. */
export function useUser(): AuthUser {
  const { user } = useSession();
  if (!user) throw new Error('useUser called while signed out');
  return user;
}
