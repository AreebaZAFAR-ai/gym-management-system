import Ionicons from '@expo/vector-icons/Ionicons';
import {
  formatPhone,
  formatPKR,
  formatShortDate,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type ScanResult,
} from '@gym/shared';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { Header } from '../components/Header';
import { Banner, Button, Card, Field, IconButton, Row, Screen, Segmented, StatusPill, Txt } from '../components/ui';
import { BRAND } from '../config';
import { RoleGate } from '../lib/routes';
import { useSession, useUser } from '../lib/session';
import { t } from '../strings';
import { colors, fonts, radius, space } from '../theme';

const METHODS: PaymentMethod[] = ['cash', 'jazzcash', 'easypaisa', 'bank'];

export default function ReceptionScreen() {
  return (
    <RoleGate roles={['reception', 'owner']}>
      <Reception />
    </RoleGate>
  );
}

function Reception() {
  const router = useRouter();
  const user = useUser();
  const { logout } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [renewedMessage, setRenewedMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const scanLock = useRef(false);

  const check = async (code: string) => {
    if (scanLock.current || !code.trim()) return;
    scanLock.current = true;
    setChecking(true);
    setError(null);
    try {
      setResult(await api.scan(code.trim()));
      setRenewedMessage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      scanLock.current = false;
    } finally {
      setChecking(false);
    }
  };

  const scanNext = () => {
    setResult(null);
    setRenewedMessage(null);
    setTyped('');
    setError(null);
    scanLock.current = false;
  };

  const onBarcode = (e: BarcodeScanningResult) => void check(e.data);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <Header
          name={user.name}
          right={
            <>
              <Txt variant="label">{BRAND.name}</Txt>
              <IconButton icon="log-out-outline" label={t.a11y.logout} onPress={() => setConfirmLogout(true)} />
            </>
          }
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

        {result ? (
          <ResultCard result={result} renewedMessage={renewedMessage} onRenewed={(r, msg) => { setResult(r); setRenewedMessage(msg); }} onNext={scanNext} />
        ) : (
          <>
            <View style={styles.cameraBox}>
              {!permission ? null : permission.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={checking ? undefined : onBarcode}
                />
              ) : (
                <View style={styles.permission}>
                  <Ionicons name="camera-outline" size={40} color={colors.onBrand} />
                  <Text style={styles.permissionTitle}>{t.reception.permissionTitle}</Text>
                  <Text style={styles.permissionBody}>{t.reception.permissionBody}</Text>
                  <Button kind="secondary" label={t.reception.allowCamera} onPress={() => void requestPermission()} />
                </View>
              )}
              {permission?.granted ? <View pointerEvents="none" style={styles.frame} /> : null}
              {checking ? (
                <View style={styles.checking}>
                  <Text style={styles.permissionTitle}>{t.reception.checking}</Text>
                </View>
              ) : null}
            </View>

            {error ? <Banner tone="error" text={error} /> : null}

            <Card>
              <Txt variant="label">{t.reception.noPhone}</Txt>
              <Field
                label={t.reception.typeId}
                value={typed}
                onChangeText={setTyped}
                placeholder={t.reception.idPlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void check(typed)}
              />
              <Button label={t.reception.check} icon="search" loading={checking} disabled={!typed.trim()} onPress={() => void check(typed)} />
            </Card>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function ResultCard({
  result,
  renewedMessage,
  onRenewed,
  onNext,
}: {
  result: ScanResult;
  renewedMessage: string | null;
  onRenewed: (r: ScanResult, message: string) => void;
  onNext: () => void;
}) {
  if (!result.ok) {
    // Expired, forged, other-gym or unknown codes: plain reason.
    return (
      <>
        <View style={[styles.verdict, { backgroundColor: colors.red }]}>
          <Ionicons name="alert-circle" size={40} color="#fff" />
          <Text style={styles.verdictText}>{result.message}</Text>
        </View>
        <Button big label={t.reception.scanNext} icon="scan" onPress={onNext} />
      </>
    );
  }

  const m = result.member;
  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title">{m.name}</Txt>
            <Txt variant="label">{m.code}</Txt>
          </View>
          <StatusPill status={m.status} />
        </Row>
        <Txt>{m.planName}</Txt>
        <Txt variant="small">
          {formatPhone(m.phone)} · {t.reception.dueOn(formatShortDate(m.dueOn))}
        </Txt>
      </Card>

      <View
        accessibilityLiveRegion="assertive"
        style={[styles.verdict, { backgroundColor: result.allowed ? colors.green : colors.red }]}
      >
        <Ionicons name={result.allowed ? 'checkmark-circle' : 'close-circle'} size={44} color="#fff" />
        <Text style={styles.verdictText}>
          {result.allowed
            ? t.reception.allowed
            : t.reception.blocked(result.amountDue ? `${result.message}, ${formatPKR(result.amountDue)}` : result.message)}
        </Text>
      </View>

      {renewedMessage ? <Banner tone="success" text={renewedMessage} /> : null}

      {!result.allowed && result.amountDue != null ? (
        <PaymentForm
          memberCode={m.code}
          defaultAmount={result.amountDue}
          onSaved={async (newDueOn) => {
            // Log the now-allowed entry so the day's check-ins are complete.
            const again = await api.scan(m.code);
            onRenewed(again, t.reception.renewed(formatShortDate(newDueOn)));
          }}
        />
      ) : null}

      <Button big label={t.reception.scanNext} icon="scan" onPress={onNext} />
    </>
  );
}

function PaymentForm({
  memberCode,
  defaultAmount,
  onSaved,
}: {
  memberCode: string;
  defaultAmount: number;
  onSaved: (newDueOn: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [txnId, setTxnId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const amountPkr = Number(amount.replace(/[^\d]/g, ''));
    if (!amountPkr) return setError('Enter the amount received.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.recordPayment({ memberCode, amountPkr, method, txnId: txnId.trim() || null });
      await onSaved(res.newDueOn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Txt variant="label">{t.reception.recordPayment}</Txt>
      <Field label={t.reception.amount} value={amount} onChangeText={setAmount} keyboardType="number-pad" prefix="PKR" />
      <Txt variant="label">{t.reception.method}</Txt>
      <Segmented
        options={METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
        value={method}
        onChange={setMethod}
      />
      {method !== 'cash' ? (
        <Field label={t.reception.txnId} value={txnId} onChangeText={setTxnId} autoCapitalize="characters" />
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Button big kind="success" icon="cash-outline" label={t.reception.savePayment} loading={busy} onPress={save} />
    </Card>
  );
}

const styles = StyleSheet.create({
  cameraBox: {
    height: 420,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  checking: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(23,25,28,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: { alignItems: 'center', gap: space.md, padding: space.xl },
  permissionTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.onBrand },
  permissionBody: { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  verdict: {
    borderRadius: radius.card,
    padding: space.xl,
    alignItems: 'center',
    gap: space.sm,
  },
  verdictText: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: '#fff', textAlign: 'center' },
});
