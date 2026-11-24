import type { SetEntry } from './types';

export const BAR_KG = 20;
/** Plate pair chips, heaviest first. */
export const PLATES = [25, 20, 15, 10, 5] as const;
export type Plate = (typeof PLATES)[number];
export const PLATE_COLORS: Record<Plate, string> = {
  25: '#D7263D', // red
  20: '#1F5FBF', // blue
  15: '#F2C230', // yellow
  10: '#23824A', // green
  5: '#FFFFFF', // white
};
export const MACHINE_BLOCKS = [5, 10] as const;
export const DUMBBELL_STEP = 2.5;
export const BODYWEIGHT_ADDED_STEP = 5;

/** Barbell total = 20 kg bar + 2 × plates on one side. */
export function barbellTotal(platesPerSide: readonly number[]): number {
  return BAR_KG + 2 * platesPerSide.reduce((s, p) => s + p, 0);
}

/**
 * Plates (one side, heaviest first) to reach a target total, greedy.
 * Returns the closest load not above the target.
 */
export function platesFor(totalKg: number): number[] {
  let perSide = Math.max(0, (totalKg - BAR_KG) / 2);
  const out: number[] = [];
  for (const p of PLATES) {
    while (perSide >= p) {
      out.push(p);
      perSide -= p;
    }
  }
  return out;
}

/** Plates sorted for drawing: heaviest nearest the collar. */
export function sortPlates(plates: readonly number[]): number[] {
  return [...plates].sort((a, b) => b - a);
}

export function machineTotal(blocks: readonly number[]): number {
  return blocks.reduce((s, b) => s + b, 0);
}

export function roundTo(kg: number, step = 2.5): number {
  return Math.round(kg / step) * step;
}

/** Epley: kg × (1 + reps ÷ 30), rounded to 0.1 kg. */
export function estimatedOneRepMax(kg: number, reps: number): number {
  if (reps <= 0 || kg <= 0) return 0;
  if (reps === 1) return kg;
  return Math.round(kg * (1 + reps / 30) * 10) / 10;
}

const working = (sets: readonly SetEntry[]) => sets.filter((s) => !s.warmup);

/** Personal best = heaviest non-warm-up set (more reps breaks a tie). */
export function heaviestSet(sets: readonly SetEntry[]): SetEntry | null {
  let best: SetEntry | null = null;
  for (const s of working(sets)) {
    if (!best || s.kg > best.kg || (s.kg === best.kg && s.reps > best.reps)) best = s;
  }
  return best;
}

/** Volume = kg × reps over non-warm-up sets. */
export function sessionVolume(sets: readonly SetEntry[]): number {
  return working(sets).reduce((s, x) => s + x.kg * x.reps, 0);
}

export function bestEstimatedMax(sets: readonly SetEntry[]): number {
  return working(sets).reduce((m, s) => Math.max(m, estimatedOneRepMax(s.kg, s.reps)), 0);
}

/** Warm-ups: 50% × 8 then 70% × 5 of the working weight, rounded to 2.5 kg. */
export function warmupSets(workingKg: number): { kg: number; reps: number }[] {
  return [
    { kg: roundTo(workingKg * 0.5), reps: 8 },
    { kg: roundTo(workingKg * 0.7), reps: 5 },
  ];
}

/** "% of best": kg from the member's estimated max, rounded to 2.5 kg. */
export function kgFromPct(estimatedMax: number, pct: number): number {
  return roundTo((estimatedMax * pct) / 100);
}

export const REST_OPTIONS_SEC = [60, 90, 120, 180] as const;
export const PLAN_LIMITS = {
  exercises: { min: 1, max: 15 },
  clients: { min: 1, max: 100 },
  sets: { min: 1, max: 10 },
  reps: { min: 1, max: 50 },
  pct: { min: 30, max: 100 },
  restSec: { min: 0, max: 600 },
} as const;
