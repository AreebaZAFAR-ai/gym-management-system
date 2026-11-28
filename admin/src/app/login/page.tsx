'use client';

import { normalizePhone } from '@gym/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, FormError } from '@/components/ui';
import { useAction } from '@/lib/hooks';
import { homeFor } from '@/lib/nav';
import { API_URL, useSession } from '@/lib/session';
import { t } from '@/lib/strings';

const GYM_KEY = 'gym-admin-gym-code';

/** §6 Login: gym code, mobile number, password. Member accounts are refused. */
export default function LoginPage() {
  const { api, state, user, signIn } = useSession();
  const router = useRouter();
  const [gymId, setGymId] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [registered, setRegistered] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    // Arriving from "Register your gym": fill in and show the new Gym Code.
    const fromRegister = new URLSearchParams(window.location.search).get('registered')?.trim().toLowerCase();
    if (fromRegister && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(fromRegister)) {
      setRegistered(fromRegister);
      setGymId(fromRegister);
      return;
    }
    try {
      setGymId(window.localStorage.getItem(GYM_KEY) ?? '');
    } catch {
      // Storage unavailable; the field starts empty.
    }
  }, []);

  useEffect(() => {
    if (state === 'signed-in' && user) router.replace(homeFor(user.role));
  }, [state, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const gym = gymId.trim().toLowerCase();
    if (!gym) return setError(t.login.gymRequired);
    if (!normalizePhone(phone)) return setError(t.login.phoneInvalid);
    if (!password) return setError(t.login.passwordRequired);

    const res = await run(() => api.login({ gymId: gym, phone, password }));
    if (!res) return;
    if (res.user.role === 'member') {
      // The token is discarded; members only use the mobile app.
      setError(t.login.membersRefused);
      return;
    }
    try {
      window.localStorage.setItem(GYM_KEY, gym);
    } catch {
      // Not remembered; harmless.
    }
    signIn(res.token, res.user);
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <Link href="/" className="lp-logo login-logo">
          <span className="lp-logo-mark">{t.product.mark}</span>
          <span className="lp-logo-name">{t.product.name}</span>
        </Link>
        <h1 className="login-title">{t.login.title}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {t.login.subtitle}
        </p>
        {!API_URL ? <FormError message={t.common.notConfigured} /> : null}
        {registered ? (
          <div className="banner ok" role="status" style={{ marginBottom: 16 }}>
            {t.login.registered(registered)}
          </div>
        ) : null}
        <form className="stack" onSubmit={submit} noValidate>
          <Field label={t.login.gymCode} htmlFor="gym">
            <input
              id="gym"
              className="input"
              value={gymId}
              onChange={(e) => setGymId(e.target.value)}
              placeholder={t.login.gymCodeHint}
              autoCapitalize="none"
              autoComplete="organization"
              spellCheck={false}
            />
          </Field>
          <Field label={t.login.phone} htmlFor="phone">
            <div className="input-group">
              <span className="prefix">{t.login.phonePrefix}</span>
              <input
                id="phone"
                className="input"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t.login.phoneHint}
                autoComplete="username"
              />
            </div>
          </Field>
          <Field label={t.login.password} htmlFor="password">
            <div className="input-group">
              <input
                id="password"
                className="input has-suffix"
                style={{ borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)' }}
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="btn suffix-btn"
                aria-label={show ? t.login.hidePassword : t.login.showPassword}
                aria-pressed={show}
                onClick={() => setShow((s) => !s)}
              >
                {show ? t.common.hide : t.common.show}
              </button>
            </div>
          </Field>
          <FormError message={error} />
          <button type="submit" className="btn primary big" disabled={busy || !API_URL}>
            {busy ? t.login.submitting : t.login.submit}
          </button>
        </form>
        <div className="login-foot">
          <p className="muted" style={{ margin: 0 }}>
            {t.login.noAccount}{' '}
            <Link href="/register" className="text-link">
              {t.login.registerLink}
            </Link>
          </p>
          <Link href="/" className="muted small">
            ← {t.login.backHome}
          </Link>
        </div>
      </div>
    </div>
  );
}
