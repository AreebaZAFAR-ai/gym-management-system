import type { Role } from '@gym/shared';
import { t } from './strings';

export type NavGroup = 'top' | 'members' | 'money' | 'marketing' | 'team' | 'settings';

export interface NavPage {
  href: string;
  label: string;
  group: NavGroup;
  roles: readonly Role[];
}

const RO = ['reception', 'owner'] as const;
const TO = ['trainer', 'owner'] as const;
const O = ['owner'] as const;

/** §6 sidebar: Overview · MEMBERS · MONEY · MARKETING · TEAM · SETTINGS, with the roles of each page. */
export const NAV: readonly NavPage[] = [
  { href: '/overview', label: t.nav.overview, group: 'top', roles: RO },
  { href: '/members', label: t.nav.members, group: 'members', roles: RO },
  { href: '/checkins', label: t.nav.checkins, group: 'members', roles: RO },
  { href: '/training', label: t.nav.training, group: 'members', roles: TO },
  { href: '/fees', label: t.nav.fees, group: 'money', roles: RO },
  { href: '/reports', label: t.nav.reports, group: 'money', roles: O },
  { href: '/whatsapp', label: t.nav.whatsapp, group: 'marketing', roles: RO },
  { href: '/announcements', label: t.nav.announcements, group: 'marketing', roles: RO },
  { href: '/staff', label: t.nav.staff, group: 'team', roles: O },
  { href: '/fee-plans', label: t.nav.feePlans, group: 'team', roles: O },
  { href: '/settings', label: t.nav.settings, group: 'settings', roles: O },
];

export const GROUP_ORDER: readonly NavGroup[] = ['top', 'members', 'money', 'marketing', 'team', 'settings'];

/** The page a pathname belongs to (sub-pages like /members/IH-0412 belong to /members). */
export function pageFor(pathname: string): NavPage | undefined {
  return NAV.filter((p) => pathname === p.href || pathname.startsWith(`${p.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function canOpen(role: Role, pathname: string): boolean {
  const page = pageFor(pathname);
  return !!page && page.roles.includes(role);
}

/** Where a role lands after login. */
export function homeFor(role: Role): string {
  return NAV.find((p) => p.roles.includes(role))?.href ?? '/overview';
}

export const isStaffDesk = (role: Role) => role === 'reception' || role === 'owner';
