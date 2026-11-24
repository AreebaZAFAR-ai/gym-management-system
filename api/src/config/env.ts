import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const postgresUrl = z
  .string()
  .trim()
  .refine((v) => /^postgres(ql)?:\/\/.+/.test(v), 'must be a postgresql:// connection string');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Neon pooled connection (host contains "-pooler"). Used by the running API. */
    DATABASE_URL: postgresUrl,
    /** Neon direct connection. Used only by migrations (drizzle.config.ts). */
    DATABASE_URL_DIRECT: postgresUrl.optional(),
    /** Signs login tokens. At least 32 characters; never commit it. */
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Comma-separated origins allowed to call the API from a browser (the web admin). */
    CORS_ORIGINS: z.string().trim().optional(),
    /** Folder for uploaded payment screenshots (local disk; §8 development storage). Default ./uploads. */
    UPLOAD_DIR: z.string().trim().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'is required in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables. Errors name the variable and the problem,
 * never its value, so secrets do not end up in logs.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.code === 'invalid_type' ? 'is missing' : i.message}`)
      .join('\n');
    throw new Error(`Invalid API configuration. Check api/.env:\n${problems}`);
  }
  return result.data;
}

/** Loads api/.env (if present) into process.env without overriding variables already set. */
export function loadDotEnv(dir: string = process.cwd()): void {
  const file = resolve(dir, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function corsOrigins(env: Env): string[] {
  return (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
