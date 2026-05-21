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
  },
});
