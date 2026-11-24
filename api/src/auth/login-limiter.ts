import { Injectable } from '@nestjs/common';

export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * §11: rate-limit login to 10 tries per phone per 15 minutes.
 * Kept in memory, so the limit applies per API process.
 */
@Injectable()
export class LoginLimiter {
  private readonly tries = new Map<string, number[]>();

  /** Records a try. Returns false when this phone has used up its tries for the window. */
  attempt(gymId: string, phone: string, now = Date.now()): boolean {
    if (this.tries.size > 10_000) this.prune(now);
    const key = `${gymId}:${phone}`;
    const recent = (this.tries.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_LIMIT) {
      this.tries.set(key, recent);
      return false;
    }
    recent.push(now);
    this.tries.set(key, recent);
    return true;
  }

  /** Drops phones with no tries inside the window, so memory stays bounded. */
  private prune(now: number) {
    for (const [key, times] of this.tries) {
      if (times.every((t) => now - t >= LOGIN_WINDOW_MS)) this.tries.delete(key);
    }
  }
}
