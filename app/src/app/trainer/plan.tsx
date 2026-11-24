import {
  addDays,
  formatKg,
  kgFromPct,
  pkToday,
  PLAN_LIMITS,
  REST_OPTIONS_SEC,
  type ClientBest,
  type Exercise,
  type PlanItem,
} from '@gym/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { api } from '../../api';
import { ExercisePicker } from '../../components/ExercisePicker';
import {
  Banner,
  Button,
  Card,
  Chip,
  Field,
  IconButton,
  Loading,
  Row,
  Screen,
  Segmented,
  Stepper,
  Txt,
} from '../../components/ui';
import { KEYS } from '../../lib/storage';
import { useResource } from '../../lib/useResource';
import { t } from '../../strings';
import { colors, space } from '../../theme';

type Draft = PlanItem & { key: string };
const QUICK_FILL = [65, 75, 85];

function newItem(ex: Exercise): Draft {
  return {
    key: `${ex.id}-${Date.now()}`,
    exerciseId: ex.id,
    sets: 3,
    reps: 8,
    weightMode: ex.equipment === 'body' ? 'body' : 'choose',
    kg: null,
    pct: null,
    warmups: ex.equipment === 'bar',
    restSec: 90,
    note: null,
    canChange: false,
  };
}

/** Plan builder (spec §5.2): today or tomorrow, one or many clients, 1–15 exercises. */
export default function PlanBuilder() {
  const router = useRouter();
  const clientsRes = useResource(() => api.trainerClients());
  const exRes = useResource(() => api.getExercises(), KEYS.exercises);
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [items, setItems] = useState<Draft[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bestsFor, setBestsFor] = useState<{ memberId: string; bests: ClientBest[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const exercises = useMemo(() => exRes.data ?? [], [exRes.data]);
  const exById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const singleClient = picked.length === 1 ? picked[0] : null;
  const bests = singleClient && bestsFor?.memberId === singleClient ? bestsFor.bests : null;

  // With exactly one client, show their best set and estimated max per exercise.
  useEffect(() => {
    if (!singleClient) return;
    let live = true;
    api.clientBests(singleClient).then(
      (b) => live && setBestsFor({ memberId: singleClient, bests: b }),
      () => live && setBestsFor({ memberId: singleClient, bests: [] }),
    );
    return () => {
      live = false;
    };
  }, [singleClient]);

  const update = (key: string, patch: Partial<PlanItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const toggleClient = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = async () => {
    setError(null);
    if (!name.trim()) return setError(t.trainer.needName);
    if (picked.length === 0) return setError(t.trainer.needClient);
    if (items.length === 0) return setError(t.trainer.needExercise);
    if (items.some((i) => i.weightMode === 'fixed' && !i.kg)) return setError(t.trainer.needWeight);
    setSending(true);
    try {
      const res = await api.createPlan({
        name: name.trim(),
        date: day === 'today' ? pkToday() : addDays(pkToday(), 1),
        memberIds: picked,
        items: items.map(({ key: _key, ...item }) => ({ ...item, note: item.note?.trim() || null })),
      });
      setSent(t.trainer.sent(res.sentTo));
      setTimeout(() => router.back(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
        <Txt variant="title">{t.trainer.builderTitle}</Txt>
        <View style={{ width: 44 }} />
      </Row>

      <Card>
        <Txt variant="section">{t.trainer.when}</Txt>
        <Segmented
          options={[
            { value: 'today', label: t.trainer.today_ },
            { value: 'tomorrow', label: t.trainer.tomorrow },
          ]}
          value={day}
          onChange={setDay}
        />
        <Field label={t.trainer.planName} value={name} onChangeText={setName} placeholder={t.trainer.planNamePlaceholder} />
      </Card>

      <Card>
        <Txt variant="section">{t.trainer.clients}</Txt>
        {!clientsRes.data ? (
          clientsRes.error ? <Banner tone="error" text={clientsRes.error} /> : <Loading />
        ) : (
          <View style={styles.wrap}>
            {clientsRes.data.map((c) => (
              <Chip
                key={c.memberId}
                label={c.name}
                icon={picked.includes(c.memberId) ? 'checkmark' : undefined}
                selected={picked.includes(c.memberId)}
                onPress={() => toggleClient(c.memberId)}
              />
            ))}
          </View>
        )}
      </Card>

      <Txt variant="section">{t.trainer.exercises}</Txt>
      {items.map((item, idx) => {
        const ex = exById.get(item.exerciseId);
        const best = bests?.find((b) => b.exerciseId === item.exerciseId);
        const isBody = ex?.equipment === 'body';
        return (
          <Card key={item.key}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="label" style={{ flex: 1, fontSize: 17 }}>
                {idx + 1}. {ex?.name ?? item.exerciseId}
              </Txt>
              <IconButton
                icon="trash-outline"
                label={`${t.trainer.remove} ${ex?.name ?? ''}`}
                color={colors.red}
                onPress={() => setItems((l) => l.filter((x) => x.key !== item.key))}
              />
            </Row>

            {singleClient && bests ? (
              <View style={{ gap: space.sm }}>
                <Txt variant="small">
                  {best ? t.trainer.best(formatKg(best.kg), best.reps, formatKg(best.estimatedMax)) : t.trainer.noBest}
                </Txt>
                {best && !isBody ? (
                  <Row>
                    {QUICK_FILL.map((pct) => (
                      <Chip
                        key={pct}
                        label={`${pct}%`}
                        onPress={() => update(item.key, { weightMode: 'fixed', kg: kgFromPct(best.estimatedMax, pct), pct: null })}
                      />
                    ))}
                  </Row>
                ) : null}
              </View>
            ) : null}

            <Row style={{ justifyContent: 'space-around' }}>
              <View style={styles.stepperCol}>
                <Txt variant="small">{t.trainer.sets}</Txt>
                <Stepper value={item.sets} min={PLAN_LIMITS.sets.min} max={PLAN_LIMITS.sets.max} onChange={(sets) => update(item.key, { sets })} />
              </View>
              <View style={styles.stepperCol}>
                <Txt variant="small">{t.trainer.reps}</Txt>
                <Stepper value={item.reps} min={PLAN_LIMITS.reps.min} max={PLAN_LIMITS.reps.max} onChange={(reps) => update(item.key, { reps })} />
              </View>
            </Row>

            <Txt variant="small">{t.trainer.weight}</Txt>
            {isBody ? (
              <Txt variant="label">{t.trainer.bodyweight}</Txt>
            ) : (
              <>
                <Segmented
                  options={[
                    { value: 'fixed', label: t.trainer.setWeight },
                    { value: 'choose', label: t.trainer.memberChooses },
                  ]}
                  value={item.weightMode === 'fixed' ? 'fixed' : 'choose'}
                  onChange={(mode) =>
                    update(item.key, {
                      weightMode: mode,
                      kg: mode === 'fixed' ? (item.kg ?? (ex?.equipment === 'bar' ? 40 : 10)) : null,
                    })
                  }
                />
                {item.weightMode === 'fixed' ? (
                  <Stepper
                    big
                    value={item.kg ?? 0}
                    step={2.5}
                    min={0}
                    max={500}
                    format={formatKg}
                    unit="kg"
                    onChange={(kg) => update(item.key, { kg })}
                  />
                ) : null}
              </>
            )}

            <Txt variant="small">{t.trainer.rest}</Txt>
            <Segmented
              options={REST_OPTIONS_SEC.map((s) => ({ value: s, label: s >= 120 ? `${s / 60} min` : `${s} s` }))}
              value={item.restSec as (typeof REST_OPTIONS_SEC)[number]}
              onChange={(restSec) => update(item.key, { restSec })}
            />

            {ex?.equipment === 'bar' ? (
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="label">{t.trainer.warmups}</Txt>
                <Switch
                  accessibilityLabel={t.trainer.warmups}
                  value={item.warmups}
                  onValueChange={(warmups) => update(item.key, { warmups })}
                  trackColor={{ true: colors.brand, false: colors.border }}
                />
              </Row>
            ) : null}

            <Field
              label={t.trainer.note}
              value={item.note ?? ''}
              onChangeText={(note) => update(item.key, { note })}
              multiline
              maxLength={200}
            />
          </Card>
        );
      })}

      {items.length < PLAN_LIMITS.exercises.max ? (
        <Button kind="secondary" icon="add" label={t.trainer.addExercise} disabled={!exRes.data} onPress={() => setPickerOpen(true)} />
      ) : null}

      {error ? <Banner tone="error" text={error} /> : null}
      {sent ? <Banner tone="success" text={sent} /> : null}
      <Button big icon="send" label={t.trainer.send} loading={sending} disabled={!!sent} onPress={send} />

      <ExercisePicker
        visible={pickerOpen}
        exercises={exercises}
        recentIds={[]}
        onClose={() => setPickerOpen(false)}
        onPick={(ex) => {
          setItems((l) => [...l, newItem(ex)]);
          setPickerOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stepperCol: { alignItems: 'center', gap: space.xs },
});
