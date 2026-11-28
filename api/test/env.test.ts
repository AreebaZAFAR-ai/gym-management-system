import { describe, expect, it } from 'vitest';
import { corsOrigins, parseEnv } from '../src/config/env';

const valid = {
  DATABASE_URL: 'postgresql://u:secret-pass@ep-x-pooler.region.aws.neon.tech/db?sslmode=require',
  JWT_SECRET: 'x'.repeat(32),
};

describe('environment', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('names missing variables without printing any values', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL: is missing[\s\S]*JWT_SECRET: is missing/);
    try {
      parseEnv({ ...valid, JWT_SECRET: 'short' });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('JWT_SECRET: must be at least 32 characters');
      expect(message).not.toContain('secret-pass');
      expect(message).not.toContain('short');
    }
  });

  it('rejects connection strings that are not PostgreSQL', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  const s3 = { S3_BUCKET: 'gym-proofs', S3_ACCESS_KEY_ID: 'key-id', S3_SECRET_ACCESS_KEY: 's3-secret-value' };

  it('requires CORS_ORIGINS in production', () => {
    expect(() => parseEnv({ ...valid, ...s3, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS: is required in production/);
    const env = parseEnv({ ...valid, ...s3, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.pk, https://b.pk' });
    expect(corsOrigins(env)).toEqual(['https://a.pk', 'https://b.pk']);
  });

  it('§8: S3-compatible storage is required in production, with its keys, never printing them', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.pk' })).toThrow(/S3_BUCKET: is required in production/);
    try {
      parseEnv({ ...valid, S3_BUCKET: 'b', S3_SECRET_ACCESS_KEY: 's3-secret-value' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('S3_ACCESS_KEY_ID: is required when S3_BUCKET is set');
      expect((err as Error).message).not.toContain('s3-secret-value');
    }
    expect(parseEnv({ ...valid, ...s3, S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com' })).toMatchObject({ S3_REGION: 'auto' });
    expect(parseEnv(valid).S3_BUCKET).toBeUndefined(); // development: local disk
  });
});
