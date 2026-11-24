import Ionicons from '@expo/vector-icons/Ionicons';
import { formatKg, whatsappLink, whatsappNumber, type Goal, type Membership, type ProgressSummary } from '@gym/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../api';
import { VisitGrid } from '../../../components/Charts';
import { Header } from '../../../components/Header';
import { Banner, Button, Card, Chip, IconButton, Loading, Row, Screen, Txt } from '../../../components/ui';
import { BRAND } from '../../../config';
import { useUser } from '../../../lib/session';
import { KEYS, local } from '../../../lib/storage';
import { useResource } from '../../../lib/useResource';
import { t } from '../../../strings';
import { colors, fonts, space } from '../../../theme';

const TAB_BAR_SPACE = 110;

export default function Progress() {
  const router = useRouter();
  const user = useUser();
  const progress = useResource(() => api.getProgress(), KEYS.progress);
  const p = progress.data;

  return (
    <Screen bottomInset={TAB_BAR_SPACE}>
      <Header
        name={user.name}
        onAvatar={() => router.push('/profile')}
        right={<IconButton icon="qr-code" label={t.a11y.openQr} filled onPress={() => router.push('/checkin')} />}
      />
      {progress.stale ? <Banner tone="warn" text={t.common.offline} /> : null}
      {progress.error && !progress.stale && !p ? (
        <Banner tone="error" text={progress.error} action={{ label: t.common.retry, onPress: progress.refresh }} />
      ) : null}
      {!p ? (
        progress.loading ? <Loading /> : null
      ) : p.isNew ? (
        <Welcome progress={p} firstName={user.name.split(' ')[0]} memberCode={user.memberCode ?? ''} />
      ) : (
        <Returning progress={p} />
      )}
    </Screen>
  );
}

function Returning({ progress }: { progress: ProgressSummary }) {
  const router = useRouter();
  return (
    <>
      {progress.todayPlan ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/workout')}>
          <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }}>
            <Txt variant="section" color="rgba(255,255,255,0.75)">
              {t.progress.todayPlan}
            </Txt>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.planName, { color: colors.onBrand }]}>{progress.todayPlan.planName}</Text>
                <Txt variant="small" color="rgba(255,255,255,0.75)">
                  {t.workout.coach(progress.todayPlan.coachName)} · {t.progress.exercises(progress.todayPlan.exerciseCount)}
                </Txt>
              </View>
              <View style={styles.startPill}>
                <Text style={styles.startText}>{t.progress.startPlan}</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.brand} />
              </View>
            </Row>
          </Card>
        </Pressable>
      ) : null}

      <Card>
        <Txt variant="section">{t.progress.bests}</Txt>
        {progress.bests.map((b) => (
          <Pressable
            key={b.exerciseId}
            accessibilityRole="button"
            accessibilityHint={t.a11y.history}
            onPress={() => router.push(`/history/${b.exerciseId}`)}
            style={({ pressed }) => [styles.bestRow, pressed && { opacity: 0.6 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label">{b.exerciseName}</Txt>
              <Txt variant="small" color={b.deltaKgMonth > 0 ? colors.green : colors.textSecondary}>
                {b.deltaKgMonth > 0 ? t.progress.upThisMonth(formatKg(b.deltaKgMonth)) : t.progress.noChange}
              </Txt>
            </View>
            <Text style={styles.bestKg}>{formatKg(b.kg)}</Text>
            <Txt variant="small">kg × {b.reps}</Txt>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        ))}
      </Card>

      <Card>
        <Txt variant="section">{t.progress.visits}</Txt>
        <VisitGrid visits={progress.visits} />
      </Card>

      <Card>
        <Txt variant="section">{t.progress.thisMonth}</Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stat value={String(progress.month.workouts)} label={t.progress.workouts} />
          <Stat value={String(progress.month.newBests)} label={t.progress.newBests} />
          <Stat value={formatKg(progress.month.tonnes)} label={t.progress.tonnes} />
        </Row>
      </Card>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'flex-start' }}>
      <Text style={styles.statValue}>{value}</Text>
      <Txt variant="small">{label}</Txt>
    </View>
  );
}

const GOALS: Goal[] = ['strength', 'muscle', 'fat_loss', 'fitness'];

function Welcome({ progress, firstName, memberCode }: { progress: ProgressSummary; firstName: string; memberCode: string }) {
  const [line, setLine] = useState(0);
  const [goal, setGoal] = useState<Goal | null>(null);

  useEffect(() => {
    const id = setInterval(() => setLine((i) => (i + 1) % t.motivation.length), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void (async () => {
      const saved = await local.get<Goal>(KEYS.goal);
      const membership = await local.get<Membership>(KEYS.membership);
      setGoal(saved ?? membership?.goal ?? null);
    })();
  }, []);

  const pickGoal = (g: Goal) => {
    setGoal(g);
    void local.set(KEYS.goal, g);
  };

  const checklist: [keyof ProgressSummary['checklist'], string][] = [
    ['firstCheckin', t.progress.checklist.firstCheckin],
    ['firstWorkout', t.progress.checklist.firstWorkout],
    ['metTrainer', t.progress.checklist.metTrainer],
  ];

  return (
    <>
      <View style={{ gap: space.sm, paddingVertical: space.sm }}>
        <Txt variant="title">{t.progress.welcome(firstName)}</Txt>
        <Text style={styles.motivation} accessibilityLiveRegion="polite">
          {t.motivation[line]}
        </Text>
      </View>

      <Card>
        <Txt variant="section">{t.progress.goalTitle}</Txt>
        <View style={styles.wrap}>
          {GOALS.map((g) => (
            <Chip key={g} label={t.goals[g]} selected={goal === g} onPress={() => pickGoal(g)} />
          ))}
        </View>
      </Card>

      <Card>
        <Txt variant="section">{t.progress.firstWeek}</Txt>
        {checklist.map(([key, label]) => {
          const done = progress.checklist[key];
          return (
            <Row key={key} style={{ minHeight: 36 }}>
              <Ionicons
                name={done ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={done ? colors.green : colors.border}
              />
              <Txt style={done ? { color: colors.textSecondary, textDecorationLine: 'line-through' } : undefined}>
                {label}
              </Txt>
            </Row>
          );
        })}
      </Card>

      <Card>
        <Txt variant="label">{t.progress.introTitle}</Txt>
        <Txt variant="small">{t.progress.introBody}</Txt>
        <Button
          kind="secondary"
          icon="logo-whatsapp"
          label={t.progress.introButton}
          onPress={() =>
            void Linking.openURL(
              whatsappLink(whatsappNumber(BRAND.receptionWhatsapp), t.progress.introMessage(firstName, memberCode)),
            )
          }
        />
      </Card>

      <Card>
        <Txt variant="section">{t.progress.visits}</Txt>
        <VisitGrid visits={progress.visits} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  planName: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, textTransform: 'uppercase' },
  startPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: space.lg,
    minHeight: 44,
  },
  startText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.brand },
  bestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bestKg: { fontFamily: fonts.display, fontSize: 32, color: colors.text },
  statValue: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: colors.text },
  motivation: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 24, color: colors.textSecondary },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
