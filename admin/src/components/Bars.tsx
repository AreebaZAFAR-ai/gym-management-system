'use client';

import { useId, useState } from 'react';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Formatted value for the tooltip and labels. */
  display: string;
}

/**
 * Single-series column chart: one hue, thin columns with 4px rounded tops anchored
 * to the baseline, recessive axis, a hover/focus tooltip per column, only the
 * highest value labelled directly, and a visually hidden table for screen readers.
 */
export function Bars({
  data,
  caption,
  labelEvery = 1,
  emptyText,
}: {
  data: BarDatum[];
  caption: string;
  /** Show every n-th x label (long series such as 30 days). */
  labelEvery?: number;
  emptyText: string;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  if (!data.length || max === 0) return <div className="empty">{emptyText}</div>;
  const peak = data.findIndex((d) => d.value === max);

  return (
    <figure style={{ margin: 0 }}>
      <div className="bars" aria-hidden onMouseLeave={() => setActive(null)}>
        {data.map((d, i) => (
          <div
            key={d.key}
            className="bar-col"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            tabIndex={-1}
          >
            {active === i ? (
              <div className="bar-tip" role="presentation">
                <div className="small muted">{d.label}</div>
                <div className="cell-main mono">{d.display}</div>
              </div>
            ) : null}
            <span className="bar-value" style={{ visibility: i === peak ? 'visible' : 'hidden' }}>
              {d.display}
            </span>
            <div
              className={`bar${d.value === 0 ? ' zero' : ''}${active === i ? ' hot' : ''}`}
              style={{ height: `${Math.max(1, (d.value / max) * 100)}%` }}
            />
            <span className="bar-label" style={{ visibility: i % labelEvery === 0 ? 'visible' : 'hidden' }}>
              {d.label}
            </span>
          </div>
        ))}
      </div>
      <table className="sr-only" aria-labelledby={`${id}-cap`}>
        <caption id={`${id}-cap`}>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars for a handful of named categories (one series, one hue). */
export function HBars({ data, caption, emptyText }: { data: BarDatum[]; caption: string; emptyText: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (!data.length || max === 0) return <div className="empty">{emptyText}</div>;
  return (
    <div role="table" aria-label={caption}>
      {data.map((d) => (
        <div key={d.key} className="hbar-row" role="row">
          <span role="rowheader">{d.label}</span>
          <div className="hbar-track" aria-hidden>
            <div className="hbar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span role="cell" className="mono cell-main">
            {d.display}
          </span>
        </div>
      ))}
    </div>
  );
}
