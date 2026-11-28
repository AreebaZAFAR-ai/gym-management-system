'use client';

import type { FeePlan, Gender, Goal, MemberDetail, StaffMember, UpdateMemberRequest } from '@gym/shared';
import { normalizePhone } from '@gym/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useDesk } from '@/components/Shell';
import { Confirm, CopyButton, Dialog, Empty, ErrorBox, Field, FormError, Loading, PageHead, StatusPill } from '@/components/ui';
import {
  formatLongDate,
  formatPKR,
  formatPhone,
  formatPkDateTime,
  formatShortDate,
  PAYMENT_METHOD_LABELS,
} from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession, useUser } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Member page (reception, owner): status, plan, visits in the last 30 days, contact
 * and trainer. Payments, recent check-ins, WhatsApp messages, notes. Actions: Record
 * payment, Edit (owner can also change due date), Reset password (shows the new one),
 * Disable/Enable.
 */
export default function MemberPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const { api, refreshApprovals } = useSession();
  const { openPayment } = useDesk();
  const member = useLoad(() => api.member(code), [api, code]);
  const staff = useLoad(() => api.staff(), [api]);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'disable' | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const action = useAction();

  const names = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.name])), [staff.data]);
  const m = member.data;

  async function resetPassword() {
    const res = await action.run(() => api.resetPassword(code));
    if (res) {
      setConfirm(null);
      setNewPassword(res.password);
    }
  }

  async function setActive(active: boolean) {
    const res = await action.run(() => api.updateMember(code, { active }));
    if (res) {
      setConfirm(null);
      member.setData(res);
    }
  }

  if (member.error) return <ErrorBox message={member.error} onRetry={member.reload} />;
  if (!m) return <Loading />;

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href="/members" className="small muted">
          ← {t.member.back}
        </Link>
      </div>
      <PageHead
        title={m.name}
        actions={
          <>
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                openPayment(m.code, () => {
                  member.reload();
                  refreshApprovals();
                })
              }
            >
              {t.member.recordPayment}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {t.member.edit}
            </button>
            <button type="button" className="btn" onClick={() => setConfirm('reset')}>
              {t.member.resetPassword}
            </button>
            {m.active ? (
              <button type="button" className="btn danger-ghost" onClick={() => setConfirm('disable')}>
                {t.member.disable}
              </button>
            ) : (
              <button type="button" className="btn" disabled={action.busy} onClick={() => setActive(true)}>
                {t.member.enable}
              </button>
            )}
          </>
        }
      />
      <div className="row" style={{ marginBottom: 20 }}>
        <span className="chip">{m.code}</span>
        <StatusPill status={m.status} />
        {!m.active ? <span className="chip disabled">{t.member.accountDisabled}</span> : null}
      </div>
      {action.error && !confirm ? <FormError message={action.error} /> : null}

      <div className="stack">
        <div className="stat-grid">
          <div className="card stat">
            <div className="stat-label">{t.member.plan}</div>
            <div className="cell-main" style={{ marginTop: 6 }}>
              {m.planName}
            </div>
            <div className="cell-sub">
              {[m.planTiming, formatPKR(m.feePkr)].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className={`card stat${m.status === 'overdue' ? ' danger' : ''}`}>
            <div className="stat-label">{t.member.due}</div>
            <div className="stat-value">{formatShortDate(m.dueOn)}</div>
            {m.frozenUntil ? <div className="stat-sub muted">{`${t.labels.status.frozen} → ${formatShortDate(m.frozenUntil)}`}</div> : null}
          </div>
          <div className="card stat">
            <div className="stat-label">{t.member.visits30}</div>
            <div className="stat-value">{m.visitsLast30Days}</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <h2 className="section-title">{t.member.contact}</h2>
            <dl className="kv">
              <dt>{t.common.phone}</dt>
              <dd className="mono">{formatPhone(m.phone)}</dd>
              <dt>{t.member.emergency}</dt>
              <dd>{m.emergencyContact || '—'}</dd>
              <dt>{t.member.trainer}</dt>
              <dd>{m.trainerName || '—'}</dd>
              <dt>{t.member.goal}</dt>
              <dd>{m.goal ? t.labels.goal[m.goal] : '—'}</dd>
              <dt>{t.member.gender}</dt>
              <dd>{m.gender ? t.labels.gender[m.gender] : '—'}</dd>
              <dt>{t.member.joined}</dt>
              <dd>{formatLongDate(m.joinedOn)}</dd>
              <dt>{t.member.fingerprint}</dt>
              <dd>{m.fingerprintId || '—'}</dd>
            </dl>
          </div>
          <div className="card">
            <h2 className="section-title">{t.member.notes}</h2>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }} className={m.notes ? '' : 'muted'}>
              {m.notes || t.member.noNotes}
            </p>
            {m.dueDateChanges.length ? (
              <>
                <h2 className="section-title" style={{ marginTop: 20 }}>
                  {t.member.dueChanges}
                </h2>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {m.dueDateChanges.map((c) => (
                    <li key={c.id} className="small">
                      {formatShortDate(c.oldDueOn)} → {formatShortDate(c.newDueOn)} · {formatPkDateTime(c.createdAt)}{' '}
                      {t.member.changedBy(names.get(c.changedBy) ?? '—')}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>

        <div className="card flush">
          <div className="card-head">
            <h2>{t.member.payments}</h2>
          </div>
          {m.payments.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.fees.colWhen}</th>
                    <th className="num">{t.fees.colAmount}</th>
                    <th>{t.fees.colMethod}</th>
                    <th>{t.fees.colPeriod}</th>
                    <th>{t.fees.colTxn}</th>
                    <th>{t.fees.colBy}</th>
                  </tr>
                </thead>
                <tbody>
                  {m.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {formatPkDateTime(p.createdAt)}
                        {p.correctsPaymentId ? <span className="chip" style={{ marginLeft: 8 }}>{t.member.correction}</span> : null}
                      </td>
                      <td className="num">{formatPKR(p.amountPkr)}</td>
                      <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                      <td>{t.member.period(formatShortDate(p.periodFrom), formatShortDate(p.periodTo))}</td>
                      <td>{p.txnId || '—'}</td>
                      <td>{p.proofId ? t.fees.fromScreenshot : names.get(p.recordedBy) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t.member.noPayments}</Empty>
          )}
        </div>

        <div className="grid-2">
          <div className="card flush">
            <div className="card-head">
              <h2>{t.member.checkins}</h2>
            </div>
            {m.checkins.length ? (
              <table className="table">
                <tbody>
                  {m.checkins.map((c) => (
                    <tr key={c.id}>
                      <td>{formatPkDateTime(c.createdAt)}</td>
                      <td>{t.labels.source[c.source]}</td>
                      <td>
                        <span className={`chip ${c.allowed ? 'allowed' : 'blocked'}`}>
                          {c.allowed ? t.checkins.allowedShort : t.checkins.blockedShort}
                        </span>
                        {!c.allowed && c.reason ? <div className="cell-sub">{c.reason}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t.member.noCheckins}</Empty>
            )}
          </div>
          <div className="card flush">
            <div className="card-head">
              <h2>{t.member.whatsapp}</h2>
              <Link className="btn small" href="/whatsapp">
                {t.nav.whatsapp}
              </Link>
            </div>
            {m.whatsapp.length ? (
              m.whatsapp.map((w) => (
                <div key={w.id} className="message">
                  <div className="spread small">
                    <span className="cell-main">{t.labels.whatsappKind[w.kind]}</span>
                    <span className="muted">
                      {t.labels.whatsappStatus[w.status]} · {formatPkDateTime(w.createdAt)}
                    </span>
                  </div>
                  <div className="message-body small">{w.body}</div>
                </div>
              ))
            ) : (
              <Empty>{t.member.noMessages}</Empty>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <EditMember
          member={m}
          staff={staff.data ?? []}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            member.setData(updated);
            setEditing(false);
          }}
        />
      ) : null}
      {confirm === 'reset' ? (
        <Confirm
          message={t.member.resetConfirm}
          confirmLabel={t.member.resetPassword}
          busy={action.busy}
          error={action.error}
          onConfirm={resetPassword}
          onCancel={() => {
            action.setError(null);
            setConfirm(null);
          }}
        />
      ) : null}
      {confirm === 'disable' ? (
        <Confirm
          message={t.member.disableConfirm}
          confirmLabel={t.member.disable}
          danger
          busy={action.busy}
          error={action.error}
          onConfirm={() => setActive(false)}
          onCancel={() => {
            action.setError(null);
            setConfirm(null);
          }}
        />
      ) : null}
      {newPassword ? (
        <Dialog
          title={t.member.resetDone}
          onClose={() => setNewPassword(null)}
          footer={
            <button type="button" className="btn primary" onClick={() => setNewPassword(null)}>
              {t.common.close}
            </button>
          }
        >
          <div className="row">
            <span className="secret">{newPassword}</span>
            <CopyButton text={newPassword} />
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t.member.resetHint}
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

const GOALS: Goal[] = ['strength', 'muscle', 'fat_loss', 'fitness'];
const GENDERS: Gender[] = ['male', 'female', 'other'];

function EditMember({
  member: m,
  staff,
  onClose,
  onSaved,
}: {
  member: MemberDetail;
  staff: StaffMember[];
  onClose: () => void;
  onSaved: (m: MemberDetail) => void;
}) {
  const { api } = useSession();
  const user = useUser();
  const isOwner = user.role === 'owner';
  const plans = useLoad(() => api.feePlans(), [api]);
  const [name, setName] = useState(m.name);
  const [phone, setPhone] = useState(formatPhone(m.phone));
  const [gender, setGender] = useState<Gender | ''>(m.gender ?? '');
  const [goal, setGoal] = useState<Goal | ''>(m.goal ?? '');
  const [emergency, setEmergency] = useState(m.emergencyContact ?? '');
  const [fingerprint, setFingerprint] = useState(m.fingerprintId ?? '');
  const [notes, setNotes] = useState(m.notes ?? '');
  const [planId, setPlanId] = useState(m.planId);
  const [trainerId, setTrainerId] = useState(m.trainerId ?? '');
  const [dueOn, setDueOn] = useState(m.dueOn);
  const { busy, error, setError, run } = useAction();

  // Hidden plans stay on existing members (§6), so the member's own plan is always listed.
  const planOptions: Pick<FeePlan, 'id' | 'name' | 'feePkr' | 'active'>[] = (plans.data ?? []).filter((p) => p.active || p.id === m.planId);
  if (!planOptions.some((p) => p.id === m.planId)) planOptions.unshift({ id: m.planId, name: m.planName, feePkr: m.feePkr, active: false });
  const trainers = staff.filter((s) => s.role === 'trainer' && (s.active || s.id === m.trainerId));
  if (m.trainerId && !trainers.some((s) => s.id === m.trainerId)) {
    trainers.unshift({ id: m.trainerId, name: m.trainerName ?? '—', phone: '', role: 'trainer', active: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t.addMember.nameRequired);
    const normalized = normalizePhone(phone);
    if (!normalized) return setError(t.addMember.phoneInvalid);

    const body: UpdateMemberRequest = {};
    if (name.trim() !== m.name) body.name = name.trim();
    if (normalized !== m.phone) body.phone = normalized;
    if ((gender || null) !== m.gender) body.gender = gender || null;
    if ((goal || null) !== m.goal) body.goal = goal || null;
    if ((emergency.trim() || null) !== m.emergencyContact) body.emergencyContact = emergency.trim() || null;
    if ((fingerprint.trim() || null) !== m.fingerprintId) body.fingerprintId = fingerprint.trim() || null;
    if ((notes.trim() || null) !== m.notes) body.notes = notes.trim() || null;
    if (planId !== m.planId) body.planId = planId;
    if ((trainerId || null) !== m.trainerId) body.trainerId = trainerId || null;
    if (isOwner && dueOn && dueOn !== m.dueOn) body.dueOn = dueOn;
    if (!Object.keys(body).length) return onClose();

    const res = await run(() => api.updateMember(m.code, body));
    if (res) onSaved(res);
  }

  return (
    <Dialog
      title={t.member.editTitle}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" form="edit-member" className="btn primary" disabled={busy}>
            {busy ? t.common.saving : t.common.save}
          </button>
        </>
      }
    >
      <form id="edit-member" className="form-grid" onSubmit={submit} noValidate>
        <Field label={t.addMember.name} htmlFor="e-name">
          <input id="e-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.addMember.phone} htmlFor="e-phone">
          <input id="e-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t.addMember.gender} htmlFor="e-gender">
          <select id="e-gender" className="select" value={gender} onChange={(e) => setGender(e.target.value as Gender | '')}>
            <option value="">—</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {t.labels.gender[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.addMember.goal} htmlFor="e-goal">
          <select id="e-goal" className="select" value={goal} onChange={(e) => setGoal(e.target.value as Goal | '')}>
            <option value="">—</option>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {t.labels.goal[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.addMember.plan} htmlFor="e-plan">
          <select id="e-plan" className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatPKR(p.feePkr)}
                {p.active ? '' : ` (${t.feePlans.hidden})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.addMember.trainer} htmlFor="e-trainer">
          <select id="e-trainer" className="select" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
            <option value="">{t.addMember.noTrainer}</option>
            {trainers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.addMember.emergency} htmlFor="e-emergency">
          <input id="e-emergency" className="input" value={emergency} onChange={(e) => setEmergency(e.target.value)} />
        </Field>
        <Field label={t.addMember.fingerprint} htmlFor="e-fp">
          <input id="e-fp" className="input" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
        </Field>
        {isOwner ? (
          <Field label={t.member.dueOn} htmlFor="e-due" hint={t.member.dueOnOwner} className="full">
            <input id="e-due" className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} style={{ maxWidth: 240 }} />
          </Field>
        ) : null}
        <Field label={t.addMember.notes} htmlFor="e-notes" className="full">
          <textarea id="e-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
      <FormError message={error} />
    </Dialog>
  );
}
