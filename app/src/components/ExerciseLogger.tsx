import Ionicons from '@expo/vector-icons/Ionicons';
import { formatKg, pkToday, warmupSets, type Equipment, type SetEntry } from '@gym/shared';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadFor, loadTotal, toSetEntry, type Load } from '../lib/load';
import { enqueueSession } from '../lib/queue';
import { KEYS, local } from '../lib/storage';
import { t } from '../strings';
import { colors, fonts, space } from '../theme';
import { RestTimer } from './RestTimer';
import { Button, Card, Divider, Row, Stepper, TextLink, Txt } from './ui';
import { WeightPicker } from './WeightPicker';

export type LoggerConfig = {
  exerciseId: string;
  exerciseName: string;
  equipment: Equipment;
  targetSets: number;
  targetReps: number;
  restSec: number;
  /** Coach-set weight the member cannot change. */
  lockedKg?: number | null;
  /** Starting weight when the member may choose. */
  startKg?: number | null;
  /** Warm-ups 50% × 8 and 70% × 5 before working sets (barbell). */
  warmups?: boolean;
  planId?: string | null;
};

async function rememberRecent(exerciseId: string) {
  const recent = (await local.get<string[]>(KEYS.recentExercises)) ?? [];
  await local.set(KEYS.recentExercises, [exerciseId, ...recent.filter((x) => x !== exerciseId)].slice(0, 8));
}

/**
 * Logs one exercise: weight, reps stepper, "Set done, start rest", rest ring,
 * logged sets. Finishing saves the exercise to the offline queue with a
 * phone-made ID, so retries never duplicate on the server.
 */
