import Ionicons from '@expo/vector-icons/Ionicons';
import { formatKg, type Equipment, type Exercise, type ResolvedPlanItem, type TodayPlan } from '@gym/shared';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../api';
import { ExerciseLogger, type LoggerConfig } from '../../../components/ExerciseLogger';
import { ExercisePicker } from '../../../components/ExercisePicker';
import { Header } from '../../../components/Header';
import { Banner, Button, Card, Chip, IconButton, Loading, Row, Screen, TextLink, Txt } from '../../../components/ui';
import { subscribePending } from '../../../lib/queue';
import { useUser } from '../../../lib/session';
import { KEYS, local } from '../../../lib/storage';
import { useResource } from '../../../lib/useResource';
import { t } from '../../../strings';
import { colors, fonts, radius, space } from '../../../theme';

const TAB_BAR_SPACE = 110;
const FREE_TARGET_SETS = 5;
const FREE_REPS = 8;
const FREE_REST_SEC = 90;

export default function Workout() {
  useKeepAwake(); // screen stays awake during a workout
  const router = useRouter();
  const user = useUser();
  const planRes = useResource(() => api.getTodayPlan(), KEYS.todayPlan);
  const exRes = useResource(() => api.getExercises(), KEYS.exercises);
  const [ownWorkout, setOwnWorkout] = useState(false);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => subscribePending(setPending), []);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(id);
  }, [flash]);

  const plan = planRes.data;
  const showPlan = !!plan && !ownWorkout;

  return (
    <Screen bottomInset={TAB_BAR_SPACE}>
      <Header
        name={user.name}
        onAvatar={() => router.push('/profile')}
        right={<IconButton icon="qr-code" label={t.a11y.openQr} filled onPress={() => router.push('/checkin')} />}
      />
      {flash ? <Banner tone="success" text={flash} /> : null}
      {pending > 0 ? <Banner tone="warn" text={t.workout.pending(pending)} /> : null}

      {planRes.loading && !plan && !exRes.data ? (
        <Loading />
      ) : showPlan ? (
        <PlanWorkout plan={plan} onOwn={() => setOwnWorkout(true)} onSaved={setFlash} />
      ) : exRes.data ? (
        <FreeWorkout exercises={exRes.data} onSaved={setFlash} />
      ) : exRes.error ? (
        <Banner tone="error" text={exRes.error} action={{ label: t.common.retry, onPress: exRes.refresh }} />
      ) : (
        <Loading />
      )}

      {plan && ownWorkout ? (
        <View style={{ alignItems: 'center' }}>
          <TextLink label={t.workout.backToPlan} onPress={() => setOwnWorkout(false)} />
        </View>
      ) : null}
    </Screen>
  );
}

// ---------------- Free workout ----------------

