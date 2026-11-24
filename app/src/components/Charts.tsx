import { formatKg, formatShortDate, type VisitLevel } from '@gym/shared';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../strings';
import { colors, fonts, space } from '../theme';
import { Row } from './ui';

const VISIT_FILL: Record<VisitLevel, string> = { 0: colors.bg, 1: '#9AA0A6', 2: colors.brand };

/** 12-week visit grid: 12 columns (weeks) × 7 rows (days), oldest on the left. */
export function VisitGrid({ visits }: { visits: VisitLevel[] }) {
  const weeks = Array.from({ length: 12 }, (_, w) => visits.slice(w * 7, w * 7 + 7));
  const count = visits.filter((v) => v > 0).length;
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.grid} accessible accessibilityLabel={`${count} visits in the last 12 weeks`}>
        {weeks.map((days, w) => (
          <View key={w} style={styles.col}>
            {days.map((v, d) => (
              <View key={d} style={[styles.cell, { backgroundColor: VISIT_FILL[v] }, v === 0 && styles.cellEmpty]} />
            ))}
          </View>
        ))}
      </View>
      <Row gap={space.lg}>
        {([0, 1, 2] as VisitLevel[]).map((v) => (
          <Row key={v} gap={6}>
            <View style={[styles.legend, { backgroundColor: VISIT_FILL[v] }, v === 0 && styles.cellEmpty]} />
            <Text style={styles.legendText}>
              {v === 0 ? t.progress.visitLegend.none : v === 1 ? t.progress.visitLegend.visit : t.progress.visitLegend.long}
            </Text>
          </Row>
        ))}
      </Row>
    </View>
  );
}

/** Vertical bars for the top set of recent sessions. */
export function BarChart({ points }: { points: { date: string; kg: number; reps: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.kg));
  return (
    <View style={styles.chart} accessible accessibilityLabel={points.map((p) => `${formatKg(p.kg)} kg`).join(', ')}>
      {points.map((p, i) => {
        const last = i === points.length - 1;
        return (
          <View key={`${p.date}-${i}`} style={styles.barCol}>
            <Text style={styles.barValue}>{formatKg(p.kg)}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { height: `${Math.max(6, (p.kg / max) * 100)}%`, backgroundColor: last ? colors.brand : '#9AA0A6' },
                ]}
              />
            </View>
            <Text style={styles.barLabel} numberOfLines={1}>
              {formatShortDate(p.date)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 4, justifyContent: 'space-between' },
  col: { flex: 1, gap: 4 },
  cell: { aspectRatio: 1, borderRadius: 4 },
  cellEmpty: { borderWidth: 1, borderColor: colors.border },
  legend: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 180 },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 8 },
  barValue: { fontFamily: fonts.semibold, fontSize: 11, color: colors.text },
  barLabel: { fontFamily: fonts.regular, fontSize: 10, color: colors.textSecondary },
});
