import { addDays, addMonths, daysBetween, formatShortDate } from './dates';
import type { MembershipStatus } from './types';

export const DUE_SOON_DAYS = 5;
export const DEFAULT_GRACE_DAYS = 3;
export const FREEZE_MIN_DAYS = 3;
export const FREEZE_MAX_DAYS = 15;

/** Spec §7, checked in this order: frozen, overdue, due soon, active. */
export function membershipStatus(
  dueOn: string,
  frozenUntil: string | null,
  today: string,
): MembershipStatus {
  if (frozenUntil && today <= frozenUntil) return 'frozen';
  if (dueOn < today) return 'overdue';
  if (daysBetween(today, dueOn) <= DUE_SOON_DAYS) return 'due_soon';
  return 'active';
}

export type EntryDecision =
  | { allowed: true }
  | { allowed: false; reason: 'frozen'; message: string }
  | { allowed: false; reason: 'overdue'; message: string; overdueSince: string };

export function entryDecision(
  m: { dueOn: string; frozenUntil: string | null },
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
  if (today > addDays(m.dueOn, graceDays)) {
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
 */
export function paymentPeriod(
  dueOn: string,
  planMonths: number,
  today: string,
): { periodFrom: string; periodTo: string } {
  const periodFrom = dueOn >= today ? dueOn : today;
  return { periodFrom, periodTo: addMonths(periodFrom, planMonths) };
}

/** On approval the due date moves later by the days frozen. */
export function applyFreeze(
  dueOn: string,
  days: number,
  today: string,
): { dueOn: string; frozenUntil: string } {
  return { dueOn: addDays(dueOn, days), frozenUntil: addDays(today, days - 1) };
}

export function isValidFreezeDays(days: number): boolean {
  return Number.isInteger(days) && days >= FREEZE_MIN_DAYS && days <= FREEZE_MAX_DAYS;
}

/** IH + 419 -> "IH-0419" */
export function memberCode(prefix: string, n: number): string {
  return `${prefix}-${n.toString().padStart(4, '0')}`;
}
