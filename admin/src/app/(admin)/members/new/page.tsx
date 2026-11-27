'use client';

import { normalizePhone, pkToday, type Gender, type Goal, type PaymentMethod, type RegisterMemberResponse } from '@gym/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { methodOptions } from '@/components/PaymentForm';
import { CopyButton, ErrorBox, Field, FormError, Loading, PageHead, Segmented } from '@/components/ui';
import { formatPKR, formatShortDate, parseAmount } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

const GOALS: Goal[] = ['strength', 'muscle', 'fat_loss', 'fitness'];
const GENDERS: Gender[] = ['male', 'female', 'other'];

/**
 * §6 Add member (reception, owner). Optional first payment with method: when
 * given, the API records it and queues the receipt; otherwise no payment or receipt.
 * Result shows the member ID and temporary password; the welcome WhatsApp is queued.
 * Duplicate phone is refused by the API.
 */
export default function AddMemberPage() {
  const { api } = useSession();
  const setup = useLoad(() => Promise.all([api.feePlans(), api.staff()]), [api]);
  const [result, setResult] = useState<RegisterMemberResponse | null>(null);
  const [formKey, setFormKey] = useState(0);

  const plans = (setup.data?.[0] ?? []).filter((p) => p.active);
  const trainers = (setup.data?.[1] ?? []).filter((s) => s.role === 'trainer' && s.active);

  return (
    <>
      <PageHead
        title={t.addMember.title}
        actions={
          <Link className="btn" href="/members">
            {t.addMember.back}
          </Link>
        }
      />
      {setup.error ? <ErrorBox message={setup.error} onRetry={setup.reload} /> : null}
      {setup.loading && !setup.data ? <Loading /> : null}
      {result ? (
        <Done
          result={result}
          onAnother={() => {
            setResult(null);
            setFormKey((k) => k + 1);
          }}
        />
      ) : setup.data ? (
        plans.length ? (
          <RegisterForm key={formKey} plans={plans} trainers={trainers} onDone={setResult} />
        ) : (
          <div className="banner">{t.addMember.noPlans}</div>
        )
      ) : null}
    </>
  );
}

