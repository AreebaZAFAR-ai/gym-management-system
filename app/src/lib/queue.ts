import type { ExerciseSessionInput } from '@gym/shared';
import { api } from '../api';
import { KEYS, local } from './storage';

/**
 * Offline queue for finished exercises (spec §4.3, §7, §11).
 * Each exercise is saved on the phone first with an ID the phone creates,
 * then sent when online. The server ignores IDs it already has, so a retry
 * after a lost response never creates duplicates.
 */

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let flushing: Promise<void> | null = null;

async function read(): Promise<ExerciseSessionInput[]> {
  return (await local.get<ExerciseSessionInput[]>(KEYS.queue)) ?? [];
}

async function notify() {
  const n = (await read()).length;
  listeners.forEach((l) => l(n));
}

export function subscribePending(listener: Listener): () => void {
  listeners.add(listener);
  void read().then((q) => listener(q.length));
  return () => listeners.delete(listener);
}

export async function enqueueSession(session: ExerciseSessionInput): Promise<void> {
  const q = await read();
  await local.set(KEYS.queue, [...q.filter((s) => s.id !== session.id), session]);
  await notify();
  void flushQueue();
}

/** Sends everything waiting. Safe to call often; concurrent calls share one run. */
export function flushQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const q = await read();
      if (q.length === 0) return;
      await api.saveSessions(q);
      // Remove only what we sent; new items may have arrived meanwhile.
      const sent = new Set(q.map((s) => s.id));
      const rest = (await read()).filter((s) => !sent.has(s.id));
      await local.set(KEYS.queue, rest);
      await notify();
    } catch {
      // Offline or server error: keep the queue and try again later.
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export async function pendingSessions(): Promise<ExerciseSessionInput[]> {
  return read();
}
