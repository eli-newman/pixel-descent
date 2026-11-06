import { defineConfig } from 'vitest/config';

/** The project has no @types/node: this is the one Node API the config reads. */
declare const process: { env: Record<string, string | undefined> };

/**
 * Analytics is on in builds made by Vercel (`VERCEL=1`) and when asked for with `VITE_ANALYTICS=1`; off everywhere
 * else, so `npm run dev`, unit tests and copies of `dist/` on other hosts never load a script. `vercelConfig` is the
 * script and endpoint paths Vercel passes at build time (read by `analyticsConfig` in `src/platform/analytics.ts`).
 * Dev uses Vercel's debug script, which logs to the console and sends nothing.
 */
function analytics(mode: string): { debug: boolean; vercelConfig: string } | null {
  const env = process.env;
  if (env['VERCEL'] !== '1' && env['VITE_ANALYTICS'] !== '1') return null;
  return {
    debug: mode === 'development',
    vercelConfig: env['VERCEL_OBSERVABILITY_CLIENT_CONFIG'] ?? '',
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  build: { target: 'es2022' },
  define: { __ANALYTICS__: JSON.stringify(analytics(mode)) },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Every test is synchronous CPU work (some simulate long runs), so on a busy CI machine the 5s default only measures contention.
    testTimeout: 30_000,
  },
}));
