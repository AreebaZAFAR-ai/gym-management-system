'use client';

import { addDays, pkToday, type RecordPaymentResponse, type ScanResult } from '@gym/shared';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PaymentForm } from '@/components/PaymentForm';
import { Empty, ErrorBox, Loading, PageHead } from '@/components/ui';
import { formatDue, formatPKR, formatPhone, formatPkTime, formatShortDate } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Check-ins (reception, owner): box for a member ID or a USB QR scanner (the
 * scanner types the code and presses Enter). Allowed/blocked result with the
 * take-payment form when blocked. Day log with time, member, source, allowed or
 * blocked; previous day navigation.
 */
export default function CheckinsPage() {
  const { api, refreshApprovals } = useSession();
  const today = pkToday();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [renewed, setRenewed] = useState<RecordPaymentResponse | null>(null);
  const [date, setDate] = useState(today);
  const inputRef = useRef<HTMLInputElement>(null);
  const scan = useAction();
  const log = useLoad(() => api.checkins(date), [api, date]);
  const staff = useLoad(() => api.staff(), [api]);
  const names = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.name])), [staff.data]);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setRenewed(null);
    const res = await scan.run(() => api.scan(value));
    setCode('');
    inputRef.current?.focus();
    if (res) {
      setResult(res);
      if (date === today) log.reload();
    }
  }

  function onPaid(res: RecordPaymentResponse) {
    setRenewed(res);
    refreshApprovals();
    inputRef.current?.focus();
  }

  return (
    <>
      <PageHead title={t.checkins.title} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <form onSubmit={submit} className="stack">
            <label htmlFor="scan" className="section-title" style={{ margin: 0 }}>
              {t.checkins.inputLabel}
            </label>
            <div className="row">
              <input
                id="scan"
                ref={inputRef}
                className="input scan-input grow"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="IH-0412"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
              />
              <button type="submit" className="btn primary big" disabled={scan.busy || !code.trim()}>
                {t.checkins.submit}
              </button>
            </div>
            <div className="small muted">{t.checkins.inputHint}</div>
          </form>
          {scan.error ? <ErrorBox message={scan.error} /> : null}
        </div>

        <div>{result ? <ScanResultCard result={result} renewed={renewed} onPaid={onPaid} /> : null}</div>
      </div>

      <div className="card flush" style={{ marginTop: 20 }}>
        <div className="card-head">
          <h2>
            {t.checkins.log} · {date === today ? t.common.today : formatShortDate(date)}
          </h2>
          <div className="row">
            <button type="button" className="btn small" onClick={() => setDate(addDays(date, -1))}>
              ← {t.common.previousDay}
            </button>
            <button type="button" className="btn small" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
              {t.common.nextDay} →
            </button>
          </div>
        </div>
        {log.error ? <ErrorBox message={log.error} onRetry={log.reload} /> : null}
        {log.loading && !log.data ? (
          <Loading />
        ) : log.data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.checkins.colTime}</th>
                  <th>{t.checkins.colMember}</th>
                  <th>{t.checkins.colSource}</th>
                  <th>{t.checkins.colResult}</th>
                  <th>{t.checkins.colBy}</th>
                </tr>
              </thead>
              <tbody>
                {log.data.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{formatPkTime(c.createdAt)}</td>
                    <td>
                      {c.memberCode ? (
                        <Link href={`/members/${encodeURIComponent(c.memberCode)}`}>
                          <span className="cell-main">{c.memberName}</span> <span className="cell-sub">{c.memberCode}</span>
                        </Link>
                      ) : (
                        <span className="muted">{t.checkins.unknownMember}</span>
                      )}
                    </td>
                    <td>{t.labels.source[c.source]}</td>
                    <td>
                      <span className={`chip ${c.allowed ? 'allowed' : 'blocked'}`}>
                        {c.allowed ? t.checkins.allowedShort : t.checkins.blockedShort}
                      </span>
                      {!c.allowed && c.reason ? <div className="cell-sub">{c.reason}</div> : null}
                    </td>
                    <td>{c.scannedBy ? names.get(c.scannedBy) ?? '—' : t.checkins.device}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{t.checkins.noCheckins}</Empty>
        )}
      </div>
    </>
  );
}

function ScanResultCard({
  result,
  renewed,
  onPaid,
}: {
  result: ScanResult;
  renewed: RecordPaymentResponse | null;
  onPaid: (res: RecordPaymentResponse) => void;
}) {
  if (!result.ok) {
    return (
      <div className="result unusable" role="alert">
        <div className="cell-main">{result.message}</div>
      </div>
    );
  }
  const m = result.member;
  // §5.1: after payment "the result turns green".
  const allowed = result.allowed || !!renewed;
  return (
    <div className="stack">
      <div className={`result ${allowed ? 'allowed' : 'blocked'}`} role="status">
        <div className="result-title">{allowed ? t.checkins.allowed : t.checkins.blocked}</div>
        <div style={{ marginTop: 8, fontWeight: 600 }}>
          {renewed ? renewed.message : !result.allowed ? result.message : null}
          {!renewed && !result.allowed && result.amountDue ? `, ${formatPKR(result.amountDue)}` : null}
        </div>
      </div>
      <div className="card">
        <div className="cell-main" style={{ fontSize: 18 }}>
          {m.name}
        </div>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>{t.payment.memberCode}</dt>
          <dd>
            <Link href={`/members/${encodeURIComponent(m.code)}`}>{m.code}</Link>
          </dd>
          <dt>{t.common.plan}</dt>
          <dd>{m.planName}</dd>
          <dt>{t.common.phone}</dt>
          <dd className="mono">{formatPhone(m.phone)}</dd>
          <dt>{t.member.due}</dt>
          <dd>{formatDue(renewed?.newDueOn ?? m.dueOn)}</dd>
        </dl>
      </div>
      {!result.allowed && !renewed ? (
        <div className="card">
          <h2 className="section-title">{t.checkins.takePayment}</h2>
          <PaymentForm key={m.code} memberCode={m.code} defaultAmount={result.amountDue ?? m.feePkr} onSaved={onPaid} />
        </div>
      ) : null}
    </div>
  );
}
