import { test as base, expect } from '@playwright/test';
import { publishToDisk } from '../support/publish';

export interface Violation {
  directive: string;
  blockedURI: string;
}

/**
 * Everything a CSP spec is allowed to believe.
 *
 * Three oracles, none of them the page's own API return values — ED-1 proved those
 * lie: Chrome returned `true` from `navigator.sendBeacon` for a request CSP had
 * blocked. RULE-18.
 *
 *  - `violations` — `securitypolicyviolation` events. The positive signal that the
 *                   browser refused something, and which directive did it.
 *  - `reached`    — non-`file://` URLs that came *back* with a response. This is the
 *                   "and not" oracle and it must stay empty. Deliberately NOT
 *                   `page.on('request')`: Chromium reports XHR and `<img>` requests
 *                   to Playwright before the CSP check runs, so a request event is
 *                   evidence of intent, never of egress.
 *  - `failures`   — what the browser said when it refused, per URL. Recorded so a
 *                   change in blocking mechanism shows up as a diff, not a silence.
 */
interface Oracles {
  violations: Violation[];
  reached: string[];
  failures: Record<string, string>;
}

interface Fixtures extends Oracles {
  /** Publishes tool HTML through the injector and opens it as a downloader would. */
  openPublished: (toolHtml: string) => Promise<void>;
}

export const test = base.extend<{ oracles: Oracles } & Fixtures>({
  // Never set `bypassCSP` on the context — it would switch off the thing under test.
  oracles: async ({ page }, use) => {
    const violations: Violation[] = [];
    const reached: string[] = [];
    const failures: Record<string, string> = {};

    await page.exposeFunction('__mimawsiViolation', (v: Violation) => {
      violations.push(v);
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const w = window as unknown as { __mimawsiViolation?: (v: unknown) => void };
        w.__mimawsiViolation?.({
          directive: event.effectiveDirective || event.violatedDirective,
          blockedURI: event.blockedURI,
        });
      });
    });

    page.on('response', (response) => {
      if (!response.url().startsWith('file://')) {
        reached.push(response.url());
      }
    });

    page.on('requestfailed', (request) => {
      if (!request.url().startsWith('file://')) {
        failures[request.url()] = request.failure()?.errorText ?? 'unknown';
      }
    });

    await use({ violations, reached, failures });
  },

  violations: async ({ oracles }, use) => {
    await use(oracles.violations);
  },

  reached: async ({ oracles }, use) => {
    await use(oracles.reached);
  },

  failures: async ({ oracles }, use) => {
    await use(oracles.failures);
  },

  openPublished: async ({ page, oracles }, use) => {
    void oracles; // force oracle attachment before the first navigation
    await use(async (toolHtml: string) => {
      await page.goto(await publishToDisk(toolHtml));
    });
  },
});

export { expect };
