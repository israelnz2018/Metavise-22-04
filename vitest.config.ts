import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Server tests use createApp() to build an Express app without
    // calling listen(), so each test is fully isolated.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Vite's import.meta.url ESM resolution needs explicit allowed paths.
    server: { deps: { inline: [] } },
    // Long timeout for tests that hit external APIs in smoke mode.
    testTimeout: 30000,
    coverage: {
      // v8 provider — uses Node's built-in coverage, no extra
      // instrumentation, ~3x faster than istanbul.
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // Scope to code we actually test. App.tsx + pages/ are huge React
      // components covered (eventually) by Playwright E2E, not vitest —
      // include them here and the % is meaningless. Excluding keeps the
      // number honest for the server + lib layer that vitest exercises.
      include: ['server/**/*.ts', 'src/lib/**/*.ts', 'src/hooks/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        '**/dist/**',
        '**/node_modules/**',
        'server/index.ts', // boot file, not testable in isolation
      ],
      // "Don't regress" baselines anchored on the current numbers
      // (14% statements / 17% functions / 8% branches). Bump these
      // upward as we add tests — the CI failure on regression is the
      // signal to keep coverage from drifting down silently.
      thresholds: {
        lines: 10,
        functions: 15,
        statements: 10,
        branches: 5,
      },
    },
  },
});
