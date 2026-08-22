import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4321';
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['html'], ['github']] : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    // Every failure must arrive with a trace. An agent without one invents a
    // plausible cause from a single error line. See .claude/skills/playwright-trace.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    // The safety mechanism. Runs on all three engines because CSP and file://
    // have diverged historically — ED-1 left WebKit unanswered on purpose.
    {
      name: 'csp-chromium',
      testDir: './specs/csp',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'csp-firefox',
      testDir: './specs/csp',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'csp-webkit',
      testDir: './specs/csp',
      use: { ...devices['Desktop Safari'] },
    },

    // The product surface. Chromium is the gate; the other two are the matrix.
    {
      name: 'e2e-chromium',
      testIgnore: /specs\/csp\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-firefox',
      testIgnore: /specs\/csp\//,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'e2e-webkit',
      testIgnore: /specs\/csp\//,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'e2e-mobile',
      testIgnore: /specs\/csp\//,
      use: { ...devices['iPhone 14'] },
    },
  ],

  webServer: {
    command: 'npm run serve',
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
