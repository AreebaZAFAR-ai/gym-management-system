'use client';

import type { GymSettings } from '@gym/shared';
import { useState, type FormEvent } from 'react';
import { useDesk } from '@/components/Shell';
import { ErrorBox, Field, FormError, Loading, PageHead } from '@/components/ui';
import { useAction, useLoad } from '@/lib/hooks';
import { applyBrandColor, useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Settings (owner): gym name, city, app colour, grace days, where members send fees
 * (account type, number, title), reception WhatsApp, thumbprint machine address and
 * device key. The check-in secret is never returned by the API.
 */
export default function SettingsPage() {
  const { api } = useSession();
  const settings = useLoad(() => api.settings(), [api]);
  return (
    <>
      <PageHead title={t.settings.title} />
      {settings.error ? <ErrorBox message={settings.error} onRetry={settings.reload} /> : null}
      {settings.data ? <SettingsForm initial={settings.data} onSaved={settings.setData} /> : settings.loading ? <Loading /> : null}
    </>
  );
}

function SettingsForm({ initial, onSaved }: { initial: GymSettings; onSaved: (s: GymSettings) => void }) {
  const { api } = useSession();
  const { notify } = useDesk();
  const [s, setS] = useState<GymSettings>(initial);
  const { busy, error, run } = useAction();
  const set = <K extends keyof GymSettings>(key: K, value: GymSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const setPay = (key: keyof GymSettings['payTo'], value: string) => setS((prev) => ({ ...prev, payTo: { ...prev.payTo, [key]: value } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await run(() =>
      api.updateSettings({
        ...s,
        name: s.name.trim(),
        city: s.city.trim(),
        deviceAddress: s.deviceAddress?.trim() || null,
        deviceKey: s.deviceKey?.trim() || null,
      }),
    );
    if (res) {
      onSaved(res);
      setS(res);
      notify(t.settings.saved);
      applyBrandColor(res.primaryColor);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="card">
        <h2 className="section-title">{t.settings.gym}</h2>
        <div className="form-grid">
          <Field label={t.settings.name} htmlFor="g-name">
            <input id="g-name" className="input" value={s.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t.settings.city} htmlFor="g-city">
            <input id="g-city" className="input" value={s.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label={t.settings.color} htmlFor="g-color" hint={t.settings.colorHint}>
            <div className="row">
              <input
                type="color"
                aria-label={t.settings.color}
                value={/^#[0-9a-f]{6}$/i.test(s.primaryColor) ? s.primaryColor : '#17191c'}
                onChange={(e) => set('primaryColor', e.target.value.toUpperCase())}
                style={{ width: 52, height: 44, border: 0, background: 'none', padding: 0 }}
              />
              <input id="g-color" className="input mono grow" value={s.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
            </div>
          </Field>
          <Field label={t.settings.graceDays} htmlFor="g-grace" hint={t.settings.graceHint}>
            <input
              id="g-grace"
              className="input mono"
              type="number"
              min={0}
              step={1}
              value={s.graceDays}
              onChange={(e) => set('graceDays', e.target.value === '' ? 0 : Number(e.target.value))}
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">{t.settings.payTo}</h2>
        <div className="form-grid">
          <Field label={t.settings.payLabel} htmlFor="g-pl" hint={t.settings.payLabelHint}>
            <input id="g-pl" className="input" value={s.payTo.label} onChange={(e) => setPay('label', e.target.value)} />
          </Field>
          <Field label={t.settings.payNumber} htmlFor="g-pn">
            <input id="g-pn" className="input mono" value={s.payTo.number} onChange={(e) => setPay('number', e.target.value)} />
          </Field>
          <Field label={t.settings.payTitle} htmlFor="g-pt">
            <input id="g-pt" className="input" value={s.payTo.title} onChange={(e) => setPay('title', e.target.value)} />
          </Field>
          <Field label={t.settings.reception} htmlFor="g-rw">
            <input id="g-rw" className="input mono" type="tel" value={s.receptionWhatsapp} onChange={(e) => set('receptionWhatsapp', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">{t.settings.device}</h2>
        <div className="form-grid">
          <Field label={`${t.settings.deviceAddress} (${t.common.optional})`} htmlFor="g-da">
            <input id="g-da" className="input mono" value={s.deviceAddress ?? ''} onChange={(e) => set('deviceAddress', e.target.value)} />
          </Field>
          <Field label={`${t.settings.deviceKey} (${t.common.optional})`} htmlFor="g-dk" hint={t.settings.deviceKeyHint}>
            <input id="g-dk" className="input mono" value={s.deviceKey ?? ''} onChange={(e) => set('deviceKey', e.target.value)} autoComplete="off" />
          </Field>
        </div>
      </div>

      <FormError message={error} />
      <div>
        <button type="submit" className="btn primary big" disabled={busy}>
          {busy ? t.common.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
