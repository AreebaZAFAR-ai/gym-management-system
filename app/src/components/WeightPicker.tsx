import { BODYWEIGHT_ADDED_STEP, DUMBBELL_STEP, formatKg, PLATES, type Equipment } from '@gym/shared';
import { StyleSheet, Text, View } from 'react-native';
import { loadFor, loadTotal, type Load } from '../lib/load';
import { t } from '../strings';
import { BIG_NUMBER, colors, fonts, space } from '../theme';
import { Barbell } from './Barbell';
import { MachineStack } from './MachineStack';
import { Button, Chip, Row, Stepper, Txt } from './ui';

/**
 * One equipment control at a time (spec §4.3).
 * With `lockedKg` the weight is shown but cannot be changed (coach set it).
 */
export function WeightPicker({
  equipment,
  load,
  onChange,
  lockedKg,
}: {
  equipment: Equipment;
  load: Load;
  onChange: (l: Load) => void;
  lockedKg?: number | null;
}) {
  const locked = lockedKg != null;
  const shown = locked ? loadFor(equipment, lockedKg) : load;
  const total = locked ? lockedKg : loadTotal(equipment, load);

  const bigTotal = (
    <View style={styles.totalRow} accessible accessibilityLabel={equipment === 'body' && total === 0 ? 'Bodyweight' : `${formatKg(total)} kilograms`}>
      <Text style={styles.total}>{equipment === 'body' ? (total > 0 ? `${t.common.bw} +${formatKg(total)}` : t.common.bw) : formatKg(total)}</Text>
      {equipment !== 'body' || total > 0 ? <Text style={styles.unit}>{t.common.kg}</Text> : null}
    </View>
  );

  if (equipment === 'bar') {
    return (
      <View style={styles.wrap}>
        {bigTotal}
        <Barbell plates={shown.plates} />
        {locked ? (
          <Txt variant="small" center>{t.workout.weightLocked}</Txt>
        ) : (
          <>
            <View style={styles.chips}>
              {PLATES.slice()
                .reverse()
                .map((p) => (
                  <Chip
                    key={p}
                    label={`+${p}`}
                    style={styles.plateChip}
                    onPress={() => onChange({ ...load, plates: [...load.plates, p] })}
                  />
                ))}
            </View>
            <Row style={{ justifyContent: 'center' }}>
              <Button
                kind="secondary"
                icon="arrow-undo"
                label={t.workout.undo}
                disabled={load.plates.length === 0}
                onPress={() => onChange({ ...load, plates: load.plates.slice(0, -1) })}
              />
              <Button
                kind="secondary"
                label={t.workout.emptyBar}
                disabled={load.plates.length === 0}
                onPress={() => onChange({ ...load, plates: [] })}
              />
            </Row>
          </>
        )}
      </View>
    );
  }

  if (equipment === 'db') {
    return (
      <View style={styles.wrap}>
        <Stepper
          big
          value={shown.db}
          step={DUMBBELL_STEP}
          min={0}
          max={100}
          format={formatKg}
          unit={t.common.kg}
          disabled={locked}
          onChange={(db) => onChange({ ...load, db })}
        />
        {locked ? <Txt variant="small" center>{t.workout.weightLocked}</Txt> : null}
      </View>
    );
  }

  if (equipment === 'machine') {
    return (
      <View style={styles.wrap}>
        {bigTotal}
        <MachineStack blocks={shown.blocks} />
        {locked ? (
          <Txt variant="small" center>{t.workout.weightLocked}</Txt>
        ) : (
          <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Chip label="+5" style={styles.plateChip} onPress={() => onChange({ ...load, blocks: [...load.blocks, 5] })} />
            <Chip label="+10" style={styles.plateChip} onPress={() => onChange({ ...load, blocks: [...load.blocks, 10] })} />
            <Button
              kind="secondary"
              icon="arrow-undo"
              label={t.workout.undo}
              disabled={load.blocks.length === 0}
              onPress={() => onChange({ ...load, blocks: load.blocks.slice(0, -1) })}
            />
            <Button
              kind="secondary"
              label={t.workout.clear}
              disabled={load.blocks.length === 0}
              onPress={() => onChange({ ...load, blocks: [] })}
            />
          </Row>
        )}
      </View>
    );
  }

  // Bodyweight with optional added weight.
  return (
    <View style={styles.wrap}>
      {bigTotal}
      {locked ? null : (
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <Txt variant="small">{t.workout.addedWeight}</Txt>
          <Stepper
            value={load.added}
            step={BODYWEIGHT_ADDED_STEP}
            min={0}
            max={100}
            format={(v) => `+${formatKg(v)}`}
            onChange={(added) => onChange({ ...load, added })}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  total: { fontFamily: fonts.display, fontSize: BIG_NUMBER + 8, color: colors.text },
  unit: { fontFamily: fonts.semibold, fontSize: 18, color: colors.textSecondary },
  chips: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: space.sm },
  plateChip: { minHeight: 48, minWidth: 56, justifyContent: 'center' },
});
