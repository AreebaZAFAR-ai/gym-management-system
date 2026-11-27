'use client';

import type { MemberListItem, MembershipStatus } from '@gym/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MemberTable } from '@/components/MemberTable';
import { ErrorBox, Loading, PageHead, Segmented } from '@/components/ui';
import { csvCell, formatPhone } from '@/lib/format';
import { useDebounced, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';
import { pkToday } from '@gym/shared';

type Filter = MembershipStatus | 'all';
const FILTERS: Filter[] = ['all', 'active', 'due_soon', 'overdue', 'frozen'];

/**
 * §6 Members (reception, owner): search by name, ID or phone; filter All, Active,
 * Due soon, Overdue, Frozen with counts; export CSV; row opens the member page.
 */
export default function MembersPage() {
  const { api } = useSession();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const q = useDebounced(query.trim(), 250);
  const { data, error, loading, reload } = useLoad(() => api.members(q ? { q } : undefined), [api, q]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, due_soon: 0, overdue: 0, frozen: 0 };
    for (const m of data ?? []) {
      c.all++;
      c[m.status]++;
    }
    return c;
  }, [data]);

  const shown = useMemo(() => (data ?? []).filter((m) => filter === 'all' || m.status === filter), [data, filter]);

  return (
    <>
      <PageHead
        title={t.members.title}
        actions={
          <>
            <button type="button" className="btn" disabled={!shown.length} onClick={() => exportCsv(shown)}>
              {t.members.exportCsv}
            </button>
            <Link className="btn primary" href="/members/new">
              {t.members.addMember}
            </Link>
          </>
        }
      />
      <div className="spread" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 420 }}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.members.searchPlaceholder}
          aria-label={t.members.searchPlaceholder}
        />
        <Segmented
          label={t.common.status}
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f,
            label: f === 'all' ? t.common.all : t.labels.status[f],
            count: counts[f],
          }))}
        />
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      <div className="card flush">
        {loading && !data ? <Loading /> : <MemberTable members={shown} empty={t.members.noMatch} />}
      </div>
    </>
  );
}

function exportCsv(rows: MemberListItem[]) {
  const lines = [
    t.members.csvHeader.map(csvCell).join(','),
    ...rows.map((m) =>
      [
        m.code,
        m.name,
        formatPhone(m.phone),
        m.planName,
        m.planTiming ?? '',
        m.feePkr,
        m.dueOn,
        t.labels.status[m.status],
        m.active ? t.members.accountEnabled : t.common.disabled,
        m.trainerName ?? '',
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  // BOM so Excel opens the file as UTF-8.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = t.members.csvFile(pkToday());
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
