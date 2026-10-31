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
  // Test the production bundle, the same thing that gets deployed.
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
