'use client';

import type { WhatsAppMessage } from '@gym/shared';
import { useState } from 'react';
import { useDesk } from '@/components/Shell';
import { Empty, ErrorBox, Loading, PageHead, Segmented } from '@/components/ui';
import { formatPhone, formatPkDateTime } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

type Tab = 'to_send' | 'sent' | 'all';

/**
 * §6 WhatsApp (reception, owner): To send / Sent / All. Each shows type, member,
 * phone, time, text, "Open in WhatsApp" (wa.me link with the text) and Mark sent.
 * "Add fee reminders" queues reminders for overdue and due-in-3-days members,
 * skipping anyone reminded in the last 7 days (rule applied by the API).
 */
export default function WhatsAppPage() {
  const { api } = useSession();
  const { notify } = useDesk();
  const [tab, setTab] = useState<Tab>('to_send');
  const list = useLoad(() => api.whatsapp(tab), [api, tab]);
  const reminders = useAction();

  async function addReminders() {
    const res = await reminders.run(() => api.queueFeeReminders());
    if (res) {
      notify(t.whatsapp.remindersQueued(res.queued));
      list.reload();
    }
  }

  function replace(updated: WhatsAppMessage) {
    list.setData((prev) =>
      (prev ?? [])
        .map((m) => (m.id === updated.id ? updated : m))
        .filter((m) => tab === 'all' || (tab === 'to_send' ? m.status === 'queued' : m.status === 'sent')),
    );
  }

  return (
    <>
      <PageHead
        title={t.whatsapp.title}
        actions={
          <button type="button" className="btn primary" disabled={reminders.busy} onClick={addReminders} title={t.whatsapp.remindersHint}>
            {t.whatsapp.addReminders}
          </button>
        }
      />
      <p className="small muted" style={{ marginTop: -8 }}>
        {t.whatsapp.remindersHint}
      </p>
      {reminders.error ? <ErrorBox message={reminders.error} /> : null}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          label={t.whatsapp.title}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'to_send', label: t.whatsapp.toSend },
            { value: 'sent', label: t.whatsapp.sent },
            { value: 'all', label: t.whatsapp.all },
          ]}
        />
      </div>
      <div className="card flush">
        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? (
          <Loading />
        ) : list.data?.length ? (
          list.data.map((m) => <MessageRow key={m.id} message={m} onChanged={replace} />)
        ) : (
          <Empty>{t.whatsapp.none}</Empty>
        )}
      </div>
    </>
  );
}

function MessageRow({ message: m, onChanged }: { message: WhatsAppMessage; onChanged: (m: WhatsAppMessage) => void }) {
  const { api } = useSession();
  const { busy, error, run } = useAction();

  async function markSent() {
    const res = await run(() => api.setWhatsappStatus(m.id, 'sent'));
    if (res) onChanged(res);
  }

  return (
    <div className="message">
      <div className="spread">
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">{t.labels.whatsappKind[m.kind]}</span>
          <span className="cell-main">{m.memberName ?? '—'}</span>
          <span className="cell-sub mono">{formatPhone(m.toPhone)}</span>
        </div>
        <div className="row small muted">
          {m.status === 'failed' ? <span className="chip blocked">{t.whatsapp.failed}</span> : null}
          {m.status === 'sent' ? <span className="chip allowed">{t.labels.whatsappStatus.sent}</span> : null}
          {formatPkDateTime(m.createdAt)}
        </div>
      </div>
      <div className="message-body">{m.body}</div>
      <div className="row">
        <a className="btn small primary" href={m.link} target="_blank" rel="noreferrer">
          {t.whatsapp.open}
        </a>
        {m.status !== 'sent' ? (
          <button type="button" className="btn small" disabled={busy} onClick={markSent}>
            {t.whatsapp.markSent}
          </button>
        ) : null}
        {error ? <span className="field-error">{error}</span> : null}
      </div>
    </div>
  );
}
