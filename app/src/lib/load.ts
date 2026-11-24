import { barbellTotal, machineTotal, platesFor, type Equipment, type SetEntry } from '@gym/shared';

/** What is on the bar / stack / in hand right now. */
export type Load = {
  plates: number[]; // barbell, one side, in the order added
  db: number; // dumbbell kg
  blocks: number[]; // machine blocks in the order added
  added: number; // bodyweight extra kg
};

export const EMPTY_LOAD: Load = { plates: [], db: 10, blocks: [], added: 0 };

export function loadTotal(equipment: Equipment, load: Load): number {
  switch (equipment) {
    case 'bar':
      return barbellTotal(load.plates);
    case 'db':
      return load.db;
    case 'machine':
      return machineTotal(load.blocks);
    case 'body':
      return load.added;
  }
}

/** Build a load that matches a kg target (used for coach-set weights). */
export function loadFor(equipment: Equipment, kg: number | null): Load {
  if (kg == null) return EMPTY_LOAD;
  switch (equipment) {
    case 'bar':
      return { ...EMPTY_LOAD, plates: platesFor(kg) };
    case 'db':
      return { ...EMPTY_LOAD, db: kg };
    case 'machine': {
      const blocks: number[] = [];
      let left = kg;
      while (left >= 10) {
        blocks.push(10);
        left -= 10;
      }
      while (left >= 5) {
        blocks.push(5);
        left -= 5;
      }
      return { ...EMPTY_LOAD, blocks };
    }
    case 'body':
      return { ...EMPTY_LOAD, added: kg };
  }
}

/** The set as stored on the server, with plates/blocks for barbell and machine. */
export function toSetEntry(equipment: Equipment, load: Load, kg: number, reps: number, warmup: boolean): SetEntry {
  const entry: SetEntry = { kg, reps, warmup };
  if (equipment === 'bar' && !warmup) entry.plates = [...load.plates];
  if (equipment === 'machine' && !warmup) entry.blocks = [...load.blocks];
  return entry;
}
