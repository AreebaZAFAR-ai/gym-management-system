'use client';

import type { Announcement } from '@gym/shared';
import { useState, type FormEvent } from 'react';
import { useDesk } from '@/components/Shell';
import { Confirm, Empty, ErrorBox, Field, FormError, Loading, PageHead } from '@/components/ui';
import { formatPkDateTime } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';

/**
 * §6 Announcements (reception, owner): title and message, optional WhatsApp copy
 * to all active members. List with delete. Shown in the member app.
 */
export default function AnnouncementsPage() {
  const { api } = useSession();
  const { notify } = useDesk();
  const list = useLoad(() => api.announcements(), [api]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const post = useAction();
  const del = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return post.setError(t.announcements.titleRequired);
    if (!body.trim()) return post.setError(t.announcements.bodyRequired);
    const res = await post.run(() => api.createAnnouncement({ title: title.trim(), body: body.trim(), sendWhatsApp }));
    if (res) {
      setTitle('');
      setBody('');
      setSendWhatsApp(false);
      notify(t.announcements.posted(res.whatsappQueued));
      list.reload();
    }
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    const ok = await del.run(async () => {
      await api.deleteAnnouncement(id);
      return true;
    });
    if (ok) {
      setDeleting(null);
      list.setData((prev) => (prev ?? []).filter((a) => a.id !== id));
    }
  }

  return (
    <>
      <PageHead title={t.announcements.title} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="card stack" onSubmit={submit} noValidate>
          <h2 className="section-title" style={{ margin: 0 }}>
            {t.announcements.newTitle}
          </h2>
          <Field label={t.announcements.titleLabel} htmlFor="a-title">
            <input id="a-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t.announcements.body} htmlFor="a-body" hint={t.announcements.shownInApp}>
            <textarea id="a-body" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} />
            {t.announcements.whatsappCopy}
          </label>
          <FormError message={post.error} />
          <div>
            <button type="submit" className="btn primary" disabled={post.busy}>
              {post.busy ? t.announcements.posting : t.announcements.post}
            </button>
          </div>
        </form>

        <div className="card flush">
          <div className="card-head">
            <h2>{t.announcements.list}</h2>
          </div>
          {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
          {list.loading && !list.data ? (
            <Loading />
          ) : list.data?.length ? (
            list.data.map((a) => (
              <div key={a.id} className="message">
                <div className="spread">
                  <span className="cell-main">{a.title}</span>
                  <button type="button" className="btn small danger-ghost" onClick={() => setDeleting(a)}>
                    {t.common.delete}
                  </button>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
                <div className="small muted">{formatPkDateTime(a.createdAt)}</div>
              </div>
            ))
          ) : (
            <Empty>{t.announcements.none}</Empty>
          )}
        </div>
      </div>
      {deleting ? (
        <Confirm
          message={t.announcements.deleteConfirm}
          confirmLabel={t.common.delete}
          danger
          busy={del.busy}
          error={del.error}
          onConfirm={remove}
          onCancel={() => {
            del.setError(null);
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}
