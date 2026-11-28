'use client';

import {
  formatPhone,
  gymCodeFromName,
  isValidContactPhone,
  isValidEmail,
  normalizePhone,
  passwordProblem,
  type RegisterGymRequest,
  type RegisterGymResponse,
} from '@gym/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Icon } from '@/components/Landing';
import { Field, FormError } from '@/components/ui';
import { useAction } from '@/lib/hooks';
import { homeFor } from '@/lib/nav';
import { API_URL, useSession } from '@/lib/session';
import { t } from '@/lib/strings';

const R = t.register;
/** Same key the login page reads, so the new Gym Code is filled in there. */
const GYM_KEY = 'gym-admin-gym-code';
const REDIRECT_SECONDS = 20;

type Form = RegisterGymRequest;
type Errors = Partial<Record<keyof Form, string>>;

const EMPTY: Form = {
  gymName: '', gymEmail: '', gymPhone: '', gymAddress: '', city: '',
  ownerName: '', ownerEmail: '', ownerPhone: '', password: '', confirmPassword: '',
};

/** The same rules the API enforces, checked first so every problem shows at once. */
function validate(f: Form): Errors {
  const e: Errors = {};
  const req = (k: keyof Form, label: string) => {
    if (!f[k].trim()) e[k] = R.required(label);
  };
  req('gymName', R.gymName);
  req('gymEmail', R.gymEmail);
  req('gymPhone', R.gymPhone);
  req('gymAddress', R.gymAddress);
  req('city', R.city);
  req('ownerName', R.ownerName);
  req('ownerEmail', R.ownerEmail);
  req('ownerPhone', R.ownerPhone);
  if (!e.gymEmail && !isValidEmail(f.gymEmail)) e.gymEmail = R.emailInvalid;
  if (!e.ownerEmail && !isValidEmail(f.ownerEmail)) e.ownerEmail = R.emailInvalid;
  if (!e.gymPhone && !isValidContactPhone(f.gymPhone)) e.gymPhone = R.gymPhoneInvalid;
  if (!e.ownerPhone && !normalizePhone(f.ownerPhone)) e.ownerPhone = R.ownerPhoneInvalid;
  if (!f.password) e.password = R.required(R.password);
  else if (!f.confirmPassword) e.confirmPassword = R.required(R.confirmPassword);
  else {
    const p = passwordProblem(f.password, f.confirmPassword);
    if (p) e[f.password === f.confirmPassword ? 'password' : 'confirmPassword'] = p;
  }
  return e;
}

