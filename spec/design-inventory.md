# Design and content inventory: mimawsi.com v1

Everything needing a design spec, copy, or both before v1 can ship.
Derived from [spec.md](./spec.md) and [criteria.md](./criteria.md).

**P0** blocks launch · **P1** needed soon after · **P2** deferred but named so it isn't forgotten.

**D** = visual design · **C** = copy/content · **DC** = both.

---

## 1. Brand and identity

| # | Item | Type | P | Notes |
|---|---|---|---|---|
| 1.1 | Wordmark / logo | D | P0 | "mimawsi" is unfamiliar and easy to mistype — the mark has to carry the expansion |
| 1.2 | Expansion lockup | DC | P0 | "Made It, Might As Well Share It" — decide whether it always accompanies the mark |
| 1.3 | Colour palette + type scale | D | P0 | Must work for the catalogue grid and the admin surface |
| 1.4 | Favicon | D | P0 | |
| 1.5 | Open Graph / social share image | D | P1 | Tools get shared in Slack and WhatsApp; this is the first impression |
| 1.6 | Tone of voice note | C | P0 | One page. The audience is non-technical; every other copy item depends on this |

## 2. Public pages

| # | Page | Type | P | Notes |
|---|---|---|---|---|
| 2.1 | Home / catalogue | DC | P0 | Grid of tool cards. Needs a hero that explains the promise in one line |
| 2.2 | Tool detail | DC | P0 | Screenshot, description, maker username, Try, Download, Report |
| 2.3 | Search results | D | P0 | Including the no-results state (AC-4) |
| 2.4 | About / how this works | C | P0 | **The most important content on the site.** See §6.1 |
| 2.5 | Terms of Use | C | P0 | Legal. This is what permits you to delete an upload and disclaims liability |
| 2.6 | Privacy Policy | C | P0 | Short, because you collect almost nothing — say so, it's a selling point |
| 2.7 | Abuse / contact | DC | P0 | Named contact route, referenced from the ToS |
| 2.8 | 404 | DC | P1 | Matters more than usual — delisted tools will produce these |
| 2.9 | Curated topic pages | DC | P2 | Deferred at Q18, but the template should be anticipated |

## 3. Sharing flow

Every step below needs its empty, working, and error states designed.

| # | Screen / state | Type | P | Notes |
|---|---|---|---|---|
| 3.1 | Drop zone — idle | DC | P0 | Must state the rules before they drop: one HTML file, 25MB, no internet calls |
| 3.2 | Drop zone — file rejected | DC | P0 | Wrong type, or oversize (AC-14, AC-15) |
| 3.3 | Local preview running | D | P0 | The delight moment — their tool running instantly, nothing uploaded |
| 3.4 | Scan feedback — pass | DC | P0 | |
| 3.5 | Scan feedback — fail | DC | P0 | Needs one message per check. See §6.2 |
| 3.6 | Metadata form | DC | P0 | Title + description, with the AI draft presented as editable (AC-16) |
| 3.7 | Draft-failed fallback | DC | P1 | Manual description entry (AC-17) |
| 3.8 | Sign-in prompt | DC | P0 | Explain *why* it's asked for here and not earlier |
| 3.9 | Username capture | DC | P0 | First sign-in only (AC-20) |
| 3.10 | Submission confirmed | DC | P0 | Honest pending state, no ETA (Q21 + Accepted Risk 1) |
| 3.11 | Duplicate file rejected | DC | P1 | Must link the existing tool (AC-23) |
| 3.12 | Rate limit reached | DC | P1 | AC-26 |
| 3.13 | My submissions list | DC | P0 | Per-submission status (AC-28) |
| 3.14 | Edit / resubmit | DC | P1 | Shared by rejected (AC-43) and published-edit (AC-44) paths |
| 3.15 | Unpublish + confirmation | DC | P1 | Must warn that existing downloads keep working (Accepted Risk 3) |

## 4. Admin surface

Internal, so design can be minimal — but the copy still has to be unambiguous.

| # | Screen | Type | P | Notes |
|---|---|---|---|---|
| 4.1 | Review queue | D | P0 | |
| 4.2 | Review detail | D | P0 | Tool running beside scan findings (AC-35) |
| 4.3 | Approve / reject controls | DC | P0 | Reject requires picking a reason that drives the maker's email |
| 4.4 | Report queue | D | P0 | |
| 4.5 | Delist confirmation | DC | P0 | Irreversible-feeling action, needs a guard |

## 5. Notifications

| # | Template | Type | P | Notes |
|---|---|---|---|---|
| 5.1 | Approved | C | P0 | Include the share link — this is the payoff |
| 5.2 | Rejected | C | P0 | Reason plus remedy (AC-41, AC-42) |
| 5.3 | Email sender identity | D | P1 | From-name, footer, unsubscribe posture |

## 6. Content sets — the real writing work

### 6.1 The promise, explained for non-technical readers — **P0**
The single most important piece of content on the site. It has to make four claims plainly,
to someone who does not know what a network request is:

- It's one file. You download it and double-click it.
- It works with no internet, forever.
- Nothing you put into it ever leaves your computer.
- Nobody has to install anything or ask permission.

This copy appears in at least three places: the home hero, the About page, and the tool
detail page. Write it once, properly.

### 6.2 Rejection reasons and remedies — **P0**
One reason + one remedy per failing check. Because most tools are AI-generated, each remedy
should include a paste-able prompt.

| Check | Needs |
|---|---|
| Network primitive (`fetch`, `XHR`, beacon) | reason + remedy + prompt |
| External subresource (`src`, font, stylesheet) | reason + remedy + prompt |
| Dynamic code evaluation (`eval`, `Function()`) | reason + remedy + prompt |
| Obfuscated code | reason + remedy (likely no auto-fix) |
| `localStorage` / `IndexedDB` | reason + remedy + prompt |
| Web Worker / WASM | reason + remedy + prompt |
| Camera / microphone / geolocation | reason + remedy + prompt |
| Over 25MB | reason + remedy (how to shrink embedded media) |
| Not a single HTML file | reason + remedy (how to inline assets) |

### 6.3 Maker guidance — "what makes a valid tool" — **P0**
Pre-empts most rejections. Should include a known-good example file makers can start from.

### 6.4 Report form reasons — **P0**
The fixed list of reasons a visitor can pick when reporting (AC-49).

### 6.5 Seed catalogue content — **P0**
Per Q7 you and Claire supply the first tools. Each needs a title, a description, and a
tool that actually works. **This is a content workstream, not a design one, and it is on
the critical path** — the site cannot launch empty.

---

## Decisions still needed before design can start

1. **How many seed tools before launch?** Drives whether the catalogue is designed as a
   grid or a short list.
2. **Does the home page lead with the promise or with the tools?** Changes the hero
   entirely.
3. **Tagline treatment** — is "Made It, Might As Well Share It" the headline, or a
   subtitle under the wordmark?
4. **Does the tool card show the maker's username?** The spec permits it; nothing requires
   it, and it affects card layout.

## Not needed for v1

Maker profile pages · remix and family views · request board · version history UI ·
payment or pricing surfaces · onboarding tour · notification preferences.