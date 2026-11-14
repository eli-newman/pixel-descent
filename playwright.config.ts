import { defineConfig, devices } from '@playwright/test';

/** The project has no @types/node: this is the one Node API the config reads. */
declare const process: { env: Record<string, string | undefined> };

/** `E2E_PORT` lets several checkouts run the suite at once. */
const PORT = Number(process.env['E2E_PORT'] ?? 4179);
/** Course generation must be identical in every engine, so that one test runs in all three. */
const COURSE_SPEC = 'course.spec.ts';
/** A made-up PostHog project key, so the bundle and the ingest function are built with PostHog on, as on Vercel. */
export const E2E_POSTHOG_KEY = 'phc_e2e_stand_in_key';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: `http://localhost:${PORT}/` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: COURSE_SPEC },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: COURSE_SPEC },
  ],
  // Test what gets deployed: the production bundle with analytics on, as Vercel builds it, in the Build Output layout
  // Vercel serves (the static game plus the dare page and card functions), routed the way Vercel routes it.
  // tests/e2e/fixtures.ts stands in for the Vercel script, which only exists on a Vercel deployment, and the server
  // stands in for PostHog behind the ingest function (scripts/serve-output.mjs), so nothing reaches the internet.
  webServer: {
    command: `npx vite build && node scripts/vercel-output.mjs && node scripts/serve-output.mjs ${PORT}`,
    env: { VITE_ANALYTICS: '1', VITE_POSTHOG_KEY: E2E_POSTHOG_KEY },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
