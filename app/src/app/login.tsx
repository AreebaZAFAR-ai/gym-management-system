import Ionicons from '@expo/vector-icons/Ionicons';
import { formatPhone, normalizePhone } from '@gym/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { ApiError } from '../api';
import { MOCK_ACCOUNTS } from '../api/mock';
import { Banner, Button, Card, Field, Row, Screen, TextLink, Txt } from '../components/ui';
import { BRAND, USE_MOCK_API } from '../config';
import { homeFor } from '../lib/routes';
import { useSession } from '../lib/session';
import { t } from '../strings';
import { colors, space } from '../theme';

export default function Login() {
  const router = useRouter();
  const { login } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  async function submit() {
    const normalized = normalizePhone(phone);
    setPhoneError(normalized ? null : t.login.invalidPhone);
    setPasswordError(password ? null : t.login.passwordRequired);
    setError(null);
    if (!normalized || !password) return;
    setBusy(true);
    try {
      const user = await login(normalized, password, remember);
      router.replace(homeFor(user.role));
    } catch (e) {
      // One message for wrong number or wrong password (spec §4.1, §11).
      if (e instanceof ApiError && e.status === 401) setError(t.login.wrong);
      else setError(e instanceof Error ? e.message : t.common.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']} contentStyle={{ paddingTop: space.xxl }}>
        <View style={{ gap: space.sm }}>
          <View style={styles.logo}>
            <Txt variant="title" color={colors.onBrand}>
              {BRAND.short}
            </Txt>
          </View>
          <Txt variant="title">{BRAND.name}</Txt>
          <Txt variant="small">{BRAND.city}</Txt>
        </View>

        <Card style={{ gap: space.lg }}>
          <Field
            label={t.login.phone}
            prefix="+92"
            value={phone}
            onChangeText={(v) => {
              setPhone(v);
              setPhoneError(null);
            }}
            placeholder={t.login.phonePlaceholder}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            maxLength={16}
            error={phoneError}
          />
          <Field
            label={t.login.password}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setPasswordError(null);
            }}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="current-password"
            onSubmitEditing={submit}
            returnKeyType="go"
            error={passwordError}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? t.login.hide : t.login.show}
                onPress={() => setShowPassword((s) => !s)}
                hitSlop={10}
                style={styles.eye}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textSecondary} />
              </Pressable>
            }
          />
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="label">{t.login.remember}</Txt>
            <Switch
              accessibilityLabel={t.login.remember}
              value={remember}
              onValueChange={setRemember}
              trackColor={{ true: colors.brand, false: colors.border }}
            />
          </Row>
          {error ? <Banner tone="error" text={error} /> : null}
          <Button big label={t.login.submit} onPress={submit} loading={busy} />
          <View style={{ alignItems: 'center' }}>
            <TextLink label={t.login.forgot} onPress={() => setShowForgot((s) => !s)} />
          </View>
          {showForgot ? <Banner text={t.login.forgotBody} /> : null}
        </Card>

        {USE_MOCK_API ? (
          <Card>
            <Txt variant="section">{t.login.demoTitle}</Txt>
            <Txt variant="small">{t.login.demoBody}</Txt>
            {MOCK_ACCOUNTS.map((a) => (
              <Pressable
                key={a.phone}
                accessibilityRole="button"
                onPress={() => {
                  setPhone(formatPhone(a.phone));
                  setPassword(a.phone.slice(-6));
                  setError(null);
                }}
                style={styles.demo}
              >
                <Txt variant="label" style={{ flex: 1 }}>
                  {a.name}
                </Txt>
                <Txt variant="small">
                  {a.role} · {formatPhone(a.phone)}
                </Txt>
              </Pressable>
            ))}
          </Card>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  eye: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.sm,
  },
});
