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

/** Fields of the PostgreSQL error a driver error carries; logged, never sent to clients. */
export interface PgErrorInfo {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  table?: string;
  column?: string;
  constraint?: string;
}

/**
 * The original PostgreSQL error behind a database failure, if any. Drizzle wraps
 * it as `DrizzleQueryError("Failed query: …")` with the pg error as `cause`, so the
 * wrapper's message alone hides the real reason (e.g. 42703 undefined column).
 */
export function pgErrorOf(err: unknown): PgErrorInfo | null {
  let e = err as (Partial<PgErrorInfo> & { cause?: unknown }) | undefined;
  for (let i = 0; i < 4 && e; i++) {
    // SQLSTATE codes are exactly five characters; Node system errors (ECONNREFUSED…) are not.
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.message === 'string') {
      const { code, message, detail, hint, table, column, constraint } = e as PgErrorInfo;
      return { code, message, detail, hint, table, column, constraint };
    }
    e = e.cause as typeof e;
  }
  return null;
}

/** Start of a Pakistan business date (Asia/Karachi, UTC+5) as a UTC instant. */
export function pkDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+05:00`);
}
