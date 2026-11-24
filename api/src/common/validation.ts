import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Validates a request body or query with Zod; the first problem becomes a plain `{ message }`. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message ?? 'Invalid request.');
  }
  return result.data;
}

/** A real calendar date as "YYYY-MM-DD". */
export const isoDate = (message: string) =>
  z.string({ error: message }).refine((v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; // rejects 2026-02-30
  }, message);

/** Optional free text: trimmed; empty becomes null. */
export const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v == null || v.trim() === '' ? null : v.trim()));

export const uuidParam = z.string().uuid();
