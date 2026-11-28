'use client';

import type { MembershipStatus } from '@gym/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '@/lib/strings';

export function PageHead({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="page-title">{title}</h1>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: MembershipStatus }) {
  return <span className={`chip ${status}`}>{t.labels.status[status]}</span>;
}

export function Loading() {
  return (
    <div className="empty" role="status">
      {t.common.loading}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn small" onClick={onRetry}>
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="banner error" role="alert">
      {message}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  return <div className="empty">{children ?? t.common.empty}</div>;
}

export function Stat({ label, value, sub, danger }: { label: string; value: ReactNode; sub?: ReactNode; danger?: boolean }) {
  return (
    <div className={`card stat${danger ? ' danger' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub muted">{sub}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
      {error ? (
        <div className="field-error" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: V; label: string; count?: number }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined ? <span className="count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
          −
        </button>
        <output aria-live="polite">{format ? format(value) : value}</output>
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
          +
        </button>
      </div>
    </div>
  );
}

/** Modal dialog: Esc closes, focus moves inside and returns afterwards. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="btn icon ghost" aria-label={t.common.close} data-close onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Confirmation dialog (used instead of window.confirm). */
export function Confirm({
  message,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title={confirmLabel}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {t.common.cancel}
          </button>
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>
            {busy ? t.common.saving : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
      <FormError message={error} />
    </Dialog>
  );
}

export function CopyButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="btn small"
      onClick={(e) => {
        const btn = e.currentTarget;
        navigator.clipboard?.writeText(text).then(() => {
          btn.textContent = t.common.copied;
          window.setTimeout(() => (btn.textContent = t.common.copy), 1500);
        }, () => {});
      }}
    >
      {t.common.copy}
    </button>
  );
}
