'use client';

import { normalizePhone, type StaffMember, type StaffRole } from '@gym/shared';
import { useState, type FormEvent } from 'react';
import { useDesk } from '@/components/Shell';
import { Confirm, Empty, ErrorBox, Field, FormError, Loading, PageHead } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession, useUser } from '@/lib/session';
import { t } from '@/lib/strings';

const ROLES: StaffRole[] = ['reception', 'trainer', 'owner'];

/**
 * §6 Staff and roles (owner): list with role and what each role can do. Add staff
 * (name, mobile, role, starting password). Disable/Enable; owners cannot disable themselves.
 */
export default function StaffPage() {
  const { api } = useSession();
  const me = useUser();
  const { notify } = useDesk();
  const list = useLoad(() => api.staff(), [api]);
  const [disabling, setDisabling] = useState<StaffMember | null>(null);
  const toggle = useAction();

  async function setActive(s: StaffMember, active: boolean) {
    const res = await toggle.run(() => api.updateStaff(s.id, { active }));
    if (res) {
      setDisabling(null);
      list.setData((prev) => (prev ?? []).map((x) => (x.id === res.id ? res : x)));
    }
  }

  return (
    <>
      <PageHead title={t.staff.title} />
      <div className="stack">
        <div className="card flush">
          {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
          {toggle.error && !disabling ? <ErrorBox message={toggle.error} /> : null}
          {list.loading && !list.data ? (
            <Loading />
          ) : list.data?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.staff.name}</th>
                    <th>{t.staff.phone}</th>
                    <th>{t.staff.role}</th>
                    <th>{t.common.status}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-main">
                        {s.name}
                        {s.id === me.id ? <span className="chip" style={{ marginLeft: 8 }}>{t.staff.you}</span> : null}
                      </td>
                      <td className="mono">{formatPhone(s.phone)}</td>
                      <td>{t.labels.role[s.role]}</td>
                      <td>
                        <span className={`chip ${s.active ? 'active' : 'disabled'}`}>
                          {s.active ? t.labels.status.active : t.common.disabled}
                        </span>
                      </td>
                      <td className="right">
                        {s.id === me.id ? null : s.active ? (
                          <button type="button" className="btn small danger-ghost" onClick={() => setDisabling(s)}>
                            {t.common.disable}
                          </button>
                        ) : (
                          <button type="button" className="btn small" disabled={toggle.busy} onClick={() => setActive(s, true)}>
                            {t.common.enable}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )}
        </div>

        <div className="grid-2" style={{ alignItems: 'start' }}>
          <AddStaff
            onAdded={(s) => {
              list.setData((prev) => [...(prev ?? []), s]);
              notify(t.staff.added(s.name));
            }}
          />
          <div className="card">
            <h2 className="section-title">{t.staff.roles}</h2>
            <dl className="stack" style={{ margin: 0, gap: 12 }}>
              {(['owner', 'reception', 'trainer'] as const).map((r) => (
                <div key={r}>
                  <dt className="cell-main">{t.labels.role[r]}</dt>
                  <dd className="small muted" style={{ margin: 0 }}>
                    {t.staff.roleCan[r]}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
      {disabling ? (
        <Confirm
          message={t.staff.disableConfirm(disabling.name)}
          confirmLabel={t.common.disable}
          danger
          busy={toggle.busy}
          error={toggle.error}
          onConfirm={() => setActive(disabling, false)}
          onCancel={() => {
            toggle.setError(null);
            setDisabling(null);
          }}
        />
      ) : null}
    </>
  );
}

function AddStaff({ onAdded }: { onAdded: (s: StaffMember) => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('reception');
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t.staff.nameRequired);
    if (!normalizePhone(phone)) return setError(t.staff.phoneInvalid);
    if (!password) return setError(t.staff.passwordRequired);
    const res = await run(() => api.createStaff({ name: name.trim(), phone, role, password }));
    if (res) {
      setName('');
      setPhone('');
      setPassword('');
      setRole('reception');
      onAdded(res);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2 className="section-title" style={{ margin: 0 }}>
        {t.staff.add}
      </h2>
      <Field label={t.staff.name} htmlFor="s-name">
        <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={t.staff.phone} htmlFor="s-phone">
        <div className="input-group">
          <span className="prefix">{t.login.phonePrefix}</span>
          <input id="s-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.login.phoneHint} autoComplete="off" />
        </div>
      </Field>
      <Field label={t.staff.role} htmlFor="s-role">
        <select id="s-role" className="select" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.labels.role[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.staff.password} htmlFor="s-pass" hint={t.staff.passwordHint}>
        <input id="s-pass" className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <FormError message={error} />
      <div>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t.common.saving : t.staff.submit}
        </button>
      </div>
    </form>
  );
}