export function ExerciseLogger({
  config,
  top,
  onFinished,
  onChangeExercise,
  autoFinish,
  controls,
}: {
  config: LoggerConfig;
  /** Extra content above the exercise name (coach note, plan chips). */
  top?: ReactNode;
  onFinished: (saved: boolean) => void;
  /** Saves any logged sets, then lets the parent swap the exercise. */
  onChangeExercise?: () => void;
  /** Finish automatically after the last target set (trainer plans). */
  autoFinish?: boolean;
  /** Shown between the exercise name and the weight card (equipment dropdown). */
  controls?: ReactNode;
}) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>(() => loadFor(config.equipment, config.lockedKg ?? config.startKg ?? null));
  const [reps, setReps] = useState(config.targetReps);
  const [sets, setSets] = useState<SetEntry[]>([]);
  const [resting, setResting] = useState(false);
  const [saving, setSaving] = useState(false);

  const workingKg = config.lockedKg ?? loadTotal(config.equipment, load);
  const warmupPlan =
    config.warmups && config.equipment === 'bar' && workingKg > 20 ? warmupSets(workingKg) : [];
  const warmupsDone = sets.filter((s) => s.warmup).length;
  const inWarmup = warmupsDone < warmupPlan.length;
  const workingDone = sets.length - warmupsDone;
  const allDone = workingDone >= config.targetSets;

  const save = useCallback(
    async (list: SetEntry[]) => {
      if (list.length === 0) return false;
      setSaving(true);
      try {
        await enqueueSession({
          id: Crypto.randomUUID(),
          exerciseId: config.exerciseId,
          date: pkToday(),
          sets: list,
          planId: config.planId ?? null,
        });
        await rememberRecent(config.exerciseId);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [config.exerciseId, config.planId],
  );

  const finish = useCallback(
    async (list: SetEntry[]) => {
      const saved = await save(list);
      onFinished(saved);
    },
    [save, onFinished],
  );

  const logSet = () => {
    if (inWarmup) {
      const w = warmupPlan[warmupsDone];
      setSets((s) => [...s, toSetEntry(config.equipment, load, w.kg, w.reps, true)]);
      return; // no rest timer after warm-ups
    }
    const next = [...sets, toSetEntry(config.equipment, load, workingKg, reps, false)];
    setSets(next);
    const lastPlanned = next.length - warmupsDone >= config.targetSets;
    if (autoFinish && lastPlanned) {
      void finish(next);
      return;
    }
    if (config.restSec > 0) setResting(true);
  };

  const onRestDone = useCallback(() => setResting(false), []);

  const setLabel = inWarmup
    ? t.workout.warmupOf(warmupsDone + 1, warmupPlan.length)
    : t.workout.setOf(workingDone + 1, Math.max(config.targetSets, workingDone + 1));

  return (
    <View style={{ gap: space.lg }}>
      {top}
      <View style={{ gap: 2 }}>
        <Text style={styles.name} numberOfLines={2}>
          {config.exerciseName}
        </Text>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.setLabel}>{allDone && !autoFinish ? t.workout.setOf(workingDone, config.targetSets) : setLabel}</Text>
          <TextLink label={t.workout.history} onPress={() => router.push(`/history/${config.exerciseId}`)} />
        </Row>
      </View>

      {controls}

      {resting ? (
        <Card>
          <RestTimer seconds={config.restSec} onDone={onRestDone} />
        </Card>
      ) : (
        <Card style={{ gap: space.lg }}>
          {inWarmup ? (
            <View style={{ alignItems: 'center', gap: space.xs }}>
              <Txt variant="section">{t.workout.warmupOf(warmupsDone + 1, warmupPlan.length)}</Txt>
              <Text style={styles.warmup}>
                {formatKg(warmupPlan[warmupsDone].kg)} × {warmupPlan[warmupsDone].reps}
              </Text>
              <Txt variant="small">{t.common.kg}</Txt>
            </View>
          ) : (
            <>
              <WeightPicker
                equipment={config.equipment}
                load={load}
                onChange={setLoad}
                lockedKg={config.lockedKg ?? undefined}
              />
              <Divider />
              <View style={{ alignItems: 'center', gap: space.xs }}>
                <Txt variant="section">{t.common.reps}</Txt>
                <Stepper big value={reps} min={1} max={50} onChange={setReps} />
              </View>
            </>
          )}
          <Button
            big
            kind="primary"
            icon={inWarmup ? 'flame-outline' : 'checkmark-circle'}
            label={inWarmup ? t.workout.warmupDone : t.workout.setDone}
            onPress={logSet}
            disabled={saving}
          />
        </Card>
      )}

      <Card>
        <Txt variant="section">{t.workout.logged}</Txt>
        {sets.length === 0 ? (
          <Txt variant="small">{t.workout.noSets}</Txt>
        ) : (
          sets.map((s, i) => (
            <Row key={i} style={styles.setRow}>
              <Ionicons
                name={s.warmup ? 'flame-outline' : 'checkmark-circle'}
                size={20}
                color={s.warmup ? colors.textSecondary : colors.green}
              />
              <Text style={styles.setText}>
                {config.equipment === 'body' && s.kg === 0 ? t.common.bw : `${formatKg(s.kg)} kg`} × {s.reps}
              </Text>
              {s.warmup ? <Txt variant="small">warm-up</Txt> : null}
            </Row>
          ))
        )}
        {sets.length > 0 ? (
          <Button
            kind="secondary"
            icon="save-outline"
            label={t.workout.finish}
            loading={saving}
            onPress={() => void finish(sets)}
          />
        ) : null}
      </Card>

      {onChangeExercise ? (
        <Button
          kind="ghost"
          icon="swap-horizontal"
          label={t.workout.change}
          onPress={async () => {
            await save(sets);
            onChangeExercise();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: colors.text, textTransform: 'uppercase' },
  setLabel: { fontFamily: fonts.semibold, fontSize: 18, color: colors.textSecondary },
  warmup: { fontFamily: fonts.display, fontSize: 64, color: colors.text },
  setRow: { minHeight: 32 },
  setText: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text, flex: 1 },
});
