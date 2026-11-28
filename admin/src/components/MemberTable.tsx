'use client';

import type { MemberListItem } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { formatPKR, formatPhone, formatShortDate } from '@/lib/format';
import { t } from '@/lib/strings';
import { Empty, StatusPill } from './ui';

/** §6 Members columns: member, phone, plan and timing, fee, due date, status. Row opens the member page. */
export function MemberTable({ members, empty }: { members: MemberListItem[]; empty?: string }) {
  const router = useRouter();
  if (!members.length) return <Empty>{empty}</Empty>;
  const open = (code: string) => router.push(`/members/${encodeURIComponent(code)}`);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t.members.colMember}</th>
            <th>{t.members.colPhone}</th>
            <th>{t.members.colPlan}</th>
            <th className="num">{t.members.colFee}</th>
            <th>{t.members.colDue}</th>
            <th>{t.members.colStatus}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.memberId}
              className="clickable"
              tabIndex={0}
              onClick={() => open(m.code)}
              onKeyDown={(e) => e.key === 'Enter' && open(m.code)}
            >
              <td>
                <div className="cell-main">{m.name}</div>
                <div className="cell-sub">{m.code}</div>
              </td>
              <td className="mono">{formatPhone(m.phone)}</td>
              <td>
                <div>{m.planName}</div>
                {m.planTiming ? <div className="cell-sub">{m.planTiming}</div> : null}
              </td>
              <td className="num">{formatPKR(m.feePkr)}</td>
              <td className="mono">{formatShortDate(m.dueOn)}</td>
              <td>
                <div className="row" style={{ gap: 6 }}>
                  <StatusPill status={m.status} />
                  {!m.active ? <span className="chip disabled">{t.common.disabled}</span> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
