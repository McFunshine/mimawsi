import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4321';
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:4322';
const RUNNER_HEALTH = `${RUNNER_URL}/health`;
const API_URL = process.env.API_URL ?? 'http://localhost:4323';
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
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

    // The tracer. One project, one worker, deliberately: it walks the whole path
    // against a single shared store, so running it four times over in parallel
    // races on the duplicate-file check rather than testing anything. Rendering
    // across engines is a different question, and the suites below answer it.
    {
      name: 'tracer',
      testDir: './specs/tracer',
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },

    // The product surface. Chromium is the gate; the other two are the matrix.
    {
      name: 'e2e-chromium',
      testIgnore: [/specs\/csp\//, /specs\/tracer\//],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-firefox',
      testIgnore: [/specs\/csp\//, /specs\/tracer\//],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'e2e-webkit',
      testIgnore: [/specs\/csp\//, /specs\/tracer\//],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'e2e-mobile',
      testIgnore: [/specs\/csp\//, /specs\/tracer\//],
      use: { ...devices['iPhone 14'] },
    },
  ],

  // The catalogue is Astro from phase 0 on, so the tests drive the same build
  // pipeline that ships. scripts/serve.mjs is gone with it.
  // Two origins, because production has two. The catalogue serves pages and
  // downloads; the runner serves tool bytes for execution and nothing else.
  webServer: [
    {
      command: 'npm run dev --workspace @mimawsi/site',
      cwd: '..',
      url: BASE_URL,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev --workspace @mimawsi/runner',
      cwd: '..',
      url: RUNNER_HEALTH,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev --workspace @mimawsi/lambdas',
      cwd: '..',
      url: `${API_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
  ],
});
