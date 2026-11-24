import { formatKg, formatShortDate } from '@gym/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../../../api';
import { BarChart } from '../../../components/Charts';
import { Banner, Card, IconButton, Loading, Row, Screen, Txt } from '../../../components/ui';
import { useResource } from '../../../lib/useResource';
import { t } from '../../../strings';
import { colors, fonts, space } from '../../../theme';

export default function History() {
  const router = useRouter();
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const res = useResource(() => api.getHistory(exerciseId), `cache.history.${exerciseId}`);
  const h = res.data;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
      </Row>
      {res.stale ? <Banner tone="warn" text={t.common.offline} /> : null}
      {!h ? (
        res.error ? <Banner tone="error" text={res.error} action={{ label: t.common.retry, onPress: res.refresh }} /> : <Loading />
      ) : (
        <>
          <Txt variant="title">{h.exercise.name}</Txt>
          {h.sessions.length === 0 ? (
            <Card>
              <Txt variant="small">{t.history.empty}</Txt>
            </Card>
          ) : (
            <>
              <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
                <Stat label={t.history.heaviest} value={h.heaviest ? formatKg(h.heaviest.kg) : '–'} sub={h.heaviest ? `kg × ${h.heaviest.reps}` : ''} />
                <Stat label={t.history.oneRepMax} value={h.estimatedMax ? formatKg(h.estimatedMax) : '–'} sub="kg" />
                <Stat label={t.history.bestVolume} value={h.bestVolume ? formatKg(h.bestVolume.kg) : '–'} sub="kg" />
              </Row>
              <Card>
                <Txt variant="section">{t.history.topSets}</Txt>
                <BarChart points={h.topSets} />
              </Card>
              <Card style={{ gap: 0 }}>
                <Txt variant="section" style={{ marginBottom: space.sm }}>
                  {t.history.sessions}
                </Txt>
                {h.sessions.map((s) => (
                  <View key={s.id} style={styles.session}>
                    <Txt variant="label">{formatShortDate(s.date)}</Txt>
                    <View style={styles.sets}>
                      {s.sets.map((set, i) => (
                        <Text key={i} style={[styles.set, set.warmup && styles.warm]}>
                          {formatKg(set.kg)} × {set.reps}
                          {set.warmup ? ` ${t.history.warmup}` : ''}
                        </Text>
                      ))}
                    </View>
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card style={{ flex: 1, padding: space.md, gap: 2 }}>
      <Txt variant="small" numberOfLines={2}>
        {label}
      </Txt>
      <Text style={styles.statValue}>{value}</Text>
      <Txt variant="small">{sub}</Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  statValue: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: colors.text },
  session: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.xs,
  },
  sets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  set: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  warm: { color: colors.textSecondary },
});
