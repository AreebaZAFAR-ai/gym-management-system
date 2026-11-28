import {
  buildCheckinQr,
  entryDecision,
  formatShortDate,
  pkToday,
  qrWindow,
  secondsLeftInWindow,
  type CheckinKey,
  type Membership,
} from '@gym/shared';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '../../api';
import { Banner, IconButton, Loading, Screen, StatusPill, Txt } from '../../components/ui';
import { readCachedMembership, readCheckinKey } from '../../lib/session';
import { KEYS, local } from '../../lib/storage';
import { t } from '../../strings';
import { colors, fonts, space } from '../../theme';

/**
 * Full-screen rotating QR. The member key is cached after the first login so
 * this works without internet; the QR changes every 30 seconds so a
 * screenshot stops working at the door.
 */
export default function Checkin() {
  useKeepAwake();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [key, setKey] = useState<CheckinKey | null | undefined>(undefined);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void (async () => {
      setKey(await readCheckinKey());
      setMembership(await readCachedMembership());
      // Refresh status quietly when online; cached copy is used otherwise.
      try {
        const fresh = await api.getMembership();
        setMembership(fresh);
        await local.set(KEYS.membership, fresh);
      } catch {
        /* offline: keep cached */
      }
    })();
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const window = qrWindow(now);
  const payload = useMemo(
    () => (key ? buildCheckinQr(key.gymId, key.memberCode, key.key, window * 30_000) : null),
    [key, window],
  );

  const pill = (() => {
    if (!membership) return null;
    const today = pkToday();
    const d = entryDecision(membership, today, membership.graceDays);
    if (!d.allowed && d.reason === 'frozen') {
      return <StatusPill status="frozen" label={t.checkin.frozen(formatShortDate(membership.frozenUntil!))} />;
    }
    if (!d.allowed) return <StatusPill status="overdue" label={t.checkin.overdue} />;
    return (
      <StatusPill
        status={membership.dueOn < today ? 'due_soon' : 'active'}
        label={t.checkin.activeUntil(formatShortDate(membership.dueOn))}
      />
    );
  })();

  const qrSize = Math.min(width - space.xxl * 2, 320);

  return (
    <Screen edges={['top', 'bottom']} scroll={false} contentStyle={styles.wrap}>
      <View style={styles.close}>
        <IconButton icon="close" label={t.common.close} onPress={() => router.back()} />
      </View>

      {key === undefined ? (
        <Loading />
      ) : !key || !payload ? (
        <Banner tone="warn" text={t.checkin.noKey} />
      ) : (
        <View style={styles.center}>
          <Txt variant="title" center>
            {membership?.name ?? key.memberCode}
          </Txt>
          <Txt variant="label" center>
            {key.memberCode}
            {membership ? ` · ${membership.planName}` : ''}
          </Txt>
          {pill}
          <View style={styles.qrBox} accessible accessibilityLabel="Check-in QR code">
            <QRCode value={payload} size={qrSize} backgroundColor="#FFFFFF" color={colors.text} ecl="M" />
          </View>
          <Text style={styles.countdown} accessibilityLiveRegion="polite">
            {t.checkin.changesIn(secondsLeftInWindow(now))}
          </Text>
          <Txt variant="small" center>
            {t.checkin.hint}
          </Txt>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center', backgroundColor: colors.bg },
  close: { position: 'absolute', top: space.lg, right: space.lg, zIndex: 1 },
  center: { alignItems: 'center', gap: space.md },
  qrBox: {
    marginTop: space.md,
    padding: space.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  countdown: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text, marginTop: space.sm },
});
