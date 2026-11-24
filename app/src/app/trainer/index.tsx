import Ionicons from '@expo/vector-icons/Ionicons';
import { formatPkTime, type TrainerSession } from '@gym/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import { Header } from '../../components/Header';
import { Banner, Button, Card, IconButton, Loading, Row, Screen, Txt } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { t } from '../../strings';
import { colors, fonts, radius, space } from '../../theme';

export default function TrainerToday() {
  const router = useRouter();
  const user = useUser();
  const { logout } = useSession();
  const res = useResource(() => api.trainerToday(), 'cache.trainerToday');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const toggle = async (s: TrainerSession) => {
    setSaving(s.id);
    setError(null);
    try {
      const updated = await api.setSessionDone(s.id, !s.done);
      res.setData((res.data ?? []).map((x) => (x.id === s.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  const sessions = [...(res.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <Screen>
      <Header
        name={user.name}
        right={<IconButton icon="log-out-outline" label={t.a11y.logout} onPress={() => setConfirmLogout(true)} />}
      />
      {confirmLogout ? (
        <Card>
          <Txt variant="label">{t.profile.logoutConfirm}</Txt>
          <Row>
            <Button style={{ flex: 1 }} kind="secondary" label={t.common.cancel} onPress={() => setConfirmLogout(false)} />
            <Button
              style={{ flex: 1 }}
              kind="danger"
              label={t.profile.logout}
              onPress={async () => {
                await logout();
                router.replace('/login');
              }}
            />
          </Row>
        </Card>
      ) : null}

      <Button big icon="create-outline" label={t.trainer.writePlan} onPress={() => router.push('/trainer/plan')} />

      {res.stale ? <Banner tone="warn" text={t.common.offline} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}

      <Card style={{ gap: 0 }}>
        <Txt variant="section" style={{ marginBottom: space.sm }}>
          {t.trainer.today}
        </Txt>
        {!res.data && res.loading ? <Loading /> : null}
        {res.data && sessions.length === 0 ? <Txt variant="small">{t.trainer.noSessions}</Txt> : null}
        {sessions.map((s) => (
          <View key={s.id} style={styles.row}>
            <Text style={[styles.time, s.done && styles.muted]}>{formatPkTime(s.startsAt)}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Row gap={6}>
                {s.kind === 'class' ? <Ionicons name="people-outline" size={16} color={colors.textSecondary} /> : null}
                <Txt variant="label" style={s.done ? styles.muted : undefined}>
                  {s.title}
                </Txt>
              </Row>
              {s.meta ? <Txt variant="small">{s.meta}</Txt> : null}
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: s.done, busy: saving === s.id }}
              accessibilityLabel={`${s.title} ${s.done ? t.trainer.done : t.trainer.markDone}`}
              disabled={saving === s.id}
              onPress={() => void toggle(s)}
              style={[styles.toggle, s.done && styles.toggleDone, saving === s.id && { opacity: 0.5 }]}
            >
              {s.done ? <Ionicons name="checkmark" size={18} color={colors.onBrand} /> : null}
              <Text style={[styles.toggleText, s.done && { color: colors.onBrand }]}>
                {s.done ? t.trainer.done : t.trainer.markDone}
              </Text>
            </Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  time: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.text, width: 76 },
  muted: { color: colors.textSecondary },
  toggle: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toggleDone: { backgroundColor: colors.green, borderColor: colors.green },
  toggleText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
});
