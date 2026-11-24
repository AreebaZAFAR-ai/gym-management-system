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

  it('requires CORS_ORIGINS in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS: is required in production/);
    const env = parseEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.pk, https://b.pk' });
    expect(corsOrigins(env)).toEqual(['https://a.pk', 'https://b.pk']);
  });
});
