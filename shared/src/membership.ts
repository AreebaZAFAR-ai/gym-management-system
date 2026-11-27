import { addDays, addMonths, daysBetween, formatShortDate } from './dates';
import type { MembershipStatus } from './types';

export const DUE_SOON_DAYS = 5;
export const DEFAULT_GRACE_DAYS = 3;
export const FREEZE_MIN_DAYS = 3;
export const FREEZE_MAX_DAYS = 15;

/**
 * Spec §7, checked in this order: frozen, overdue, due soon, active.
 * `dueOn` is null for a member registered without a first payment (§6 "Optional
 * first payment"). The §7 overdue and due-soon tests compare the due date, so with
 * no due date neither applies and the list falls through to "Active: otherwise".
 */
export function membershipStatus(
  dueOn: string | null,
  frozenUntil: string | null,
  today: string,
): MembershipStatus {
  if (frozenUntil && today <= frozenUntil) return 'frozen';
  if (dueOn !== null && dueOn < today) return 'overdue';
  if (dueOn !== null && daysBetween(today, dueOn) <= DUE_SOON_DAYS) return 'due_soon';
  return 'active';
}

export type EntryDecision =
  | { allowed: true }
  | { allowed: false; reason: 'frozen'; message: string }
  | { allowed: false; reason: 'overdue'; message: string; overdueSince: string };

/**
 * §7 Entry at the door: blocked if frozen; blocked if today is later than due date +
 * grace days; otherwise allowed. With no due date (no payment recorded yet) the
 * second test has nothing to compare, so only the frozen rule can block.
 */
export function entryDecision(
  m: { dueOn: string | null; frozenUntil: string | null },
  today: string,
  graceDays: number = DEFAULT_GRACE_DAYS,
): EntryDecision {
  if (m.frozenUntil && today <= m.frozenUntil) {
    return {
      allowed: false,
      reason: 'frozen',
      message: `Membership frozen until ${formatShortDate(m.frozenUntil)}`,
    };
  }
  if (m.dueOn !== null && today > addDays(m.dueOn, graceDays)) {
    return {
      allowed: false,
      reason: 'overdue',
      overdueSince: m.dueOn,
      message: `Fee overdue since ${formatShortDate(m.dueOn)}`,
    };
  }
  return { allowed: true };
}

/**
 * Paying early extends from the current due date; paying after the due date
 * starts from today. Returns the period covered.
 * With no current due date (first payment after registering without one) there is
 * nothing to extend, so the period starts on the payment date, as the first
 * payment at registration does (firstPaymentPeriod).
 */
export function paymentPeriod(
  dueOn: string | null,
  planMonths: number,
  today: string,
): { periodFrom: string; periodTo: string } {
  if (dueOn === null) return firstPaymentPeriod(planMonths, today);
  const periodFrom = dueOn >= today ? dueOn : today;
  return { periodFrom, periodTo: addMonths(periodFrom, planMonths) };
}

/**
 * First membership payment at registration: the period starts on the payment
 * date and runs for the plan's months (month-end clamped: 31 Jan + 1 = 28/29 Feb).
 * periodTo is the member's first due date.
 */
export function firstPaymentPeriod(
  planMonths: number,
  paymentDate: string,
): { periodFrom: string; periodTo: string } {
  return { periodFrom: paymentDate, periodTo: addMonths(paymentDate, planMonths) };
}

/**
 * On approval the due date moves later by the days frozen, and entry is blocked
 * until the freeze ends. With no due date there is nothing to move.
 */
export function applyFreeze<D extends string | null>(
  dueOn: D,
  days: number,
  today: string,
): { dueOn: D; frozenUntil: string } {
  return { dueOn: (dueOn === null ? null : addDays(dueOn, days)) as D, frozenUntil: addDays(today, days - 1) };
}

/** Freeze requests (§4.6, §7): one at a time, and not while already frozen. */
export const FREEZE_ALREADY_PENDING = 'You already have a freeze request waiting for reception.';
export const ALREADY_FROZEN = 'Your membership is already frozen.';

export function isValidFreezeDays(days: number): boolean {
  return Number.isInteger(days) && days >= FREEZE_MIN_DAYS && days <= FREEZE_MAX_DAYS;
}

/** IH + 419 -> "IH-0419" */
export function memberCode(prefix: string, n: number): string {
  return `${prefix}-${n.toString().padStart(4, '0')}`;
}
