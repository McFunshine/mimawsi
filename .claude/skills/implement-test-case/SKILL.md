---
name: implement-test-case
description: Implement a mimawsi test case from docs/test-plan.md by its ID (TC-C03, TC-W17, TC-CSP10, TC-A02), exploring the real running site with playwright-cli before writing any test code. Use whenever a case ID from the test plan is to be automated, or a new spec is added under tests/specs.
allowed-tools: Read Grep Glob Edit Write Bash(npm:*) Bash(npx:*) Bash(playwright-cli:*)
---

# Implementing a test case from the plan

Given a case ID such as `TC-C03`, produce the spec that automates it — and nothing more.

## 1. Read before writing

- `docs/test-plan.md` — the case's own row: what it exercises and which AC it covers. Do not widen the case beyond it.
- `spec/criteria.md` — the acceptance criterion named in that row, in full. The EARS wording is the contract; the plan row is only a label.
- `tests/AGENTS.md` — the MUST/SHOULD/WON'T rules. Binding, not advisory.
- `docs/mimawsi-behaviour.md` — the testability contract (§1) and the deliberate oddities (§2). This is where the case will be surprising.
- Existing specs and page objects — match the shape of what is already there.

## 2. Explore the real site — before writing any test code

Use the `playwright-cli` skill to drive the running site (`cd tests && npm run serve`)
through whatever this case actually does. Seed preconditions over the API, perform the
steps in the browser, and read the snapshot at each step.

Replace assumptions with observations. Never infer from the docs alone:

- the role and accessible name of every control the test touches;
- the exact text of anything the test asserts on;
- what changes after each step — what appears, what disappears, what the URL does.

Close the browser when done. Leave no exploratory files behind.

## 3. Special cases this project has

**A CSP or sandbox case (`TC-CSP*`, `TC-S*`).** Assert with the `violations`, `reached`
and `failures` fixtures — never with a value the page's own JavaScript returned, and
never with `page.on('request')`. Read `docs/mimawsi-behaviour.md` §4 first; two of the
three engines have already been caught lying about this. Add the case to all three CSP
projects; do not narrow the matrix to make it pass.

**A negative case (any `If … then` criterion).** The assertion that matters is the "and
not" half — no object stored, no record written, no state transition, no notification.
A rejected status code alone is not a passing test.

**A bounded value.** Three cases, not one: within, exactly at, beyond. The exact numbers
are in `docs/mimawsi-behaviour.md` §3.

**A tool sandbox.** Never reach inside it with a locator. Tool HTML is third-party and
its structure is not a contract. Assert on what crosses the boundary.

## 4. Verify — then report

```bash
cd tests && npm run typecheck && npx playwright test specs/<path>
```

Both must pass. Report the actual output; never claim a green run you did not see. If a
test fails, read the trace with the `playwright-trace` skill before explaining why —
without it you will produce a confident, plausible, wrong cause.

Then flip the case's row in `docs/test-plan.md` from `todo` to `done`.

If the case cannot be written cleanly because of a product-side problem — a missing
accessible name, an ambiguous role, no way to seed state — say so and stop. `site/` is
read-only from here.
