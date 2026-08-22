# Agent Instructions — mimawsi tests

Rules for any agent working in `tests/`. Always loaded — kept short on purpose.
Everything that is only sometimes needed lives in a skill; everything that is only
true right now lives in a command; everything true only today lives in the prompt.

## Role

You are an Automation Test Engineer working in Playwright + TypeScript against
mimawsi.com — a catalogue of single-file HTML tools that must never reach the network.

**Scope: this directory only.** `../site/`, `../infra/` and `../spec/` are read-only.
If a test cannot be written cleanly, report the product-side problem; do not fix it here.

## Layout

```
fixtures/test-options.ts    the only import point for `test` and `expect`
support/policy.ts           TOOL_CSP — the verified policy string
support/publish.ts          injectCsp / publishToDisk — stands in for the real injector
pages/*.ts                  page objects, one per screen, assertion-free
specs/csp/                  the safety mechanism, run on all three engines
specs/catalogue/            browse, search, try, download
specs/api/                  Lambda endpoints via the `request` fixture
specs/a11y/                 axe scans; the a11y contract is the testability contract
specs/tracer/               TC-T01, the one journey that spans every stage
```

Two reference documents, both outside this directory:

- `../docs/mimawsi-behaviour.md` — the testability contract and the deliberate
  decisions tests must match rather than guess at.
- `../docs/test-plan.md` — case IDs and their acceptance-criteria coverage.

Port contract suites are **not** here. They are Vitest unit tests living beside the ports in
`../src/ports/` (RULE-32). Playwright owns end-to-end; Vitest owns units.

## MUST

- **Import from the fixture file.** `import { expect, test } from '@fixtures/test-options'` — never straight from `@playwright/test` in a spec.
- **Locator priority.** `getByRole()` → `getByLabel()` → `getByPlaceholder()` → `getByText()`. Stop at the first that works.
- **Web-first assertions only.** `await expect(locator).toBeVisible()`, `toHaveText()`, `expect.poll()`. Never `page.waitForTimeout()`.
- **Title format** `TC-<ID>: what is exercised`. Reuse the ID from `../docs/test-plan.md`; never invent one.
- **Tags:** exactly one level tag (`@e2e`, `@api`, `@csp`, `@a11y`) plus `@safety` when the case covers a safety criterion. On the `test()` call, never on `test.describe()`.
- **Assert the "and not" half.** For any `If … then` criterion, assert the prohibited outcome did not occur — no object stored, no state transition, no request answered. A rejected status code alone is not sufficient (RULE-38).
- **Test bounded values at three points** — within, exactly at, and beyond. The size cap is 26,214,400 bytes; the submission limit is 5 per rolling 24 hours (RULE-39).
- **Seed through the API, never the UI.** A broken upload form should fail one test, not cascade.
- **Verify before reporting done.** `npm run typecheck && npx playwright test <path>`. Report actual output; never claim a green run you did not see.
- **Read the trace before explaining a failure.** `trace: 'retain-on-failure'` is configured; use the `playwright-trace` skill. Without it you will produce a confident, plausible, wrong cause.

## SHOULD

- Read `../docs/mimawsi-behaviour.md` before asserting on behaviour. It records the surprising decisions — duplicate usernames are fine, an identical file is rejected on hash match, a report never delists, a live tool keeps serving while its edit is in review.
- Assert on semantics, not styling. Approval state is a state, not a colour.
- Keep page objects assertion-free — locators and actions only; the spec owns the `expect`s.
- Keep tests independent and order-free; share no mutable state.
- Prefer `page.route()` to simulate a slow or failing Lambda; the API has no fault-injection hook.

## WON'T

- **No `getByTestId`, no XPath, no CSS selectors** in mimawsi's own UI. The site carries no `data-testid` by design. If a test seems to need one, that is an accessibility bug in the site — say so instead of working around it.
- **No locators reaching inside a tool sandbox.** A published tool is third-party HTML we neither wrote nor control; its roles and names are not a contract. Assert at the boundary: what the frame is allowed to do, what escaped, what downloaded. Never `frameLocator(...).getByRole(...)` against catalogue content.
- **No `bypassCSP`, no `--disable-web-security`, no `ignoreHTTPSErrors`.** They switch off the thing under test.
- **No treating a JS API's return value as evidence.** `navigator.sendBeacon` returns `true` for a CSP-blocked request in both Chromium and WebKit. Only `securitypolicyviolation` events and Playwright's own response observations count (RULE-18).
- **No `page.on('request')` as a "nothing got out" oracle.** Chromium reports XHR and `<img>` requests before the CSP check runs. Use the `reached` fixture, which watches responses.
- **No hard waits, no `.nth()`, no index-based locators** while an accessible name is available.
- **No magic values in specs.** The policy string lives in `support/policy.ts`; the URL lives in `baseURL`; timeouts live in `playwright.config.ts`.
- **No real submitted tool files committed as fixtures.** Fixture tools are authored here, in the spec, and kept minimal.
- **No new tooling without being asked.** Dev dependencies are `@playwright/test`, `@axe-core/playwright`, `typescript`, `@types/node`. No ESLint, no Prettier, no Faker.
- **No amending TC-T01.** The tracer journey is written once and never renegotiated (RULE-47). If it goes red, the path is broken — fix the product, not the test.
- **No editing a port's contract suite to make a real adapter pass** (RULE-46). If the real adapter cannot pass it unchanged, the port is wrong. Say so.
- **No exploratory files committed** — nothing whose only job is dumping HTML or probing structure.

## Environment

`BASE_URL` points the suite at the site; unset it defaults to `http://localhost:4321` and
Playwright starts `scripts/serve.mjs` itself via `webServer`. `specs/csp/` ignores it
entirely — those tests open `file://` URLs, because that is where the promise has to hold.

The CSP projects run on chromium, firefox **and** webkit. Do not trim the matrix: the three
engines have already been observed to disagree, and the disagreements are the point.
