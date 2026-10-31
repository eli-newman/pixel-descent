import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Every test is synchronous CPU work (some simulate long runs), so on a busy CI machine the 5s default only measures contention.
    testTimeout: 30_000,
  },
});
