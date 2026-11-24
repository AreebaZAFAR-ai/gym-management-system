/**
 * Name of the unique or foreign-key constraint a database error violated, if any.
 * Drizzle wraps driver errors, so the cause chain is searched.
 */
export function violatedConstraint(err: unknown): string | null {
  let e = err as { code?: string; constraint?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && e; i++) {
    if ((e.code === '23505' || e.code === '23503') && e.constraint) return e.constraint;
    e = e.cause as typeof e;
  }
  return null;
}

/** Start of a Pakistan business date (Asia/Karachi, UTC+5) as a UTC instant. */
export function pkDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+05:00`);
}
