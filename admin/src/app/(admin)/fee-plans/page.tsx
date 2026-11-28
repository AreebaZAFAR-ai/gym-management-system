'use client';

import type { FeePlan } from '@gym/shared';
import { useState, type FormEvent } from 'react';
import { Dialog, Empty, ErrorBox, Field, FormError, Loading, PageHead } from '@/components/ui';
import { formatPKR, parseAmount } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Fee plans (owner): name, timing (e.g. Ladies timings), fee in PKR, months covered.
 * Edit, Hide/Show. Hidden plans stay on existing members.
 */
export default function FeePlansPage() {
  const { api } = useSession();
  const list = useLoad(() => api.feePlans(), [api]);
  const [editing, setEditing] = useState<FeePlan | 'new' | null>(null);
  const toggle = useAction();

  function upsert(p: FeePlan) {
    list.setData((prev) => {
      const rows = prev ?? [];
      return rows.some((x) => x.id === p.id) ? rows.map((x) => (x.id === p.id ? p : x)) : [...rows, p];
    });
  }

  async function setActive(p: FeePlan, active: boolean) {
    const res = await toggle.run(() => api.updateFeePlan(p.id, { active }));
    if (res) upsert(res);
  }

  return (
    <>
      <PageHead
        title={t.feePlans.title}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            {t.feePlans.add}
          </button>
        }
      />
      <p className="small muted" style={{ marginTop: -8 }}>
        {t.feePlans.hiddenHint}
      </p>
      {toggle.error ? <ErrorBox message={toggle.error} /> : null}
      <div className="card flush">
        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? (
          <Loading />
        ) : list.data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.feePlans.name}</th>
                  <th>{t.feePlans.timing}</th>
                  <th className="num">{t.feePlans.fee}</th>
                  <th>{t.feePlans.months}</th>
                  <th>{t.common.status}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-main">{p.name}</td>
                    <td>{p.timing || '—'}</td>
                    <td className="num">{formatPKR(p.feePkr)}</td>
                    <td>{t.feePlans.monthsLabel(p.months)}</td>
                    <td>
                      <span className={`chip ${p.active ? 'active' : ''}`}>{p.active ? t.feePlans.visible : t.feePlans.hidden}</span>
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="btn small" onClick={() => setEditing(p)}>
                          {t.common.edit}
                        </button>
                        <button type="button" className="btn small" disabled={toggle.busy} onClick={() => setActive(p, !p.active)}>
                          {p.active ? t.common.hide : t.common.show}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{t.feePlans.none}</Empty>
        )}
      </div>
      {editing ? (
        <PlanDialog
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            upsert(p);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: FeePlan | null; onClose: () => void; onSaved: (p: FeePlan) => void }) {
  const { api } = useSession();
  const [name, setName] = useState(plan?.name ?? '');
  const [timing, setTiming] = useState(plan?.timing ?? '');
  const [fee, setFee] = useState(plan ? String(plan.feePkr) : '');
  const [months, setMonths] = useState(plan ? String(plan.months) : '1');
  const { busy, error, setError, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t.feePlans.nameRequired);
    const feePkr = parseAmount(fee);
    if (feePkr === null) return setError(t.feePlans.feeInvalid);
    const m = Number(months);
    if (!Number.isInteger(m) || m < 1) return setError(t.feePlans.monthsInvalid);
    const body = { name: name.trim(), timing: timing.trim() || null, feePkr, months: m };
    const res = await run(() => (plan ? api.updateFeePlan(plan.id, body) : api.createFeePlan(body)));
    if (res) onSaved(res);
  }

  return (
    <Dialog
      title={plan ? t.feePlans.editTitle : t.feePlans.add}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" form="plan-form" className="btn primary" disabled={busy}>
            {busy ? t.common.saving : t.common.save}
          </button>
        </>
      }
    >
      <form id="plan-form" className="form-grid" onSubmit={submit} noValidate>
        <Field label={t.feePlans.name} htmlFor="p-name" className="full">
          <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={`${t.feePlans.timing} (${t.common.optional})`} htmlFor="p-timing" hint={t.feePlans.timingHint} className="full">
          <input id="p-timing" className="input" value={timing} onChange={(e) => setTiming(e.target.value)} />
        </Field>
        <Field label={t.feePlans.fee} htmlFor="p-fee">
          <input id="p-fee" className="input mono" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <Field label={t.feePlans.months} htmlFor="p-months">
          <input id="p-months" className="input mono" type="number" min={1} step={1} value={months} onChange={(e) => setMonths(e.target.value)} />
        </Field>
      </form>
      <FormError message={error} />
    </Dialog>
  );
}
