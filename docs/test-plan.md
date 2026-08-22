# mimawsi test plan

Stable case IDs so the prompt can be one line: *"Implement test case TC-C03 from the test
plan."* Everything else — locators, seeding, fixtures, title format — comes from
`tests/AGENTS.md` and `docs/mimawsi-behaviour.md`.

IDs are permanent. Retire one by marking it withdrawn; never reuse the number.

**Status:** `done` · `todo` · `blocked` (product not built yet)

## Rules every case follows

- One level tag (`@e2e` `@api` `@csp` `@a11y`) plus `@safety` when it covers a safety criterion.
- Title is `TC-<ID>: what is exercised`.
- Any `If … then` criterion asserts the prohibited outcome did **not** occur.
- Bounded values get three cases: within, at, beyond.

---

## Tracer — the whole path, end to end (`tests/specs/tracer/`)

TC-T01 is the one test that spans every stage. It goes green at cp-0 against fakes and stays
green through every phase afterwards; phases replace what sits beneath it and never amend it
(RULE-47). If it goes red, the path is broken — do not "update the test to match".

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-T01 | The journey: browse a seeded tool, run it, download it, drop your own, submit, approve, republish, download again | the path itself; no single AC | **done** — green, frozen from here (RULE-47) |
| TC-T02 | A dropped file runs locally with nothing transmitted | AC-10 | done — asserted inside TC-T01 step 4, not a separate spec |
| TC-T03 | A file published by the skeleton is CSP-enforced from `file://` | AC-38, AC-54 | done — 3 engines |
| TC-T04 | Every adapter behind a port passes that port's contract suite, fake and real alike | RULE-46 | done — 17 assertions, 4 fakes |

TC-T04 runs in **Vitest**, not Playwright — port contracts are unit tests and RULE-32 places them there. It is the one entry in this plan that does not live under `tests/specs/`.

TC-T04 is a suite, not a case: one contract per port, run against whichever adapter is
wired in. Replacing a fake never edits it.

---

## CSP — the downloaded file (`specs/csp/`) · runs on chromium + firefox + webkit

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-CSP01 | `fetch` to an external origin is refused | AC-54 | done |
| TC-CSP02 | `XMLHttpRequest` to an external origin is refused | AC-54 | done |
| TC-CSP03 | `sendBeacon` is refused regardless of what it returns | AC-54 | done |
| TC-CSP04 | An external image is refused | AC-54 | done |
| TC-CSP05 | `eval` is refused | AC-54, AC-31a | done |
| TC-CSP06 | Inline script still runs | AC-55 | done |
| TC-CSP07 | `data:` and `blob:` images still load | AC-55 | done |
| TC-CSP08 | A generated file still downloads | AC-55 | done |
| TC-CSP09 | `localStorage` persists across a reload | AC-31c | done |
| TC-CSP10 | Injector output on malformed markup still carries an enforced policy | AC-38 | done — green on 3 engines (task-1.5, parse5) |
| TC-CSP11 | Injected meta is the first element in `<head>` | AC-38 | done — green on 3 engines (task-1.5, parse5) |
| TC-CSP12 | A tool that already declares a weaker CSP does not get to keep it | AC-38 | done — green on 3 engines (task-1.5, parse5) |

## Catalogue — the read path (`specs/catalogue/`)

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-C01 | Catalogue renders for a signed-out visitor | AC-1 | blocked |
| TC-C02 | A pending tool is absent, and its title and description are undisclosed | AC-2 | blocked |
| TC-C03 | Search returns matching tools | AC-3 | blocked |
| TC-C04 | Search with no match returns an empty state and no unmatched tools | AC-4 | blocked |
| TC-C05 | Screenshot renders when present | AC-8 | blocked |
| TC-C06 | A tool with no screenshot still appears | AC-9 | blocked |
| TC-C07 | Download is byte-exact against the stored object | AC-7 | blocked |

## Sandbox — running a tool in the browser (`specs/catalogue/`)

Assert at the frame boundary only. Never locate inside tool content.

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-S01 | A running tool cannot read the host origin, storage or document | AC-5 | blocked |
| TC-S02 | A running tool's network attempt is refused and nothing is answered | AC-6 | blocked |
| TC-S03 | A deliberately hostile fixture tool cannot escape the sandbox | AC-60 | blocked |
| TC-S04 | A dropped file runs locally with no transmission | AC-10 | blocked |

