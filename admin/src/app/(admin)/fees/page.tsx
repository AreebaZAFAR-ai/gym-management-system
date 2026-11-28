'use client';

import {
  addDays,
  pkToday,
  type FreezeRequestItem,
  type PaymentMethod,
  type PaymentProofItem,
} from '@gym/shared';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { METHODS, methodOptions } from '@/components/PaymentForm';
import { useDesk } from '@/components/Shell';
import { Confirm, Empty, ErrorBox, Field, FormError, Loading, PageHead, Segmented } from '@/components/ui';
import {
  formatPKR,
  formatPkDateTime,
  formatShortDate,
  monthRange,
  parseAmount,
  PAYMENT_METHOD_LABELS,
} from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

type Period = 'today' | 'month' | 'last';

/**
 * §6 Fees and payments (reception, owner). Approvals first: payment screenshots
 * (image, editable amount and method, Approve and renew, Reject) and freeze requests
 * (days, reason, old and new due date, Approve, Reject). Then payments for Today,
 * This month or Last month with totals per method and a table. Record payment dialog.
 */
export default function FeesPage() {
  const { api, refreshApprovals } = useSession();
  const { openPayment, notify } = useDesk();
  const proofs = useLoad(() => api.paymentProofs('pending'), [api]);
  const freezes = useLoad(() => api.freezeRequests('pending'), [api]);
  const [period, setPeriod] = useState<Period>('today');
  const range = useMemo(() => periodRange(period), [period]);
  const payments = useLoad(() => api.payments(range), [api, range]);
  const members = useLoad(() => api.members(), [api]);
  const staff = useLoad(() => api.staff(), [api]);

  const memberById = useMemo(() => new Map((members.data ?? []).map((m) => [m.memberId, m])), [members.data]);
  const staffById = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.name])), [staff.data]);

  const totals = useMemo(() => {
    const byMethod = new Map<PaymentMethod, number>(METHODS.map((m) => [m, 0]));
    let all = 0;
    for (const p of payments.data ?? []) {
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountPkr);
      all += p.amountPkr;
    }
    return { byMethod, all };
  }, [payments.data]);

  function afterChange(message?: string) {
    proofs.reload();
    freezes.reload();
    payments.reload();
    members.reload();
    refreshApprovals();
    if (message) notify(message);
  }

  return (
    <>
      <PageHead
        title={t.fees.title}
        actions={
          <button type="button" className="btn primary" onClick={() => openPayment(undefined, () => afterChange())}>
            {t.fees.recordPayment}
          </button>
        }
      />
      <div className="stack">
        <h2 className="section-title" style={{ margin: 0 }}>
          {t.fees.approvals}
        </h2>
        <div className="card flush">
          <div className="card-head">
            <h2>{t.fees.screenshots}</h2>
            {proofs.data?.length ? <span className="badge">{proofs.data.length}</span> : null}
          </div>
          {proofs.error ? <ErrorBox message={proofs.error} onRetry={proofs.reload} /> : null}
          {proofs.loading && !proofs.data ? (
            <Loading />
          ) : proofs.data?.length ? (
            proofs.data.map((p) => (
              <ProofRow key={p.id} proof={p} onDone={afterChange} onImageExpired={proofs.reload} />
            ))
          ) : (
            <Empty>{t.fees.noScreenshots}</Empty>
          )}
        </div>

        <div className="card flush">
          <div className="card-head">
            <h2>{t.fees.freezes}</h2>
            {freezes.data?.length ? <span className="badge">{freezes.data.length}</span> : null}
          </div>
          {freezes.error ? <ErrorBox message={freezes.error} onRetry={freezes.reload} /> : null}
          {freezes.loading && !freezes.data ? (
            <Loading />
          ) : freezes.data?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.common.member}</th>
                    <th>{t.fees.reason}</th>
                    <th>{t.fees.oldDue}</th>
                    <th>{t.fees.newDue}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {freezes.data.map((f) => (
                    <FreezeRow key={f.id} freeze={f} onDone={afterChange} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t.fees.noFreezes}</Empty>
          )}
        </div>

        <div className="spread" style={{ marginTop: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            {t.fees.payments}
          </h2>
          <Segmented
            label={t.fees.payments}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'today', label: t.fees.periodToday },
              { value: 'month', label: t.fees.periodMonth },
              { value: 'last', label: t.fees.periodLastMonth },
            ]}
          />
        </div>
        <div className="stat-grid">
          <div className="card stat">
            <div className="stat-label">{t.fees.totalAll}</div>
            <div className="stat-value">{formatPKR(totals.all)}</div>
          </div>
          {METHODS.map((m) => (
            <div key={m} className="card stat">
              <div className="stat-label">{PAYMENT_METHOD_LABELS[m]}</div>
              <div className="stat-value" style={{ fontSize: 32 }}>
                {formatPKR(totals.byMethod.get(m) ?? 0)}
              </div>
            </div>
          ))}
        </div>
        <div className="card flush">
          {payments.error ? <ErrorBox message={payments.error} onRetry={payments.reload} /> : null}
          {payments.loading && !payments.data ? (
            <Loading />
          ) : payments.data?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.fees.colWhen}</th>
                    <th>{t.fees.colMember}</th>
                    <th className="num">{t.fees.colAmount}</th>
                    <th>{t.fees.colMethod}</th>
                    <th>{t.fees.colTxn}</th>
                    <th>{t.fees.colPeriod}</th>
                    <th>{t.fees.colBy}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.map((p) => {
                    const m = memberById.get(p.memberId);
                    return (
                      <tr key={p.id}>
                        <td>{formatPkDateTime(p.createdAt)}</td>
                        <td>
                          {m ? (
                            <Link href={`/members/${encodeURIComponent(m.code)}`}>
                              <span className="cell-main">{m.name}</span> <span className="cell-sub">{m.code}</span>
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">{formatPKR(p.amountPkr)}</td>
                        <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                        <td>{p.txnId || '—'}</td>
                        <td>{t.member.period(formatShortDate(p.periodFrom), formatShortDate(p.periodTo))}</td>
                        <td>
                          {staffById.get(p.recordedBy) ?? '—'}
                          {p.proofId ? <div className="cell-sub">{t.fees.fromScreenshot}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t.fees.noPayments}</Empty>
          )}
        </div>
      </div>
    </>
  );
}

function periodRange(period: Period): { from: string; to: string } {
  const today = pkToday();
  if (period === 'today') return { from: today, to: today };
  if (period === 'month') return monthRange(today);
  return monthRange(addDays(monthRange(today).from, -1));
}

function ProofRow({
  proof,
  onDone,
  onImageExpired,
}: {
  proof: PaymentProofItem;
  onDone: (message?: string) => void;
  onImageExpired: () => void;
}) {
  const { api } = useSession();
  const [amount, setAmount] = useState(String(proof.feePkr));
  const [method, setMethod] = useState<PaymentMethod>('jazzcash');
  const [confirmReject, setConfirmReject] = useState(false);
  const { busy, error, setError, run } = useAction();
  const retried = useRef(false);
  const src = api.absolute(proof.imageUrl);

  async function approve() {
    const amountPkr = parseAmount(amount);
    if (amountPkr === null) return setError(t.payment.amountInvalid);
    const res = await run(() => api.approveProof(proof.id, { amountPkr, method }));
    if (res) onDone(res.message);
  }

  async function reject() {
    const res = await run(() => api.rejectProof(proof.id));
    if (res) {
      setConfirmReject(false);
      onDone();
    }
  }

  return (
    <div className="proof">
      <a href={src} target="_blank" rel="noreferrer" aria-label={t.fees.openImage}>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link from the API */}
        <img
          src={src}
          alt={t.fees.imageAlt(proof.memberName)}
          onError={() => {
            // Signed links last 15 minutes; fetch fresh ones once.
            if (!retried.current) {
              retried.current = true;
              onImageExpired();
            }
          }}
        />
      </a>
      <div className="stack" style={{ gap: 12 }}>
        <div>
          <Link href={`/members/${encodeURIComponent(proof.memberCode)}`} className="cell-main">
            {proof.memberName}
          </Link>{' '}
          <span className="cell-sub">
            {proof.memberCode} · {t.fees.uploaded} {formatPkDateTime(proof.createdAt)}
          </span>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t.payment.amount} htmlFor={`amt-${proof.id}`}>
            <input
              id={`amt-${proof.id}`}
              className="input mono"
              style={{ maxWidth: 160 }}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <div className="field">
            <span className="label">{t.payment.method}</span>
            <Segmented label={t.payment.method} value={method} options={methodOptions} onChange={setMethod} />
          </div>
        </div>
        {!confirmReject ? <FormError message={error} /> : null}
        <div className="row">
          <button type="button" className="btn success" disabled={busy} onClick={approve}>
            {t.fees.approveRenew}
          </button>
          <button type="button" className="btn danger-ghost" disabled={busy} onClick={() => setConfirmReject(true)}>
            {t.fees.reject}
          </button>
        </div>
      </div>
      {confirmReject ? (
        <Confirm
          message={t.fees.rejectProofConfirm}
          confirmLabel={t.fees.reject}
          danger
          busy={busy}
          error={error}
          onConfirm={reject}
          onCancel={() => {
            setError(null);
            setConfirmReject(false);
          }}
        />
      ) : null}
    </div>
  );
}

