# mimawsi behaviour — what tests must match rather than guess

Agents hallucinate hardest where behaviour is surprising and undocumented. This file is
the list of places where mimawsi does something a reasonable person would not predict.
It is not a spec — `../spec/` is. It is the set of facts a test author would otherwise
get wrong.

## 1. The testability contract

**The site carries no `data-testid`, anywhere, by design.** Every interactive control is
reachable by accessible role and name. If a test cannot find a control without a test id,
the control has an accessibility bug — report it against `site/`, do not work around it
in `tests/`.

**The tool sandbox is the exception, and it is a hard boundary.** A published tool is
third-party HTML. Its roles, names and text are not ours and are not a contract. Tests
assert what crosses the boundary — a violation event, a download, an absent response —
never what is inside it.

## 2. Deliberate oddities

| Behaviour | What actually happens | Why a test would guess wrong |
|---|---|---|
| Duplicate usernames | Allowed | Usernames are display-only; identity is the Google account, and there are no maker profile pages |
| Identical file re-submitted | Rejected on hash match, response points at the existing tool | Not a 409-and-nothing; the existing tool must be named in the response |
| A tool is reported | Stays live. The report queues | No auto-delist — one click must not be able to silence a maker |
| A live tool is edited | The previously approved version keeps serving until the edit is approved. URL is stable, no history kept | The edit is not visible at the public URL, and asserting it is will fail correctly |
| Metadata-only edit | Also re-enters review | Closes the bypass where a bland tool is approved and its description then rewritten |
| Unpublish | Immediate, no review | Removal is always safe, so it does not queue |
| A tool that renders nothing | Screenshot after a fixed delay; a near-blank image is a pass | Do not assert on screenshot content |
| A tool using Worker/WASM/camera/mic | Flagged for a human, **not** auto-rejected — and then simply does not work once published, because CSP denies it | Auto-reject is the intuitive behaviour and is wrong |
| A tool using `eval` | Same: flagged, not rejected. CSP blocks it, so the reviewer sees a broken tool, not a dangerous one | |
| `localStorage` / `IndexedDB` | Permitted | Local-only, so not an exfiltration route. CSP has no directive for storage and never could have enforced a ban |
| Client-side scan at drop | Advisory only, never authoritative | An attacker bypasses it trivially; only the Actions deep scan may gate a publish |
| Unapproved tool | Omitted from the catalogue *and* its title, description and file are undisclosed | Asserting only "absent from the list" misses the disclosure half |

## 3. Bounded values

| Bound | Exact value | Test at |
|---|---|---|
| File size cap | 26,214,400 bytes (25 MiB) | 26,214,399 / 26,214,400 / 26,214,401 |
| Submissions per account | 5 per rolling 24 hours | 4th / 5th / 6th |

## 4. Browser facts, measured not assumed

Established by the ED-1 spike and now held by `tests/specs/csp/downloaded-tool.spec.ts`,
which runs on all three engines on every commit.

- **Meta CSP is enforced from `file://`** in Chromium, Firefox **and** WebKit. WebKit was
  the open question after ED-1; the harness answered it — 9/9 cases pass.
- **`navigator.sendBeacon` lies in two engines out of three.** It returns `true` for a
  request CSP blocked in both Chromium and WebKit; Firefox returns `false`. No test, and
  no runtime detector, may read a JS API's return value as evidence.
- **Chromium reports blocked XHR and `<img>` requests to Playwright's `request` event**
  before the CSP check runs. A `request` event proves intent, not egress. The `reached`
  fixture watches responses instead, and that is the oracle that must stay empty.
- **No `requestfailed` event fires for a CSP-blocked `fetch`** in any engine — it is
  refused before the network stack. Absence of a failure event is not absence of a block.
- **A sandboxed frame without `allow-forms` never dispatches the `submit` event**
  in Chromium or Firefox — the check sits earlier in the form submission algorithm
  than the dispatch, so a tool's own `preventDefault` handler never runs and the
  control silently does nothing. **WebKit dispatches it anyway.** This is why the
  Try frame grants `allow-forms`: the grant is what makes the event fire, and
  `form-action 'none'` is what denies the navigation. Held by TC-S05/TC-S06.
- **`form-action` is checked at navigation time, after `submit` is dispatched.**
  So denying it costs a well-behaved tool nothing. Verified on all three engines;
  it is the whole reason the frame can be opened up without opening egress.
- **Safari on iPhone has no Fullscreen API for anything but `<video>`.** So the
  Try page's Full screen control cannot rely on `requestFullscreen`; it tries it
  and falls back to fixed positioning, which is the path a phone actually takes.
  A test that only exercised the native call would pass on every desktop engine
  and prove nothing about the device most tools get played on. TC-S07/TC-S08.
- **A touchscreen never fires `dragstart`.** HTML5 drag-and-drop is therefore
  inert on a phone, silently — no error, no event, a control that simply does
  nothing while working perfectly on a desktop. Anything draggable must use
  pointer events. Found by testing an emulated iPhone, not by reading the code.
- The verified policy is
  `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'; base-uri 'none'`
  and lives in `tests/support/policy.ts`. Changing that string invalidates every result above.
  `form-action` and `base-uri` were added on 2026-09-26; everything above them was
  re-run green on all three engines at that point.