function FreeWorkout({ exercises, onSaved }: { exercises: Exercise[]; onSaved: (msg: string) => void }) {
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<Exercise | null>(null);
  const [equipment, setEquipment] = useState<Equipment>('bar');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [round, setRound] = useState(0); // remounts the logger for a fresh exercise

  const loadRecent = useCallback(async () => {
    const ids = (await local.get<string[]>(KEYS.recentExercises)) ?? [];
    setRecentIds(ids);
    return ids;
  }, []);

  useEffect(() => {
    void local.get<string[]>(KEYS.recentExercises).then((saved) => {
      const ids = saved ?? [];
      setRecentIds(ids);
      const first = exercises.find((e) => e.id === ids[0]) ?? exercises.find((e) => e.id === 'squat') ?? exercises[0];
      if (first) {
        setCurrent(first);
        setEquipment(first.equipment);
      }
    });
  }, [exercises, loadRecent]);

  if (!current) return <Loading />;

  const config: LoggerConfig = {
    exerciseId: current.id,
    exerciseName: current.name,
    equipment,
    targetSets: FREE_TARGET_SETS,
    targetReps: FREE_REPS,
    restSec: FREE_REST_SEC,
  };

  const pick = (e: Exercise) => {
    setCurrent(e);
    setEquipment(e.equipment);
    setPickerOpen(false);
    setRound((r) => r + 1);
  };

  return (
    <>
      <ExerciseLogger
        key={`${current.id}-${round}`}
        config={config}
        controls={<EquipmentDropdown value={equipment} onChange={setEquipment} />}
        onFinished={(saved) => {
          if (saved) onSaved(t.workout.finished(current.name));
          void loadRecent();
          setRound((r) => r + 1);
        }}
        onChangeExercise={() => {
          // Sets were just saved; start a fresh logger so they are not saved twice.
          setRound((r) => r + 1);
          void loadRecent();
          setPickerOpen(true);
        }}
      />
      <ExercisePicker
        visible={pickerOpen}
        exercises={exercises}
        recentIds={recentIds}
        onPick={pick}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

const EQUIPMENT: Equipment[] = ['bar', 'db', 'machine', 'body'];

/** Dropdown showing one equipment choice at a time. */
function EquipmentDropdown({ value, onChange }: { value: Equipment; onChange: (e: Equipment) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Equipment: ${t.workout.equipment[value]}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.dropdown}
      >
        <Text style={styles.dropdownText}>{t.workout.equipment[value]}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.text} />
      </Pressable>
      {open ? (
        <View style={styles.menu}>
          {EQUIPMENT.map((e) => (
            <Pressable
              key={e}
              accessibilityRole="menuitem"
              onPress={() => {
                onChange(e);
                setOpen(false);
              }}
              style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.bg }]}
            >
              <Text style={[styles.dropdownText, e === value && { fontFamily: fonts.bold }]}>
                {t.workout.equipment[e]}
              </Text>
              {e === value ? <Ionicons name="checkmark" size={20} color={colors.text} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------- Trainer plan ----------------

function planItemConfig(plan: TodayPlan, item: ResolvedPlanItem): LoggerConfig {
  const coachSetWeight = (item.weightMode === 'fixed' || item.weightMode === 'pct') && item.kg != null;
  return {
    exerciseId: item.exerciseId,
    exerciseName: item.exerciseName,
    equipment: item.weightMode === 'body' ? 'body' : item.equipment,
    targetSets: item.sets,
    targetReps: item.reps,
    restSec: item.restSec,
    lockedKg: coachSetWeight && !item.canChange ? item.kg : null,
    startKg: item.kg,
    warmups: item.warmups,
    planId: plan.planId,
  };
}

function weightRule(item: ResolvedPlanItem): string {
  switch (item.weightMode) {
    case 'fixed':
      return `${formatKg(item.kg ?? 0)} kg`;
    case 'pct':
      return `${t.workout.pctOfBest(item.pct ?? 0)} · ${formatKg(item.kg ?? 0)} kg`;
    case 'choose':
      return t.workout.memberChooses;
    case 'body':
      return t.common.bw;
  }
}

function PlanWorkout({ plan, onOwn, onSaved }: { plan: TodayPlan; onOwn: () => void; onSaved: (msg: string) => void }) {
  const [localDone, setLocalDone] = useState<string[]>([]);
  const done = useMemo(() => new Set([...plan.doneExerciseIds, ...localDone]), [plan.doneExerciseIds, localDone]);
  const currentIndex = plan.items.findIndex((i) => !done.has(i.exerciseId));
  const [selected, setSelected] = useState<number | null>(null);
  const index = selected ?? currentIndex;
  const item = index >= 0 ? plan.items[index] : null;

  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="small">{t.workout.coach(plan.coachName)}</Txt>
            <Text style={styles.planName}>{plan.planName}</Text>
          </View>
          <Txt variant="label">{t.workout.planDone(done.size, plan.items.length)}</Txt>
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {plan.items.map((it, i) => {
            const isDone = done.has(it.exerciseId);
            return (
              <Chip
                key={it.exerciseId + i}
                label={it.exerciseName}
                icon={isDone ? 'checkmark' : undefined}
                tone={isDone ? 'done' : i === index ? 'current' : 'next'}
                onPress={() => setSelected(i)}
              />
            );
          })}
        </ScrollView>
      </Card>

      {!item ? (
        <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
          <Ionicons name="trophy" size={48} color={colors.green} />
          <Txt variant="title" center>
            {t.workout.planComplete}
          </Txt>
        </Card>
      ) : (
        <ExerciseLogger
          key={`${plan.planId}-${index}`}
          config={planItemConfig(plan, item)}
          autoFinish
          top={
            <Card style={{ gap: space.sm }}>
              <View style={styles.chips}>
                <Chip label={`${item.sets} × ${item.reps}`} />
                <Chip label={weightRule(item)} />
                {item.restSec > 0 ? <Chip label={t.workout.restChip(item.restSec)} /> : null}
                {item.warmups && item.equipment === 'bar' ? <Chip label={t.workout.warmups(2)} /> : null}
              </View>
              {item.note || item.resolvedNote ? (
                <View style={{ gap: 2 }}>
                  <Txt variant="section">{t.workout.coachNote}</Txt>
                  {item.note ? <Txt>{item.note}</Txt> : null}
                  {item.resolvedNote ? <Txt variant="small">{item.resolvedNote}</Txt> : null}
                </View>
              ) : null}
            </Card>
          }
          onFinished={(saved) => {
            if (saved) {
              onSaved(t.workout.finished(item.exerciseName));
              setLocalDone((d) => [...d, item.exerciseId]);
            }
            setSelected(null);
          }}
        />
      )}

      <Button kind="ghost" icon="shuffle" label={t.workout.ownWorkout} onPress={onOwn} />
    </>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'flex-start',
    minWidth: 180,
    gap: space.sm,
  },
  dropdownText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  menu: {
    marginTop: space.xs,
    backgroundColor: colors.card,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    minWidth: 180,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuItem: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planName: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, color: colors.text, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
