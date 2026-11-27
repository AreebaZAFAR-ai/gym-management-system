'use client';

import Link from 'next/link';
import { MemberTable } from '@/components/MemberTable';
import { useDesk } from '@/components/Shell';
import { ErrorBox, Loading, PageHead, Stat } from '@/components/ui';
import { formatPKR } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Overview (reception, owner): active members, joined this month, check-ins today,
 * fees collected this month, overdue count and PKR to collect. Banner when screenshots
 * or freezes wait. Lists: overdue, and due in the next 5 days. Buttons: Check in,
 * Record payment, Add member.
 */
export default function OverviewPage() {
  const { api, refreshApprovals } = useSession();
  const { openPayment } = useDesk();
  const { data, error, loading, reload } = useLoad(() => api.dashboard(), [api]);

  const actions = (
    <>
      <Link className="btn" href="/checkins">
        {t.overview.checkIn}
      </Link>
      <button
        type="button"
        className="btn"
        onClick={() =>
          openPayment(undefined, () => {
            reload();
            refreshApprovals();
          })
        }
      >
        {t.overview.recordPayment}
      </button>
      <Link className="btn primary" href="/members/new">
        {t.overview.addMember}
      </Link>
    </>
  );

  return (
    <>
      <PageHead title={t.overview.title} actions={actions} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="stack">
          {data.pendingProofs + data.pendingFreezes > 0 ? (
            <div className="banner" role="status">
              <span>{t.overview.waitingBanner(data.pendingProofs, data.pendingFreezes)}</span>
              <Link className="btn small" href="/fees">
                {t.overview.review}
              </Link>
            </div>
          ) : null}
          <div className="stat-grid">
            <Stat label={t.overview.activeMembers} value={data.activeMembers} />
            <Stat label={t.overview.joinedThisMonth} value={data.joinedThisMonth} />
            <Stat label={t.overview.checkinsToday} value={data.checkinsToday} />
            <Stat label={t.overview.feesThisMonth} value={formatPKR(data.feesThisMonthPkr)} />
            <Stat
              label={t.overview.overdue}
              value={data.overdueCount}
              sub={t.overview.toCollect(formatPKR(data.overduePkr))}
              danger={data.overdueCount > 0}
            />
          </div>
          <div className="card flush">
            <div className="card-head">
              <h2>{t.overview.overdueList}</h2>
            </div>
            <MemberTable members={data.overdue} empty={t.overview.noneOverdue} />
          </div>
          <div className="card flush">
            <div className="card-head">
              <h2>{t.overview.dueSoonList}</h2>
            </div>
            <MemberTable members={data.dueSoon} empty={t.overview.noneDueSoon} />
          </div>
        </div>
      ) : null}
    </>
  );
}
