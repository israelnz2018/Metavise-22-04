import { test, expect } from '@playwright/test';

/**
 * Smoke flow: anonymous user lands on the app, logs in via the
 * email/password UI (test account), creates a fresh "complete"
 * project, fills the Source tab, and verifies the wizard advances
 * to Persona.
 *
 * Required env (set in .env.test or your shell before running):
 *   PLAYWRIGHT_TEST_EMAIL     — Firebase test user (sign-up first)
 *   PLAYWRIGHT_TEST_PASSWORD  — its password
 *
 * The selectors below are intentionally tolerant (getByRole / text
 * matchers) so a quick UI tweak doesn't break the suite. Tighten
 * them to data-testid attributes once we add them.
 */

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('app boots and shows the auth shell', async ({ page }) => {
  // Cheapest possible check — verifies the bundle parsed, React
  // mounted, and at least one piece of expected copy rendered.
  await expect(page).toHaveTitle(/.+/);
  // Either the login form or the projects list must be visible
  // depending on whether a previous test left a session.
  const loggedOut = page.getByPlaceholder(/email/i);
  const loggedIn = page.getByText(/projetos/i);
  await expect(loggedOut.or(loggedIn).first()).toBeVisible();
});

test.describe('authenticated flow', () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    'set PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD to run the auth flow'
  );

  test('login → create project → land on source tab', async ({ page }) => {
    // 1. Log in. App uses email/password Firebase auth (see App.tsx
    //    onAuthStateChanged + signInWithEmailAndPassword).
    await page.getByPlaceholder(/email/i).fill(TEST_EMAIL!);
    await page.getByPlaceholder(/senha|password/i).fill(TEST_PASSWORD!);
    await page.getByRole('button', { name: /entrar|login/i }).click();

    // 2. Projects list. Hit "+ Novo Projeto" (NewProjectModal).
    await page.getByRole('button', { name: /novo projeto/i }).click();
    await page.getByPlaceholder(/nome/i).fill(`E2E ${Date.now()}`);
    await page.getByRole('button', { name: /criar/i }).click();

    // 3. Should land on the first step (Source for 'complete' type).
    //    Assert the URL/heading shows we're past project creation.
    await expect(page.getByText(/source|fonte|origem/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
