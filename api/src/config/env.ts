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
    /**
     * Express "trust proxy": how many proxy hops to trust (default 1, the host's TLS proxy),
     * true/false, or a comma-separated list of proxy IPs/subnets. Decides whether
     * X-Forwarded-Proto (HTTPS check) and X-Forwarded-For (client IP) are believed.
     */
    TRUST_PROXY: z.string().trim().min(1).default('1'),
    /** Folder for uploaded payment screenshots (local disk; §8 development storage). Default ./uploads. */
    UPLOAD_DIR: z.string().trim().min(1).optional(),
    /**
     * §8 Files: S3-compatible storage (AWS S3, Cloudflare R2) in production. When
     * S3_BUCKET is set, screenshots are stored there instead of UPLOAD_DIR.
     */
    S3_BUCKET: z.string().trim().min(1).optional(),
    /** e.g. "me-central-1" for AWS; "auto" for Cloudflare R2. */
    S3_REGION: z.string().trim().min(1).default('auto'),
    /** Only for non-AWS providers, e.g. https://<account>.r2.cloudflarestorage.com */
    S3_ENDPOINT: z.url({ error: 'must be a URL' }).optional(),
    S3_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'is required in production' });
    }
    // §8: "Local disk in development; S3-compatible storage ... in production".
    if (env.NODE_ENV === 'production' && !env.S3_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'is required in production' });
    }
    if (env.S3_BUCKET) {
      for (const key of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required when S3_BUCKET is set' });
      }
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

/** TRUST_PROXY as Express expects it: a hop count, true/false, or a list of addresses. */
export function trustProxySetting(value: string): number | boolean | string {
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return v;
}

export function corsOrigins(env: Env): string[] {
  return (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