function RegisterForm({
  plans,
  trainers,
  onDone,
}: {
  plans: { id: string; name: string; timing: string | null; feePkr: number; months: number }[];
  trainers: { id: string; name: string }[];
  onDone: (r: RegisterMemberResponse) => void;
}) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [joinedOn, setJoinedOn] = useState(pkToday());
  const [goal, setGoal] = useState<Goal | ''>('');
  const [emergency, setEmergency] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [notes, setNotes] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [trainerId, setTrainerId] = useState('');
  const [takePayment, setTakePayment] = useState(false);
  const [amount, setAmount] = useState(String(plans[0]?.feePkr ?? ''));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [txnId, setTxnId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();

  function pickPlan(id: string) {
    setPlanId(id);
    const plan = plans.find((p) => p.id === id);
    if (plan) setAmount(String(plan.feePkr));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t.addMember.nameRequired;
    if (!normalizePhone(phone)) errs.phone = t.addMember.phoneInvalid;
    if (!planId) errs.plan = t.addMember.planRequired;
    const amountPkr = takePayment ? parseAmount(amount) : null;
    if (takePayment && amountPkr === null) errs.amount = t.addMember.amountInvalid;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const res = await run(() =>
      api.registerMember({
        name: name.trim(),
        phone,
        gender: gender || null,
        joinedOn,
        goal: goal || null,
        emergencyContact: emergency.trim() || null,
        fingerprintId: fingerprint.trim() || null,
        notes: notes.trim() || null,
        planId,
        trainerId: trainerId || null,
        // §6: "Optional first payment with method".
        payment: takePayment && amountPkr !== null ? { amountPkr, method, txnId: txnId.trim() || null } : null,
      }),
    );
    if (res) onDone(res);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="card">
        <div className="form-grid">
          <Field label={t.addMember.name} htmlFor="m-name" error={errors.name}>
            <input id="m-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoComplete="off" />
          </Field>
          <Field label={t.addMember.phone} htmlFor="m-phone" error={errors.phone}>
            <div className="input-group">
              <span className="prefix">{t.login.phonePrefix}</span>
              <input
                id="m-phone"
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t.login.phoneHint}
                aria-invalid={!!errors.phone}
                autoComplete="off"
              />
            </div>
          </Field>
          <Field label={`${t.addMember.gender} (${t.common.optional})`} htmlFor="m-gender">
            <select id="m-gender" className="select" value={gender} onChange={(e) => setGender(e.target.value as Gender | '')}>
              <option value="">—</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t.labels.gender[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.addMember.joinedOn} htmlFor="m-joined">
            <input id="m-joined" className="input" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
          </Field>
          <Field label={`${t.addMember.goal} (${t.common.optional})`} htmlFor="m-goal">
            <select id="m-goal" className="select" value={goal} onChange={(e) => setGoal(e.target.value as Goal | '')}>
              <option value="">—</option>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {t.labels.goal[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`${t.addMember.emergency} (${t.common.optional})`} htmlFor="m-emergency">
            <input id="m-emergency" className="input" value={emergency} onChange={(e) => setEmergency(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={`${t.addMember.fingerprint} (${t.common.optional})`} htmlFor="m-fp">
            <input id="m-fp" className="input" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={`${t.addMember.trainer} (${t.common.optional})`} htmlFor="m-trainer">
            <select id="m-trainer" className="select" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="">{t.addMember.noTrainer}</option>
              {trainers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`${t.addMember.notes} (${t.common.optional})`} htmlFor="m-notes" className="full">
            <textarea id="m-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>

      <fieldset className="card" style={{ margin: 0 }}>
        <legend className="section-title" style={{ padding: '0 6px' }}>
          {t.addMember.plan}
        </legend>
        <div className="radio-cards" role="radiogroup">
          {plans.map((p) => (
            <label key={p.id} className="radio-card">
              <input type="radio" name="plan" value={p.id} checked={planId === p.id} onChange={() => pickPlan(p.id)} />
              <span className="cell-main">{p.name}</span>
              {p.timing ? <span className="cell-sub">{p.timing}</span> : null}
              <span className="rc-price">{formatPKR(p.feePkr)}</span>
              <span className="cell-sub">{t.feePlans.monthsLabel(p.months)}</span>
            </label>
          ))}
        </div>
        {errors.plan ? <div className="field-error">{errors.plan}</div> : null}
      </fieldset>

      <div className="card stack">
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          {t.addMember.firstPayment} ({t.common.optional})
        </h2>
        <label className="check">
          <input type="checkbox" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} />
          {t.addMember.takePayment}
        </label>
        {takePayment ? (
        <div className="form-grid">
          <Field label={t.addMember.amount} htmlFor="m-amount" error={errors.amount}>
            <input id="m-amount" className="input mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} />
          </Field>
          <Field label={`${t.addMember.txnId} (${t.common.optional})`} htmlFor="m-txn">
            <input id="m-txn" className="input" value={txnId} onChange={(e) => setTxnId(e.target.value)} autoComplete="off" />
          </Field>
          <div className="field full">
            <span className="label">{t.addMember.method}</span>
            <Segmented label={t.addMember.method} value={method} options={methodOptions} onChange={setMethod} />
          </div>
        </div>
        ) : null}
      </div>

      <FormError message={error} />
      <div className="row">
        <button type="submit" className="btn primary big" disabled={busy}>
          {busy ? t.addMember.submitting : t.addMember.submit}
        </button>
      </div>
    </form>
  );
}

function Done({ result, onAnother }: { result: RegisterMemberResponse; onAnother: () => void }) {
  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <h2 className="section-title">{t.addMember.doneTitle}</h2>
      <div className="grid-2">
        <div>
          <div className="small muted">{t.addMember.doneId}</div>
          <div className="secret">{result.code}</div>
        </div>
        <div>
          <div className="small muted">{t.addMember.donePassword}</div>
          <div className="row">
            <span className="secret">{result.temporaryPassword}</span>
            <CopyButton text={result.temporaryPassword} />
          </div>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t.addMember.donePasswordHint}
      </p>
      {result.payment && result.dueOn ? (
        <dl className="kv">
          <dt>{t.addMember.doneDue}</dt>
          <dd>{formatShortDate(result.dueOn)}</dd>
        </dl>
      ) : null}
      <div className="banner ok">{result.payment ? t.addMember.doneWelcomeAndReceipt : t.addMember.doneWelcome}</div>
      <div className="row">
        <Link className="btn primary" href={`/members/${encodeURIComponent(result.code)}`}>
          {t.addMember.openMember}
        </Link>
        <button type="button" className="btn" onClick={onAnother}>
          {t.addMember.addAnother}
        </button>
      </div>
    </div>
  );
}
