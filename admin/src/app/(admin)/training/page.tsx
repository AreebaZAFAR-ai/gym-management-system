'use client';

import {
  addDays,
  formatKg,
  kgFromPct,
  PLAN_LIMITS,
  pkToday,
  REST_OPTIONS_SEC,
  type ClientBest,
  type Exercise,
  type PlanItem,
  type TrainerClient,
  type TrainerPlan,
  type WeightMode,
} from '@gym/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useDesk } from '@/components/Shell';
import { Confirm, Empty, ErrorBox, Field, FormError, Loading, PageHead, Segmented, StatusPill, Stepper } from '@/components/ui';
import { formatPkTime, formatShortDate } from '@/lib/format';
import { useAction, useLoad, type Loaded } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

const QUICK_FILL = [65, 75, 85] as const;
const REST_OPTIONS = REST_OPTIONS_SEC;

/**
 * §6 Training plans (trainer, owner): trainer's sessions for today with Mark done.
 * Plan builder as in §5.2 with sets/reps/rest, weight rule (set weight, % of their
 * best, member chooses), warm-ups, "member may change", notes, reorder and remove.
 * Client list with checkboxes and status. Recent plans (last 14 days) with Reuse and Delete.
 */
export default function TrainingPage() {
  const { api } = useSession();
  const exercises = useLoad(() => api.exercises(), [api]);
  const clients = useLoad(() => api.trainerClients(), [api]);
  const plans = useLoad(() => api.trainerPlans(), [api]);
  const [reuse, setReuse] = useState<{ plan: TrainerPlan; n: number } | null>(null);

  const exerciseById = useMemo(() => new Map((exercises.data ?? []).map((e) => [e.id, e])), [exercises.data]);

  return (
    <>
      <PageHead title={t.training.title} />
      <div className="stack">
        <Sessions />
        {exercises.error ? <ErrorBox message={exercises.error} onRetry={exercises.reload} /> : null}
        {clients.error ? <ErrorBox message={clients.error} onRetry={clients.reload} /> : null}
        {exercises.data && clients.data ? (
          <Builder
            key={reuse ? `${reuse.plan.id}-${reuse.n}` : 'new'}
            exercises={exercises.data}
            clients={clients.data}
            reuse={reuse?.plan ?? null}
            onSent={plans.reload}
          />
        ) : (
          <Loading />
        )}
        <RecentPlans
          plans={plans}
          exerciseById={exerciseById}
          onReuse={(plan) => {
            setReuse((r) => ({ plan, n: (r?.n ?? 0) + 1 }));
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>
    </>
  );
}

function Sessions() {
  const { api } = useSession();
  const sessions = useLoad(() => api.trainerToday(), [api]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, done: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await api.setSessionDone(id, done);
      sessions.setData((prev) => (prev ?? []).map((s) => (s.id === id ? res : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <h2>{t.training.today}</h2>
      </div>
      {sessions.error ? <ErrorBox message={sessions.error} onRetry={sessions.reload} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      {sessions.loading && !sessions.data ? (
        <Loading />
      ) : sessions.data?.length ? (
        <table className="table">
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id}>
                <td className="mono" style={{ width: 100 }}>
                  {formatPkTime(s.startsAt)}
                </td>
                <td>
                  <div className="cell-main">{s.title}</div>
                  <div className="cell-sub">{[s.meta, t.training.trainerLabel(s.trainerName)].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="right">
                  <button
                    type="button"
                    className={`btn small${s.done ? ' success' : ''}`}
                    aria-pressed={s.done}
                    disabled={busyId === s.id}
                    onClick={() => toggle(s.id, !s.done)}
                  >
                    {s.done ? `✓ ${t.training.done}` : t.training.markDone}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>{t.training.noSessions}</Empty>
      )}
    </div>
  );
}

interface Draft extends PlanItem {
  key: string;
}

function newItem(ex: Exercise): Draft {
  const body = ex.equipment === 'body';
  return {
    key: `${ex.id}-${Math.random().toString(36).slice(2)}`,
    exerciseId: ex.id,
    sets: 3,
    reps: 10,
    weightMode: body ? 'body' : 'choose',
    kg: null,
    pct: null,
    warmups: false,
    restSec: 90,
    note: null,
    canChange: true,
  };
}

function Builder({
  exercises,
  clients,
  reuse,
  onSent,
}: {
  exercises: Exercise[];
  clients: TrainerClient[];
  reuse: TrainerPlan | null;
  onSent: () => void;
}) {
  const { api } = useSession();
  const { notify } = useDesk();
  const today = pkToday();
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [name, setName] = useState(reuse?.name ?? '');
  const known = new Set(clients.map((c) => c.memberId));
  const [picked, setPicked] = useState<Set<string>>(new Set((reuse?.memberIds ?? []).filter((id) => known.has(id))));
  const exById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const [items, setItems] = useState<Draft[]>(
    (reuse?.items ?? [])
      .filter((i) => exById.has(i.exerciseId))
      .map((i) => ({ ...i, key: `${i.exerciseId}-${Math.random().toString(36).slice(2)}` })),
  );
  const [search, setSearch] = useState('');
  const [bests, setBests] = useState<Map<string, ClientBest> | null>(null);
  const { busy, error, setError, run } = useAction();

  // §5.2: with exactly one client picked, show that client's best set and estimated max.
  const single = picked.size === 1 ? [...picked][0]! : null;
  useEffect(() => {
    setBests(null);
    if (!single) return;
    let current = true;
    api
      .clientBests(single)
      .then((list) => current && setBests(new Map(list.map((b) => [b.exerciseId, b]))))
      .catch(() => current && setBests(new Map()));
    return () => {
      current = false;
    };
  }, [api, single]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return exercises.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8);
  }, [exercises, search]);

  const update = (key: string, patch: Partial<PlanItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const move = (index: number, delta: number) =>
    setItems((list) => {
      const next = [...list];
      const [it] = next.splice(index, 1);
      next.splice(index + delta, 0, it!);
      return next;
    });

  function add(ex: Exercise) {
    if (items.length >= PLAN_LIMITS.exercises.max) return setError(t.training.tooMany);
    setItems((list) => [...list, newItem(ex)]);
    setSearch('');
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t.training.needName);
    if (!picked.size) return setError(t.training.needClients);
    if (!items.length) return setError(t.training.needExercises);
    const missingKg = items.find((i) => i.weightMode === 'fixed' && (i.kg === null || !(i.kg > 0)));
    if (missingKg) return setError(t.training.needKg(exById.get(missingKg.exerciseId)?.name ?? ''));

    const body = {
      name: name.trim(),
      date: day === 'today' ? today : addDays(today, 1),
      memberIds: [...picked],
      items: items.map(({ key: _key, ...i }) => ({
        ...i,
        kg: i.weightMode === 'fixed' ? i.kg : null,
        pct: i.weightMode === 'pct' ? i.pct : null,
        canChange: i.weightMode === 'fixed' || i.weightMode === 'pct' ? i.canChange : true,
        warmups: exById.get(i.exerciseId)?.equipment === 'bar' ? i.warmups : false,
        note: i.note?.trim() || null,
      })),
    };
    const res = await run(() => api.createTrainerPlan(body));
    if (res) {
      notify(t.training.sentTo(res.sentTo));
      setName('');
      setItems([]);
      setPicked(new Set());
      onSent();
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2 className="section-title" style={{ margin: 0 }}>
        {t.training.builder}
      </h2>
      <div className="form-grid">
        <div className="field">
          <span className="label">{t.training.day}</span>
          <Segmented
            label={t.training.day}
            value={day}
            onChange={setDay}
            options={[
              { value: 'today', label: `${t.common.today} · ${formatShortDate(today)}` },
              { value: 'tomorrow', label: `${t.common.tomorrow} · ${formatShortDate(addDays(today, 1))}` },
            ]}
          />
        </div>
        <Field label={t.training.planName} htmlFor="plan-name">
          <input id="plan-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.training.planNamePlaceholder} />
        </Field>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="spread">
            <span className="label cell-main">
              {t.training.clients} · <span className="muted">{t.training.selected(picked.size)}</span>
            </span>
            <div className="row">
              <button type="button" className="btn small ghost" onClick={() => setPicked(new Set(clients.map((c) => c.memberId)))}>
                {t.training.selectAll}
              </button>
              <button type="button" className="btn small ghost" onClick={() => setPicked(new Set())}>
                {t.training.clearAll}
              </button>
            </div>
          </div>
          {clients.length ? (
            <div className="client-list card" style={{ padding: '4px 14px' }}>
              {clients.map((c) => (
                <label key={c.memberId} className="client-row">
                  <span className="check" style={{ minHeight: 0 }}>
                    <input type="checkbox" checked={picked.has(c.memberId)} onChange={() => togglePick(c.memberId)} />
                    <span>
                      <span className="cell-main">{c.name}</span> <span className="cell-sub">{c.code}</span>
                      {c.goal ? <span className="cell-sub"> · {t.labels.goal[c.goal]}</span> : null}
                    </span>
                  </span>
                  <StatusPill status={c.status} />
                </label>
              ))}
            </div>
          ) : (
            <Empty>{t.training.noClients}</Empty>
          )}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <Field label={t.training.addExercise} htmlFor="ex-search">
            <input
              id="ex-search"
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.training.exerciseSearch}
              autoComplete="off"
            />
          </Field>
          {matches.length ? (
            <div className="search-results">
              {matches.map((ex) => (
                <button key={ex.id} type="button" onClick={() => add(ex)}>
                  <span className="cell-main">{ex.name}</span>
                  <span className="cell-sub">+ {t.common.add}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <span className="cell-main">
          {t.training.exercises} ({items.length}/{PLAN_LIMITS.exercises.max})
        </span>
        {items.length ? (
          items.map((item, index) => (
            <ItemEditor
              key={item.key}
              item={item}
              exercise={exById.get(item.exerciseId)!}
              best={single && bests ? bests.get(item.exerciseId) ?? null : undefined}
              first={index === 0}
              last={index === items.length - 1}
              onChange={(p) => update(item.key, p)}
              onMove={(d) => move(index, d)}
              onRemove={() => setItems((list) => list.filter((i) => i.key !== item.key))}
            />
          ))
        ) : (
          <div className="small muted">{t.training.noExercises}</div>
        )}
      </div>

      <FormError message={error} />
      <div>
        <button type="submit" className="btn primary big" disabled={busy}>
          {busy ? t.training.sending : t.training.send}
        </button>
      </div>
    </form>
  );
}

function ItemEditor({
  item,
  exercise,
  best,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  item: Draft;
  exercise: Exercise;
  /** undefined: not exactly one client; null: that client has no history. */
  best: ClientBest | null | undefined;
  first: boolean;
  last: boolean;
  onChange: (p: Partial<PlanItem>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const body = exercise.equipment === 'body';
  const modes: WeightMode[] = body ? ['body'] : ['fixed', 'pct', 'choose'];

  return (
    <div className="plan-item">
      <div className="plan-item-head">
        <div>
          <span className="cell-main">{exercise.name}</span>
          {best ? (
            <div className="cell-sub">{t.training.best(formatKg(best.kg), best.reps, formatKg(best.estimatedMax))}</div>
          ) : best === null ? (
            <div className="cell-sub">{t.training.noBest}</div>
          ) : null}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn small icon" aria-label={t.training.moveUp} disabled={first} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="btn small icon" aria-label={t.training.moveDown} disabled={last} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="btn small danger-ghost" onClick={onRemove}>
            {t.training.remove}
          </button>
        </div>
      </div>
      <div className="plan-controls">
        <Stepper label={t.training.sets} value={item.sets} min={PLAN_LIMITS.sets.min} max={PLAN_LIMITS.sets.max} onChange={(v) => onChange({ sets: v })} />
        <Stepper label={t.training.reps} value={item.reps} min={PLAN_LIMITS.reps.min} max={PLAN_LIMITS.reps.max} onChange={(v) => onChange({ reps: v })} />
        {/* §6 "sets/reps/rest steppers"; §5.2 rest values: 60 s, 90 s, 2 min, 3 min. */}
        <Stepper
          label={t.training.rest}
          value={Math.max(0, REST_OPTIONS.indexOf(item.restSec as (typeof REST_OPTIONS)[number]))}
          min={0}
          max={REST_OPTIONS.length - 1}
          format={(i) => t.training.restLabel(REST_OPTIONS[i]!)}
          onChange={(i) => onChange({ restSec: REST_OPTIONS[i]! })}
        />
      </div>
      {!body ? (
        <div className="plan-controls">
          <div className="field">
            <span className="label">{t.training.weightRule}</span>
            <Segmented
              label={t.training.weightRule}
              value={item.weightMode}
              onChange={(m) => onChange({ weightMode: m, pct: m === 'pct' ? item.pct ?? 75 : item.pct })}
              options={modes.map((m) => ({ value: m, label: t.labels.weightMode[m] }))}
            />
          </div>
          {item.weightMode === 'fixed' ? (
            <Field label={t.training.kg} htmlFor={`kg-${item.key}`}>
              <input
                id={`kg-${item.key}`}
                className="input mono"
                style={{ width: 110 }}
                type="number"
                min={0}
                step={2.5}
                value={item.kg ?? ''}
                onChange={(e) => onChange({ kg: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          ) : null}
          {item.weightMode === 'pct' ? (
            <Stepper
              label={t.training.pct}
              value={item.pct ?? 75}
              min={PLAN_LIMITS.pct.min}
              max={PLAN_LIMITS.pct.max}
              step={5}
              format={(v) => `${v}%`}
              onChange={(v) => onChange({ pct: v })}
            />
          ) : null}
          {best && best.estimatedMax > 0 ? (
            <div className="field">
              <span className="label">{t.training.kg}</span>
              <div className="row" style={{ gap: 6 }}>
                {QUICK_FILL.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="btn small"
                    onClick={() => onChange({ weightMode: 'fixed', kg: kgFromPct(best.estimatedMax, p), pct: null })}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {item.weightMode === 'fixed' || item.weightMode === 'pct' ? (
            <label className="check">
              <input type="checkbox" checked={item.canChange} onChange={(e) => onChange({ canChange: e.target.checked })} />
              {t.training.canChange}
            </label>
          ) : null}
          {exercise.equipment === 'bar' ? (
            <label className="check" title={t.training.warmupsHint}>
              <input type="checkbox" checked={item.warmups} onChange={(e) => onChange({ warmups: e.target.checked })} />
              {t.training.warmups} <span className="small muted">({t.training.warmupsHint})</span>
            </label>
          ) : null}
        </div>
      ) : null}
      <Field label={`${t.training.note} (${t.common.optional})`} htmlFor={`note-${item.key}`}>
        <input id={`note-${item.key}`} className="input" value={item.note ?? ''} onChange={(e) => onChange({ note: e.target.value })} />
      </Field>
    </div>
  );
}

function RecentPlans({
  plans,
  exerciseById,
  onReuse,
}: {
  plans: Loaded<TrainerPlan[]>;
  exerciseById: Map<string, Exercise>;
  onReuse: (p: TrainerPlan) => void;
}) {
  const { api } = useSession();
  const [deleting, setDeleting] = useState<TrainerPlan | null>(null);
  const del = useAction();

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    const ok = await del.run(async () => {
      await api.deleteTrainerPlan(id);
      return true;
    });
    if (ok) {
      setDeleting(null);
      plans.setData((prev) => (prev ?? []).filter((p) => p.id !== id));
    }
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <h2>{t.training.recent}</h2>
      </div>
      {plans.error ? <ErrorBox message={plans.error} onRetry={plans.reload} /> : null}
      {plans.loading && !plans.data ? (
        <Loading />
      ) : plans.data?.length ? (
        <table className="table">
          <tbody>
            {plans.data.map((p) => (
              <tr key={p.id}>
                <td className="mono" style={{ width: 90 }}>
                  {formatShortDate(p.date)}
                </td>
                <td>
                  <div className="cell-main">{p.name}</div>
                  <div className="cell-sub">
                    {t.training.planSummary(p.items.length, p.memberIds.length)} ·{' '}
                    {p.items.map((i) => exerciseById.get(i.exerciseId)?.name ?? i.exerciseId).join(', ')}
                  </div>
                </td>
                <td className="right">
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn small" onClick={() => onReuse(p)}>
                      {t.training.reuse}
                    </button>
                    <button type="button" className="btn small danger-ghost" onClick={() => setDeleting(p)}>
                      {t.common.delete}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>{t.training.noRecent}</Empty>
      )}
      {deleting ? (
        <Confirm
          message={t.training.deleteConfirm}
          confirmLabel={t.common.delete}
          danger
          busy={del.busy}
          error={del.error}
          onConfirm={remove}
          onCancel={() => {
            del.setError(null);
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}