function FreezeRow({ freeze: f, onDone }: { freeze: FreezeRequestItem; onDone: (message?: string) => void }) {
  const { api } = useSession();
  const [confirmReject, setConfirmReject] = useState(false);
  const { busy, error, setError, run } = useAction();

  async function approve() {
    const res = await run(() => api.approveFreeze(f.id));
    if (res) onDone();
  }
  async function reject() {
    const res = await run(() => api.rejectFreeze(f.id));
    if (res) {
      setConfirmReject(false);
      onDone();
    }
  }

  return (
    <tr>
      <td>
        <Link href={`/members/${encodeURIComponent(f.memberCode)}`} className="cell-main">
          {f.memberName}
        </Link>
        <div className="cell-sub">
          {f.memberCode} · {formatPkDateTime(f.createdAt)}
        </div>
      </td>
      <td>
        {t.fees.days(f.days)} · {t.labels.freezeReason[f.reason]}
      </td>
      <td className="mono">{formatShortDate(f.dueOn)}</td>
      <td className="mono">{formatShortDate(f.newDueOn)}</td>
      <td>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn small success" disabled={busy} onClick={approve}>
            {t.fees.approve}
          </button>
          <button type="button" className="btn small danger-ghost" disabled={busy} onClick={() => setConfirmReject(true)}>
            {t.fees.reject}
          </button>
        </div>
        {!confirmReject && error ? <div className="field-error">{error}</div> : null}
        {confirmReject ? (
          <Confirm
            message={t.fees.rejectFreezeConfirm}
            confirmLabel={t.fees.reject}
            danger
            busy={busy}
            error={error}
            onConfirm={reject}
            onCancel={() => {
              setError(null);
              setConfirmReject(false);
            }}
          />
        ) : null}
      </td>
    </tr>
  );
}