/** Public page: a gym owner registers their gym and gets the Gym Code for login. */
export default function RegisterPage() {
  const { api, state, user } = useSession();
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState(false);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState<RegisterGymResponse | null>(null);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    if (state === 'signed-in' && user && !done) router.replace(homeFor(user.role));
  }, [state, user, router, done]);

  const set = (k: keyof Form) => (ev: { target: { value: string } }) => {
    const next = { ...form, [k]: ev.target.value };
    setForm(next);
    if (touched) setErrors(validate(next));
  };

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setTouched(true);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) {
      setError(R.fixErrors);
      document.getElementById(Object.keys(found)[0]!)?.focus();
      return;
    }
    const res = await run(() => api.registerGym(form));
    if (!res) return;
    try {
      window.localStorage.setItem(GYM_KEY, res.gymId);
    } catch {
      // Not remembered; the code is shown on screen.
    }
    setDone(res);
    window.scrollTo({ top: 0 });
  }

  const codePreview = form.gymName.trim() ? gymCodeFromName(form.gymName) : null;
  const input = (k: keyof Form, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={k}
      className="input"
      value={form[k]}
      onChange={set(k)}
      aria-invalid={errors[k] ? true : undefined}
      aria-describedby={errors[k] ? `${k}-error` : undefined}
      {...extra}
    />
  );

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link href="/" className="lp-logo on-dark">
          <span className="lp-logo-mark">{t.product.mark}</span>
          <span className="lp-logo-name">{t.product.name}</span>
        </Link>
        <div>
          <h2 className="auth-aside-title">{R.asideTitle}</h2>
          <ul className="auth-points">
            {R.asidePoints.map((p) => (
              <li key={p}>
                <Icon name="check" size={18} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <Link href="/" className="auth-aside-back">
          ← {t.login.backHome}
        </Link>
      </aside>

      <main className="auth-main">
        {done ? (
          <Success result={done} />
        ) : (
          <div className="auth-form-wrap">
            <Link href="/" className="lp-logo auth-mobile-logo">
              <span className="lp-logo-mark">{t.product.mark}</span>
              <span className="lp-logo-name">{t.product.name}</span>
            </Link>
            <h1 className="login-title">{R.title}</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              {R.subtitle}
            </p>
            {!API_URL ? <FormError message={t.common.notConfigured} /> : null}

            <form className="stack" onSubmit={submit} noValidate>
              <fieldset className="auth-fieldset">
                <legend>{R.gymSection}</legend>
                <div className="form-grid">
                  <Field label={R.gymName} htmlFor="gymName" error={errors.gymName}
                    hint={codePreview && !errors.gymName ? R.codePreview(codePreview) : R.gymNameHint} className="full">
                    {input('gymName', { autoComplete: 'organization', maxLength: 100 })}
                  </Field>
                  <Field label={R.gymEmail} htmlFor="gymEmail" error={errors.gymEmail}>
                    {input('gymEmail', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
                  </Field>
                  <Field label={R.gymPhone} htmlFor="gymPhone" error={errors.gymPhone} hint={R.gymPhoneHint}>
                    {input('gymPhone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
                  </Field>
                  <Field label={R.gymAddress} htmlFor="gymAddress" error={errors.gymAddress} className="full">
                    {input('gymAddress', { autoComplete: 'street-address', maxLength: 300 })}
                  </Field>
                  <Field label={R.city} htmlFor="city" error={errors.city}>
                    {input('city', { autoComplete: 'address-level2', maxLength: 60 })}
                  </Field>
                </div>
              </fieldset>

              <fieldset className="auth-fieldset">
                <legend>{R.ownerSection}</legend>
                <div className="form-grid">
                  <Field label={R.ownerName} htmlFor="ownerName" error={errors.ownerName} className="full">
                    {input('ownerName', { autoComplete: 'name', maxLength: 100 })}
                  </Field>
                  <Field label={R.ownerEmail} htmlFor="ownerEmail" error={errors.ownerEmail} hint={R.ownerEmailHint}>
                    {input('ownerEmail', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
                  </Field>
                  <Field label={R.ownerPhone} htmlFor="ownerPhone" error={errors.ownerPhone} hint={R.ownerPhoneHint}>
                    <div className="input-group">
                      <span className="prefix">{t.login.phonePrefix}</span>
                      {input('ownerPhone', { type: 'tel', inputMode: 'tel', autoComplete: 'username', placeholder: t.login.phoneHint })}
                    </div>
                  </Field>
                  <Field label={R.password} htmlFor="password" error={errors.password} hint={R.passwordHint}>
                    <div className="input-group">
                      {input('password', {
                        type: show ? 'text' : 'password', autoComplete: 'new-password', className: 'input has-suffix',
                        style: { borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)' },
                      })}
                      <button type="button" className="btn suffix-btn" aria-pressed={show}
                        aria-label={show ? t.login.hidePassword : t.login.showPassword} onClick={() => setShow((s) => !s)}>
                        {show ? t.common.hide : t.common.show}
                      </button>
                    </div>
                  </Field>
                  <Field label={R.confirmPassword} htmlFor="confirmPassword" error={errors.confirmPassword}>
                    {input('confirmPassword', { type: show ? 'text' : 'password', autoComplete: 'new-password' })}
                  </Field>
                </div>
              </fieldset>

              <FormError message={error} />
              <button type="submit" className="btn primary big" disabled={busy || !API_URL}>
                {busy ? R.submitting : R.submit}
              </button>
              <p className="muted center-text">
                {R.haveAccount}{' '}
                <Link href="/login" className="text-link">
                  {R.loginLink}
                </Link>
              </p>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

function Success({ result }: { result: RegisterGymResponse }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(REDIRECT_SECONDS);
  const [copied, setCopied] = useState(false);
  const loginHref = `/login?registered=${encodeURIComponent(result.gymId)}`;

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      router.push(loginHref);
      return;
    }
    const id = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left, router, loginHref]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.gymId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the code is on screen to copy by hand.
    }
  }

  return (
    <div className="auth-form-wrap" role="status" aria-live="polite">
      <span className="success-badge">
        <Icon name="check" size={28} />
      </span>
      <h1 className="login-title">{R.successTitle}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {R.successBody(result.gymName)}
      </p>
      <div className="code-card">
        <span className="code-label">{R.codeLabel}</span>
        <div className="spread">
          <span className="secret code-value">{result.gymId}</span>
          <button type="button" className="btn small" onClick={copy}>
            {copied ? t.common.copied : t.common.copy}
          </button>
        </div>
      </div>
      <dl className="kv" style={{ margin: '8px 0 4px' }}>
        <dt>{R.signInGym}</dt>
        <dd className="mono">{result.gymId}</dd>
        <dt>{R.signInPhone}</dt>
        <dd>{formatPhone(result.ownerPhone)}</dd>
        <dt>{t.login.password}</dt>
        <dd>{R.signInPassword}</dd>
      </dl>
      <p className="muted small">{R.staffNote}</p>
      <Link className="btn primary big" href={loginHref}>
        {R.goLogin}
      </Link>
      {left !== null ? (
        <p className="muted small center-text">
          {R.redirecting(left)}{' '}
          <button type="button" className="text-link link-btn" onClick={() => setLeft(null)}>
            {R.stay}
          </button>
        </p>
      ) : null}
    </div>
  );
}
