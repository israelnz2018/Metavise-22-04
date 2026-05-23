import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end smoke tests.
 *
 * Locally:
 *   npx playwright install chromium    # one-time browser download
 *   npm run dev                        # start the app on :3000
 *   npm run test:e2e                   # run the suite
 *
 * The dev server is NOT started by Playwright on purpose — `npm run
 * dev` boots ffmpeg, Firebase, and Vite all at once and slowing the
 * test launch by ~10s isn't worth it. If you want auto-start, add a
 * `webServer` block here pointing at `tsx server.ts`.
 *
 * Tests live in /e2e (separate from /tests which is for Vitest server
 * unit tests).
 */
export default defineConfig({
  testDir: './e2e',
  // Global per-test timeout — Firebase auth + Claude calls are slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Serial mode by default — these tests share Firestore state.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
