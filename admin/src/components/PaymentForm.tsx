'use client';

import type { PaymentMethod, RecordPaymentResponse } from '@gym/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { PAYMENT_METHOD_LABELS, parseAmount } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';
import { Field, FormError, Segmented } from './ui';

export const METHODS: PaymentMethod[] = ['cash', 'jazzcash', 'easypaisa', 'bank'];
export const methodOptions = METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

/**
 * §5.1/§6 take-payment form: amount pre-filled with the plan fee, method
 * Cash/JazzCash/Easypaisa/Bank, optional transaction ID. The server applies §7
 * (period, new due date, clears a freeze, queues the WhatsApp receipt).
 */
export function PaymentForm({
  memberCode,
  defaultAmount,
  onSaved,
  submitLabel = t.payment.submit,
  extraActions,
}: {
  memberCode: string;
  defaultAmount: number;
  onSaved: (res: RecordPaymentResponse) => void;
  submitLabel?: string;
  extraActions?: ReactNode;
}) {
  const { api } = useSession();
  const [amount, setAmount] = useState(String(defaultAmount));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [txnId, setTxnId] = useState('');
  const { busy, error, setError, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountPkr = parseAmount(amount);
    if (amountPkr === null) return setError(t.payment.amountInvalid);
    const res = await run(() => api.recordPayment({ memberCode, amountPkr, method, txnId: txnId.trim() || null }));
    if (res) onSaved(res);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label={t.payment.amount} htmlFor="pay-amount">
          <input id="pay-amount" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={`${t.payment.txnId} (${t.common.optional})`} htmlFor="pay-txn">
          <input id="pay-txn" className="input" value={txnId} onChange={(e) => setTxnId(e.target.value)} autoComplete="off" />
        </Field>
        <div className="field full">
          <span className="label">{t.payment.method}</span>
          <Segmented label={t.payment.method} value={method} options={methodOptions} onChange={setMethod} />
        </div>
      </div>
      <FormError message={error} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t.payment.submitting : submitLabel}
        </button>
        {extraActions}
      </div>
    </form>
  );
}
