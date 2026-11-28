'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { API_URL, useSession } from '@/lib/session';
import { t } from '@/lib/strings';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state === 'signed-out') router.replace('/login');
  }, [state, router]);

  if (!API_URL) return <div className="center-page">{t.common.notConfigured}</div>;
  if (state !== 'signed-in') return <div className="center-page">{t.common.loading}</div>;
  return <Shell>{children}</Shell>;
}
