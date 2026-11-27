'use client';

import type { RecordPaymentResponse } from '@gym/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { canOpen, GROUP_ORDER, homeFor, isStaffDesk, NAV, pageFor, type NavGroup } from '@/lib/nav';
import { useSession, useUser } from '@/lib/session';
import { t } from '@/lib/strings';
import { CommandPalette } from './CommandPalette';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import { Confirm } from './ui';

interface Desk {
  /** Open the Record payment dialog, optionally for a member ID. */
  openPayment: (code?: string, onSaved?: (res: RecordPaymentResponse) => void) => void;
  /** Short message at the bottom of the screen. */
  notify: (message: string) => void;
}

const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const d = useContext(DeskContext);
  if (!d) throw new Error('useDesk must be used inside Shell');
  return d;
}

const GROUP_LABEL: Record<NavGroup, string | null> = {
  top: null,
  members: t.nav.groups.members,
  money: t.nav.groups.money,
  marketing: t.nav.groups.marketing,
  team: t.nav.groups.team,
  settings: t.nav.groups.settings,
};

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser();
  const { gym, online, approvalsWaiting, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [payment, setPayment] = useState<{ code?: string; onSaved?: (res: RecordPaymentResponse) => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const desk = isStaffDesk(user.role);

  // §6: "A search bar at the top opens with Ctrl+K (Cmd+K on Mac)".
  useEffect(() => {
    if (!desk) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desk]);

  useEffect(() => setMenuOpen(false), [pathname]);

  // Trainers have no Overview: send them to their first page.
  useEffect(() => {
    if (pathname === '/overview' && !canOpen(user.role, '/overview')) router.replace(homeFor(user.role));
  }, [pathname, router, user.role]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openPayment = useCallback<Desk['openPayment']>((code, onSaved) => setPayment({ code, onSaved }), []);
  const notify = useCallback((m: string) => setToast(m), []);

  const visible = NAV.filter((p) => p.roles.includes(user.role));
  const current = pageFor(pathname);
  const allowed = canOpen(user.role, pathname);

  return (
    <DeskContext.Provider value={{ openPayment, notify }}>
      <div className="shell">
        {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} /> : null}
        <aside className="sidebar" data-open={menuOpen} aria-label={t.shell.menu}>
          <div className="sidebar-gym">
            <div className="gym-name">{gym?.name ?? user.gymId}</div>
            {gym?.city ? <div className="gym-city">{gym.city}</div> : null}
          </div>
          <nav>
            {GROUP_ORDER.map((group) => {
              const pages = visible.filter((p) => p.group === group);
              if (!pages.length) return null;
              const label = GROUP_LABEL[group];
              return (
                <div key={group}>
                  {label ? <div className="nav-group">{label}</div> : null}
                  {pages.map((p) => (
                    <Link key={p.href} href={p.href} className="nav-link" aria-current={current?.href === p.href ? 'page' : undefined}>
                      <span>{p.label}</span>
                      {p.href === '/fees' && approvalsWaiting > 0 ? (
                        <span className="badge" aria-label={t.shell.approvalsWaiting(approvalsWaiting)}>
                          {approvalsWaiting}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <div className="who">
              <div className="who-name">{user.name}</div>
              <div className="who-role">{t.labels.role[user.role]}</div>
            </div>
            <div className="spread">
              <span className={`chip ${online ? 'online' : 'offline'}`} role="status">
                <span className="dot" aria-hidden />
                {online ? t.common.online : t.common.offline}
              </span>
              <button type="button" className="btn small" onClick={() => setConfirmLogout(true)}>
                {t.shell.logout}
              </button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button type="button" className="btn icon menu-btn" aria-label={t.shell.menu} onClick={() => setMenuOpen(true)}>
              ☰
            </button>
            {desk ? (
              <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
                <span>{t.shell.searchPlaceholder}</span>
                <span className="kbd">{t.shell.searchShortcut}</span>
              </button>
            ) : (
              <div style={{ flex: 1 }} />
            )}
            <span className={`chip ${online ? 'online' : 'offline'}`} aria-hidden>
              <span className="dot" />
              {online ? t.common.online : t.common.offline}
            </span>
          </header>
          <main className="content">
            {!online ? (
              <div className="banner error" role="alert" style={{ marginBottom: 16 }}>
                {t.common.offlineBanner}
              </div>
            ) : null}
            {allowed ? (
              children
            ) : pathname === '/overview' ? (
              <div className="center-page">{t.common.loading}</div>
            ) : (
              <div className="center-page stack" style={{ alignItems: 'center' }}>
                <p>{t.common.noAccess}</p>
                <Link className="btn primary" href={homeFor(user.role)}>
                  {t.common.goHome}
                </Link>
              </div>
            )}
          </main>
        </div>
      </div>

      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
      {payment ? (
        <RecordPaymentDialog
          initialCode={payment.code}
          onClose={() => setPayment(null)}
          onSaved={payment.onSaved}
        />
      ) : null}
      {confirmLogout ? (
        <Confirm
          message={t.shell.logoutConfirm}
          confirmLabel={t.shell.logout}
          onConfirm={() => {
            setConfirmLogout(false);
            signOut();
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </DeskContext.Provider>
  );
}
