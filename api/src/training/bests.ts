import { bestEstimatedMax, heaviestSet, type SetEntry } from '@gym/shared';

export interface SessionLike {
  exerciseId: string;
  date: string;
  sets: SetEntry[];
}

export interface Best {
  kg: number;
  reps: number;
  /** Best estimated 1-rep max over all sessions (§7 Epley). */
  estimatedMax: number;
}

/**
 * §7: personal best = heaviest non-warm-up set (more reps breaks a tie);
 * estimated max = best Epley value. Sessions in date order.
 */
export function bestsByExercise(sessions: readonly SessionLike[]): Map<string, Best> {
  const byEx = new Map<string, Best>();
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const top = heaviestSet(s.sets);
    if (!top) continue;
    const prev = byEx.get(s.exerciseId);
    const estimatedMax = Math.max(prev?.estimatedMax ?? 0, bestEstimatedMax(s.sets));
    if (!prev || top.kg > prev.kg || (top.kg === prev.kg && top.reps > prev.reps)) {
      byEx.set(s.exerciseId, { kg: top.kg, reps: top.reps, estimatedMax });
    } else {
      byEx.set(s.exerciseId, { ...prev, estimatedMax });
    }
  }
  return byEx;
}
