'use client';

import type { MemberDetail, RecordPaymentResponse } from '@gym/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { formatPKR, formatPhone, formatShortDate } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';
import { PaymentForm } from './PaymentForm';
import { Dialog, Field, FormError, StatusPill } from './ui';

/** §6 "Record payment dialog": find the member by ID, then the take-payment form. */
export function RecordPaymentDialog({
  initialCode,
  onClose,
  onSaved,
}: {
  initialCode?: string;
  onClose: () => void;
  onSaved?: (res: RecordPaymentResponse) => void;
}) {
  const { api } = useSession();
  const [code, setCode] = useState(initialCode ?? '');
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [done, setDone] = useState<RecordPaymentResponse | null>(null);
  const find = useAction();

  async function lookup(value: string) {
    const c = value.trim().toUpperCase();
    if (!c) return find.setError(t.payment.codeRequired);
    setMember(null);
    const m = await find.run(() => api.member(c));
    if (m) setMember(m);
  }

  useEffect(() => {
    if (initialCode) void lookup(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmitFind(e: FormEvent) {
    e.preventDefault();
    void lookup(code);
  }

  return (
    <Dialog title={t.payment.title} onClose={onClose}>
      {done ? (
        <>
          <div className="banner ok" role="status">
            {done.message}
          </div>
          <div className="row">
            <button type="button" className="btn primary" onClick={onClose}>
              {t.common.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <form className="row" onSubmit={onSubmitFind} style={{ alignItems: 'flex-end' }}>
            <Field label={t.payment.memberCode} htmlFor="pay-code" className="grow">
              <input
                id="pay-code"
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="IH-0412"
                autoComplete="off"
              />
            </Field>
            <button type="submit" className="btn" disabled={find.busy}>
              {t.payment.find}
            </button>
          </form>
          <FormError message={find.error} />
          {member ? (
            <>
              <div className="card" style={{ padding: 16 }}>
                <div className="spread">
                  <div>
                    <div className="cell-main">
                      {member.name} · {member.code}
                    </div>
                    <div className="cell-sub">
                      {member.planName} · {formatPKR(member.feePkr)} · {formatPhone(member.phone)}
                    </div>
                  </div>
                  <div className="row">
                    {member.dueOn ? <span className="small muted">{t.payment.dueNow(formatShortDate(member.dueOn))}</span> : null}
                    <StatusPill status={member.status} />
                  </div>
                </div>
              </div>
              <PaymentForm
                key={member.code}
                memberCode={member.code}
                defaultAmount={member.feePkr}
                onSaved={(res) => {
                  setDone(res);
                  onSaved?.(res);
                }}
              />
            </>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
