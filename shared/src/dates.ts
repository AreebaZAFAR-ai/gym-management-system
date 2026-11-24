/**
 * Business dates are Pakistan dates (Asia/Karachi, UTC+5, no daylight saving).
 * They travel as "YYYY-MM-DD" strings and are handled with UTC maths here so
 * the phone's own time zone never shifts them.
 */

const PK_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date in Pakistan as "YYYY-MM-DD". */
export function pkToday(now: Date | number = Date.now()): string {
  const ms = typeof now === 'number' ? now : now.getTime();
  return new Date(ms + PK_OFFSET_MS).toISOString().slice(0, 10);
}

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fmt(new Date(parse(date).getTime() + days * DAY_MS));
}

/** Calendar months, clamped to month end: 31 Jan + 1 = 28/29 Feb. */
export function addMonths(date: string, months: number): string {
  const d = parse(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);
}

/** "2026-11-25" -> "25 Nov" */
export function formatShortDate(date: string): string {
  const d = parse(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** ISO timestamp -> "6:30 pm" in Pakistan time. */
export function formatPkTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + PK_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}
