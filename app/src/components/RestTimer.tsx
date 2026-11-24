import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { t } from '../strings';
import { colors, fonts, space } from '../theme';
import { Button, Row } from './ui';

const SIZE = 200;
const STROKE = 12;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/**
 * Rest countdown ring with +15 s and Skip. Counts against an end time,
 * so it stays right if the phone stalls the JS thread.
 */
export function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [endAt, setEndAt] = useState(() => Date.now() + seconds * 1000);
  const [total, setTotal] = useState(seconds);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, Math.ceil((endAt - now) / 1000));
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  const progress = total > 0 ? left / total : 0;
  const mm = Math.floor(left / 60);
  const ss = (left % 60).toString().padStart(2, '0');

  return (
    <View style={styles.wrap}>
      <View accessible accessibilityRole="timer" accessibilityLabel={`${t.workout.rest} ${left} seconds`}>
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={colors.border} strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.brand}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={CIRC * (1 - progress)}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.center}>
          <Text style={styles.label}>{t.workout.rest}</Text>
          <Text style={styles.time}>
            {mm}:{ss}
          </Text>
        </View>
      </View>
      <Row gap={space.md}>
        <Button
          kind="secondary"
          label={t.workout.plus15}
          onPress={() => {
            setEndAt((e) => e + 15_000);
            setTotal((x) => x + 15);
          }}
        />
        <Button kind="primary" label={t.workout.skip} icon="play-skip-forward" onPress={onDone} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.lg, paddingVertical: space.md },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textSecondary, textTransform: 'uppercase' },
  time: { fontFamily: fonts.display, fontSize: 64, color: colors.text },
});
