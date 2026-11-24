import {
  addDays,
  FREEZE_MAX_DAYS,
  FREEZE_MIN_DAYS,
  formatPhone,
  formatPKR,
  formatShortDate,
  type FreezeReason,
} from '@gym/shared';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import { Avatar } from '../../components/Header';
import {
  Banner,
  Button,
  Card,
  Divider,
  Field,
  IconButton,
  Loading,
  Row,
  Screen,
  Segmented,
  StatusPill,
  Stepper,
  Txt,
} from '../../components/ui';
import { useSession } from '../../lib/session';
import { KEYS } from '../../lib/storage';
import { useResource } from '../../lib/useResource';
import { t } from '../../strings';
import { colors, fonts, space } from '../../theme';

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export default function Profile() {
  const router = useRouter();
  const { logout } = useSession();
  const membership = useResource(() => api.getMembership(), KEYS.membership);
  const announcements = useResource(() => api.getAnnouncements());
  const m = membership.data;

  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (!m) {
    return (
      <Screen>
        <IconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
        {membership.error ? (
          <Banner tone="error" text={membership.error} action={{ label: t.common.retry, onPress: membership.refresh }} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const copyNumber = async () => {
    await Clipboard.setStringAsync(m.payTo.number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const uploadProof = async () => {
    setNotice(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
      setNotice({ tone: 'error', text: 'This image is larger than 6 MB. Choose a smaller screenshot.' });
      return;
    }
    setUploading(true);
    try {
      await api.uploadPaymentProof({
        uri: asset.uri,
        name: asset.fileName ?? `payment-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setNotice({ tone: 'success', text: t.profile.proofSent });
      await membership.refresh();
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
        <IconButton icon="qr-code" label={t.a11y.openQr} filled onPress={() => router.push('/checkin')} />
      </Row>
      {membership.stale ? <Banner tone="warn" text={t.common.offline} /> : null}

      <Row gap={space.lg}>
        <Avatar name={m.name} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="title" numberOfLines={2}>
            {m.name}
          </Txt>
          <StatusPill status={m.status} />
        </View>
      </Row>

      <Card style={{ gap: 0 }}>
        <InfoRow label={t.profile.memberId} value={m.code} />
        <InfoRow label={t.profile.plan} value={m.planTiming ? `${m.planName} · ${m.planTiming}` : m.planName} />
        <InfoRow
          label={t.profile.dueDate}
          value={formatShortDate(m.dueOn)}
          color={m.status === 'overdue' ? colors.red : undefined}
        />
        <InfoRow label={t.profile.amount} value={formatPKR(m.feePkr)} />
        {m.trainerName ? <InfoRow label={t.profile.trainer} value={m.trainerName} last /> : null}
      </Card>

      <Card>
        <Txt variant="section">{t.profile.sendFeeTo}</Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label">{m.payTo.label}</Txt>
            <Text style={styles.payNumber} selectable>
              {formatPhone(m.payTo.number)}
            </Text>
            <Txt variant="small">{t.profile.accountTitle(m.payTo.title)}</Txt>
          </View>
          <Button
            kind="secondary"
            icon={copied ? 'checkmark' : 'copy-outline'}
            label={copied ? t.common.copied : t.common.copy}
            onPress={copyNumber}
          />
        </Row>
        <Divider />
        {m.pendingProof ? (
          <Banner text={t.profile.waiting} />
        ) : (
          <Button
            kind="primary"
            icon="image-outline"
            label={uploading ? t.profile.uploading : t.profile.uploadProof}
            loading={uploading}
            onPress={uploadProof}
          />
        )}
        {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
      </Card>

      <Card>
        {m.pendingFreeze ? (
          <Banner text={t.profile.freezePending(m.pendingFreeze.days)} />
        ) : freezeOpen ? (
          <FreezeForm
            dueOn={m.dueOn}
            onCancel={() => setFreezeOpen(false)}
            onSent={async () => {
              setFreezeOpen(false);
              await membership.refresh();
            }}
          />
        ) : (
          <Button kind="secondary" icon="snow-outline" label={t.profile.freeze} onPress={() => setFreezeOpen(true)} />
        )}
      </Card>

      <Row gap={space.sm}>
        <Button style={{ flex: 1 }} kind="secondary" icon="qr-code-outline" label={t.profile.showQr} onPress={() => router.push('/checkin')} />
        <Button style={{ flex: 1 }} kind="secondary" icon="barbell-outline" label={t.profile.startWorkout} onPress={() => router.navigate('/workout')} />
      </Row>

      <Card>
        <Txt variant="section">{t.profile.announcements}</Txt>
        {announcements.data?.length ? (
          announcements.data.map((a) => (
            <View key={a.id} style={styles.announcement}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="label" style={{ flex: 1 }}>
                  {a.title}
                </Txt>
                <Txt variant="small">{formatShortDate(a.createdAt.slice(0, 10))}</Txt>
              </Row>
              <Txt>{a.body}</Txt>
            </View>
          ))
        ) : announcements.loading ? (
          <Loading />
        ) : (
          <Txt variant="small">{t.profile.noAnnouncements}</Txt>
        )}
      </Card>

      <Card>
        {passwordOpen ? (
          <ChangePasswordForm onDone={() => setPasswordOpen(false)} />
        ) : (
          <Button kind="secondary" icon="key-outline" label={t.profile.changePassword} onPress={() => setPasswordOpen(true)} />
        )}
      </Card>

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
      ) : (
        <Button kind="ghost" icon="log-out-outline" label={t.profile.logout} onPress={() => setConfirmLogout(true)} />
      )}
    </Screen>
  );
}

function InfoRow({ label, value, color, last }: { label: string; value: ReactNode; color?: string; last?: boolean }) {
  return (
    <Row style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Txt variant="small" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="label" color={color} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </Row>
  );
}

const REASONS: FreezeReason[] = ['travel', 'illness', 'other'];

function FreezeForm({ dueOn, onCancel, onSent }: { dueOn: string; onCancel: () => void; onSent: () => void }) {
  const [reason, setReason] = useState<FreezeReason>('travel');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestFreeze({ days, reason });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Txt variant="label">{t.profile.freeze}</Txt>
      <Txt variant="section">{t.profile.freezeReason}</Txt>
      <Segmented
        options={REASONS.map((r) => ({ value: r, label: t.profile.freezeReasons[r] }))}
        value={reason}
        onChange={setReason}
      />
      <Txt variant="section">{t.profile.freezeDays}</Txt>
      <Stepper big value={days} min={FREEZE_MIN_DAYS} max={FREEZE_MAX_DAYS} onChange={setDays} unit="days" />
      <Txt center variant="label">
        {t.profile.freezeNewDue(formatShortDate(addDays(dueOn, days)))}
      </Txt>
      {error ? <Banner tone="error" text={error} /> : null}
      <Row>
        <Button style={{ flex: 1 }} kind="secondary" label={t.common.cancel} onPress={onCancel} />
        <Button style={{ flex: 1 }} label={t.profile.freezeSend} loading={busy} onPress={send} />
      </Row>
    </View>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (next.length < 6) return setError(t.profile.passwordShort);
    if (next !== repeat) return setError(t.profile.passwordMismatch);
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setDone(true);
      setTimeout(onDone, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Txt variant="label">{t.profile.changePassword}</Txt>
      <Field label={t.profile.currentPassword} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
      <Field label={t.profile.newPassword} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
      <Field label={t.profile.confirmPassword} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" />
      {error ? <Banner tone="error" text={error} /> : null}
      {done ? <Banner tone="success" text={t.profile.passwordChanged} /> : null}
      <Row>
        <Button style={{ flex: 1 }} kind="secondary" label={t.common.cancel} onPress={onDone} />
        <Button style={{ flex: 1 }} label={t.common.save} loading={busy} onPress={submit} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  infoRow: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  payNumber: { fontFamily: fonts.display, fontSize: 30, color: colors.text, letterSpacing: 0.5 },
  announcement: {
    gap: space.xs,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
