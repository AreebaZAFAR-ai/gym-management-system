import { defineConfig } from 'vitest/config';

// Vitest compiles TypeScript with esbuild, which does not emit decorator
// metadata. API code therefore names every constructor dependency with
// @Inject(...) instead of relying on parameter types (see README).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
