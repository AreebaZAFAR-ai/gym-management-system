'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { homeFor } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/** Header buttons: Log in + Register, or Open dashboard when already signed in. */
export function LandingActions() {
  const { state, user } = useSession();
  if (state === 'signed-in' && user) {
    return (
      <Link className="btn primary" href={homeFor(user.role)}>
        {t.landing.openDashboard}
      </Link>
    );
  }
  return (
    <>
      <Link className="btn ghost lp-login" href="/login">
        {t.landing.login}
      </Link>
      <Link className="btn primary" href="/register">
        {t.landing.register}
      </Link>
    </>
  );
}

/** Mobile menu toggle for the landing header. */
export function LandingMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);
  return (
    <>
      <button
        type="button"
        className="btn icon ghost lp-menu-btn"
        aria-expanded={open}
        aria-controls="lp-mobile-nav"
        aria-label={open ? t.common.close : t.shell.menu}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id="lp-mobile-nav" className="lp-mobile-nav" data-open={open} onClick={() => setOpen(false)}>
        <a href="#features">{t.landing.navFeatures}</a>
        <a href="#roles">{t.landing.navRoles}</a>
        <a href="#how">{t.landing.navHow}</a>
        <div className="lp-mobile-actions">
          <LandingActions />
        </div>
      </nav>
    </>
  );
}

export type IconName = 'fees' | 'qr' | 'finger' | 'approve' | 'chat' | 'dumbbell' | 'phone' | 'chart' | 'shield' | 'check' | 'arrow';

const PATHS: Record<IconName, string> = {
  fees: 'M3 7h18v10H3zM3 11h18M7 15h3',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2',
  finger: 'M12 3a7 7 0 0 0-7 7v2M19 10a7 7 0 0 0-3-5.7M8 21c1-2 1.5-4 1.5-7a2.5 2.5 0 0 1 5 0c0 2-.2 3.6-.6 5M12 14c0 3-.5 5-1.5 7M17.5 13c0 2.5-.3 4.5-.8 6',
  approve: 'M5 4h10l4 4v12H5zM15 4v4h4M9 14l2 2 4-4',
  chat: 'M4 20l1.5-4A8 8 0 1 1 9 19.5zM9 10h6M9 13h4',
  dumbbell: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12',
  phone: 'M7 3h10v18H7zM11 18h2',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
  check: 'M5 12l5 5L20 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
