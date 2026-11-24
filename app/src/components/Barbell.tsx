import { PLATE_COLORS, sortPlates, type Plate } from '@gym/shared';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

const PLATE_HEIGHT: Record<Plate, number> = { 25: 96, 20: 88, 15: 76, 10: 62, 5: 48 };
const PLATE_WIDTH = 14;
const MAX_VISIBLE = 7;

/** A drawn bar with the same plates on both sides (heaviest nearest the collar). */
export function Barbell({ plates }: { plates: number[] }) {
  const sorted = sortPlates(plates);
  const visible = sorted.slice(0, MAX_VISIBLE);
  const hidden = sorted.length - visible.length;
  const side = (mirror: boolean) => (
    <View style={[styles.side, mirror && { flexDirection: 'row-reverse' }]}>
      {visible.map((p, i) => (
        <View
          key={i}
          style={[
            styles.plate,
            {
              height: PLATE_HEIGHT[p as Plate] ?? 40,
              backgroundColor: PLATE_COLORS[p as Plate] ?? colors.border,
            },
          ]}
        />
      ))}
      {hidden > 0 ? <Text style={styles.more}>+{hidden}</Text> : null}
    </View>
  );
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={plates.length ? `Plates each side: ${sorted.join(', ')} kg` : 'Empty bar'}
    >
      <View style={styles.bar} />
      <View style={styles.row}>
        <View style={styles.half}>
          {side(true)}
          <View style={styles.collar} />
        </View>
        <View style={styles.grip} />
        <View style={[styles.half, { flexDirection: 'row' }]}>
          <View style={styles.collar} />
          {side(false)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 110, justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, height: 8, borderRadius: 4, backgroundColor: '#8E949A' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  half: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  side: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  plate: {
    width: PLATE_WIDTH,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(23,25,28,0.35)',
  },
  collar: { width: 8, height: 26, borderRadius: 2, backgroundColor: '#5E646B' },
  grip: { width: 70 },
  more: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textSecondary, marginHorizontal: 4 },
});
