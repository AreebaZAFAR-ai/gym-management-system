import type { Role } from '@gym/shared';
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { useSession } from './session';

/** Each role lands on its own screens (spec §5). Owners use the reception tools on mobile. */
export function homeFor(role: Role): '/progress' | '/reception' | '/trainer' {
  if (role === 'member') return '/progress';
  if (role === 'trainer') return '/trainer';
  return '/reception';
}

/** Keeps each role inside its own screens; anyone else goes back to the start. */
export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { state } = useSession();
  if (state.status !== 'signedIn') return <Redirect href="/login" />;
  if (!roles.includes(state.user.role)) return <Redirect href={homeFor(state.user.role)} />;
  return <>{children}</>;
}
