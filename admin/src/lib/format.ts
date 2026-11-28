import { formatShortDate, pkToday } from '@gym/shared';

export { formatPKR, formatPhone, formatShortDate, formatPkTime, PAYMENT_METHOD_LABELS } from '@gym/shared';

const PK_OFFSET_MS = 5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A due date as "25 Nov", or "—" when there is none yet (registered without a first payment). */

/** Pakistan business date of an ISO timestamp, "YYYY-MM-DD". */
export const pkDateOf = (iso: string) => pkToday(new Date(iso));

/** "25 Nov 2026" — used where the year matters (payments, joined). */
export function formatLongDate(date: string): string {
  const [y] = date.split('-');
  return `${formatShortDate(date)} ${y}`;
}

/** ISO timestamp -> "25 Nov, 6:30 pm" in Pakistan time. */
export function formatPkDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + PK_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

/** "2026-11" -> "Nov 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** First and last Pakistan date of the month containing `date`. */
export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Parse a whole-rupee amount typed by staff ("4,000" -> 4000). Null when not a whole number. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[,\s]/g, '').replace(/^PKR/i, '');
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** CSV cell per RFC 4180; also neutralises spreadsheet formulas. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
