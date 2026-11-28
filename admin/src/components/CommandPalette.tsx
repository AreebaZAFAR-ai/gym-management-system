'use client';

import type { MemberListItem } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { t } from '@/lib/strings';
import { useDesk } from './Shell';
import { StatusPill } from './ui';

interface Item {
  key: string;
  label: string;
  sub?: string;
  member?: MemberListItem;
  run: () => void;
}

/**
 * §6: Ctrl+K search to find members by name, ID or phone and run actions
 * (Add member, Record payment, Check in, Send fee reminders).
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { api } = useSession();
  const { openPayment, notify } = useDesk();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(query.trim(), 200);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (!q) return setMembers([]);
    let current = true;
    api
      .members({ q })
      .then((list) => current && setMembers(list.slice(0, 8)))
      .catch(() => current && setMembers([]));
    return () => {
      current = false;
    };
  }, [api, q]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const actions: Item[] = [
      { key: 'add', label: t.palette.addMember, run: go('/members/new') },
      {
        key: 'pay',
        label: t.palette.recordPayment,
        run: () => {
          onClose();
          openPayment();
        },
      },
      { key: 'checkin', label: t.palette.checkIn, run: go('/checkins') },
      {
        key: 'remind',
        label: t.palette.sendReminders,
        run: () => {
          onClose();
          api
            .queueFeeReminders()
            .then((r) => notify(t.whatsapp.remindersQueued(r.queued)))
            .catch((e: Error) => notify(e.message))
            .finally(() => router.push('/whatsapp'));
        },
      },
    ];
    const needle = query.trim().toLowerCase();
    const matchedActions = needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : actions;
    const memberItems: Item[] = members.map((m) => ({
      key: m.memberId,
      label: m.name,
      sub: `${m.code} · ${formatPhone(m.phone)}`,
      member: m,
      run: go(`/members/${encodeURIComponent(m.code)}`),
    }));
    return [...memberItems, ...matchedActions];
  }, [api, members, notify, onClose, openPayment, query, router]);

  useEffect(() => setActive(0), [items.length]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  }

  const memberCount = items.filter((i) => i.member).length;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t.palette.label} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.palette.placeholder}
          aria-label={t.palette.label}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `pal-${items[active].key}` : undefined}
        />
        <ul id="palette-list" role="listbox">
          {memberCount ? <li className="pal-group">{t.palette.members}</li> : null}
          {q && !memberCount ? <li className="pal-group">{t.palette.noMatch}</li> : null}
          {items.map((item, i) => (
            <li key={item.key}>
              {i === memberCount ? <div className="pal-group">{t.palette.actions}</div> : null}
              <div
                id={`pal-${item.key}`}
                role="option"
                aria-selected={i === active}
                className="pal-item"
                onMouseEnter={() => setActive(i)}
                onClick={item.run}
              >
                <span>
                  <span className="cell-main">{item.label}</span>
                  {item.sub ? <span className="cell-sub"> · {item.sub}</span> : null}
                </span>
                {item.member ? <StatusPill status={item.member.status} /> : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="pal-foot">{t.palette.hint}</div>
      </div>
    </div>
  );
}
