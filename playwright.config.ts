import { defineConfig, devices } from '@playwright/test';

const PORT = 4179;
/** Course generation must be identical in every engine, so that one test runs in all three. */
const COURSE_SPEC = 'course.spec.ts';

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
  // tests/e2e/fixtures.ts stands in for the Vercel script, which only exists on a Vercel deployment.
  webServer: {
    command: `VITE_ANALYTICS=1 npx vite build && node scripts/vercel-output.mjs && node scripts/serve-output.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
