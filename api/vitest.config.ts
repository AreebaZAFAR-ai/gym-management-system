import { defineConfig } from 'vitest/config';

// Vitest compiles TypeScript with esbuild, which does not emit decorator
// metadata. API code therefore names every constructor dependency with
// @Inject(...) instead of relying on parameter types (see README).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // Each e2e file starts its own in-memory Postgres (PGlite) and applies the
    // migrations; with several files in parallel that can exceed the 10 s default.
    hookTimeout: 60_000,
  },
});
