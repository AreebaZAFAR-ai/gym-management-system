import { Injectable } from '@nestjs/common';

export const REGISTER_LIMIT = 5;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;

/**
 * Public gym registration: at most 5 registrations per client address per hour,
 * so the open endpoint cannot be used to mass-create gyms. Kept in memory like
 * the login limiter, so the limit applies per API process.
 */
@Injectable()
export class RegisterLimiter {
  private readonly tries = new Map<string, number[]>();

  attempt(key: string, now = Date.now()): boolean {
    if (this.tries.size > 10_000) {
      for (const [k, times] of this.tries) if (times.every((t) => now - t >= REGISTER_WINDOW_MS)) this.tries.delete(k);
    }
    const recent = (this.tries.get(key) ?? []).filter((t) => now - t < REGISTER_WINDOW_MS);
    if (recent.length >= REGISTER_LIMIT) {
      this.tries.set(key, recent);
      return false;
    }
    recent.push(now);
    this.tries.set(key, recent);
    return true;
  }

  /** Forget every try (tests). */
  reset() {
    this.tries.clear();
  }
}
