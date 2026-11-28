'use client';

import { Bars, HBars } from '@/components/Bars';
import { MemberTable } from '@/components/MemberTable';
import { ErrorBox, Loading, PageHead } from '@/components/ui';
import { formatMonth, formatPKR, formatShortDate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Reports (owner): fees by month (last 6), check-ins by hour, daily check-ins
 * (last 30 days), this month by payment method, and "might quit": paid-up members
 * with no visit in 14 days.
 */
export default function ReportsPage() {
  const { api } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.reports(), [api]);

  return (
    <>
      <PageHead title={t.reports.title} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="stack">
          <div className="grid-2">
            <div className="card">
              <h2 className="section-title">{t.reports.feesByMonth}</h2>
              <Bars
                caption={t.reports.feesByMonth}
                emptyText={t.reports.noData}
                data={data.feesByMonth.map((m) => ({
                  key: m.month,
                  label: formatMonth(m.month).split(' ')[0]!,
                  value: m.totalPkr,
                  display: formatPKR(m.totalPkr),
                }))}
              />
            </div>
            <div className="card">
              <h2 className="section-title">{t.reports.byMethod}</h2>
              <HBars
                caption={t.reports.byMethod}
                emptyText={t.reports.noData}
                data={data.thisMonthByMethod.map((m) => ({
                  key: m.method,
                  label: PAYMENT_METHOD_LABELS[m.method],
                  value: m.totalPkr,
                  display: formatPKR(m.totalPkr),
                }))}
              />
            </div>
          </div>
          <div className="card">
            <h2 className="section-title">{t.reports.dailyCheckins}</h2>
            <Bars
              caption={t.reports.dailyCheckins}
              emptyText={t.reports.noData}
              labelEvery={5}
              data={data.dailyCheckins.map((d) => ({
                key: d.date,
                label: formatShortDate(d.date),
                value: d.count,
                display: t.reports.checkinsCount(d.count),
              }))}
            />
          </div>
          <div className="card">
            <h2 className="section-title">{t.reports.checkinsByHour}</h2>
            <Bars
              caption={t.reports.checkinsByHour}
              emptyText={t.reports.noData}
              labelEvery={3}
              data={data.checkinsByHour.map((h) => ({
                key: String(h.hour),
                label: t.reports.hour(h.hour),
                value: h.count,
                display: t.reports.checkinsCount(h.count),
              }))}
            />
          </div>
          <div className="card flush">
            <div className="card-head">
              <div>
                <h2>{t.reports.mightQuit}</h2>
                <div className="small muted">{t.reports.mightQuitHint}</div>
              </div>
            </div>
            <MemberTable members={data.mightQuit} empty={t.reports.noneMightQuit} />
          </div>
        </div>
      ) : null}
    </>
  );
}