## Sharing — the write path (`specs/api/`, `specs/catalogue/`)

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-W01 | A structurally invalid file is reported before any transmission | AC-11 | blocked |
| TC-W02 | File one byte below the cap is accepted | AC-12 | blocked |
| TC-W03 | File exactly at 26,214,400 bytes is accepted | AC-13 | blocked |
| TC-W04 | File one byte above the cap is rejected, and nothing is stored | AC-14 | blocked |
| TC-W05 | Non-HTML input is rejected client-side | AC-15 | blocked |
| TC-W06 | Description is drafted from the source file | AC-16 | blocked |
| TC-W07 | A failed draft does not block submission | AC-17 | blocked |
| TC-W08 | Submit prompts authentication | AC-18 | blocked |
| TC-W09 | No bytes reach storage while unauthenticated | AC-19 | blocked |
| TC-W10 | First sign-in creates an account | AC-20 | blocked |
| TC-W11 | Username is captured once and not re-prompted | AC-21 | blocked |
| TC-W12 | Duplicate usernames are permitted | AC-21, behaviour §2 | blocked |
| TC-W13 | Authenticated submission transmits the file | AC-22 | blocked |
| TC-W14 | An identical file is rejected and the existing tool is named | AC-23 | blocked |
| TC-W15 | 4th submission in 24h is accepted | AC-24 | blocked |
| TC-W16 | 5th submission in 24h is accepted | AC-25 | blocked |
| TC-W17 | 6th submission is rejected, and no record is written | AC-26 | blocked |
| TC-W18 | Accepted submission enters the queue as pending | AC-27 | blocked |
| TC-W19 | A maker sees their own submission status | AC-28 | blocked |
| TC-W20 | A maker cannot see another maker's submissions | AC-29 | blocked |

## Scanning and review (`specs/api/`)

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-R01 | Every submission is scanned | AC-30 | blocked |
| TC-R02 | Network capability causes rejection | AC-31, AC-31b | blocked |
| TC-R03 | Worker / WASM / `eval` are flagged, not rejected | AC-31a | blocked |
| TC-R04 | `localStorage` alone is not a finding | AC-31c | blocked |
| TC-R05 | Findings are recorded against the submission | AC-32 | blocked |
| TC-R06 | Screenshot is captured at approval | AC-33 | blocked |
| TC-R07 | Screenshot failure does not block publication | AC-34 | blocked |
| TC-R08 | A near-blank screenshot is acceptable | AC-33, behaviour §2 | blocked |
| TC-R09 | Reviewers see the tool and its findings | AC-35 | blocked |
| TC-R10 | The review surface is closed to non-reviewers | AC-36 | blocked |
| TC-R11 | Approval publishes | AC-37 | blocked |
| TC-R12 | Approval and rejection notify the maker | AC-39, AC-40 | blocked |
| TC-R13 | A rejection carries a reason and a remedy | AC-41, AC-42 | blocked |
| TC-R14 | A rejected submission can be edited and re-enter review | AC-43 | blocked |

## Lifecycle, moderation, compliance (`specs/api/`)

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-L01 | An edit re-enters review | AC-44 | blocked |
| TC-L02 | The published version keeps serving during review of an edit | AC-45 | blocked |
| TC-L03 | The tool URL is stable across edits | AC-46 | blocked |
| TC-L04 | A metadata-only edit also re-enters review | AC-44, behaviour §2 | blocked |
| TC-L05 | A maker can unpublish immediately | AC-47 | blocked |
| TC-L06 | A maker cannot unpublish another's tool, and nothing changes | AC-48 | blocked |
| TC-L07 | A report is accepted without an account | AC-49 | blocked |
| TC-L08 | A reported tool stays live | AC-50 | blocked |
| TC-L09 | A report reaches the review queue | AC-51 | blocked |
| TC-L10 | A reviewer can delist immediately | AC-52 | blocked |
| TC-L11 | Delisting is closed to non-reviewers | AC-53 | blocked |
| TC-L12 | Account deletion removes personal data | AC-61 | blocked |
| TC-L13 | Account deletion leaves published tools in place | AC-62 | blocked |
| TC-L14 | A deleted maker is anonymously attributed | AC-63 | blocked |
| TC-L15 | Rejected submissions are retained within the period | AC-64 | blocked |
| TC-L16 | Rejected submissions are purged at the boundary | AC-65, AC-66 | blocked |
| TC-L17 | Erasure overrides retention | AC-66a | blocked |
| TC-L18 | Delisted tools are purged at the boundary | AC-67 | blocked |
| TC-L19 | A ban retains only a hashed identifier | AC-68, AC-69 | blocked |
| TC-L20 | A banned address cannot re-register | AC-70 | blocked |

## Accessibility and performance (`specs/a11y/`)

| ID | Case | Covers | Status |
|---|---|---|---|
| TC-A01 | Catalogue is fully keyboard operable | AC-56 | blocked |
| TC-A02 | Catalogue meets contrast requirements | AC-57 | blocked |
| TC-A03 | axe reports no serious or critical violations on the catalogue | AC-56, AC-57 | blocked |
| TC-A04 | Catalogue responds within budget | AC-58 | blocked |
| TC-A05 | Search responds within budget | AC-59 | blocked |
