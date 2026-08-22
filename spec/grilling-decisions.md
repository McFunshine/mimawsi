# mimawsi.com — MVP design decisions

**Made It, Might As Well Share It** — a free catalogue of single-file, zero-install HTML tools.

Source: grilling session, 2026-08-11. Status: awaiting confirmation before `/01-spec`.

---

## Origin and thesis

Claire and the user's sister were writing about a tool someone vibe-coded for their
newsroom. It only put text on images, and it did **not** get the engagement hoped for.
The part that was actually interesting was the *distribution*: a single HTML file that
needed no install, no permission from IT, no account. Download, double-click, works.

**The bet:** this is a distribution problem, not a creation problem. Good small tools
exist and cannot be found or installed. The user declined the "find 20 existing tools"
cheap test on the grounds that they and Claire will seed the catalogue themselves.

**The name is the spec.** An early proposal to cut upload from v1 was rejected on these
grounds: "This is the minimum thing that people can share, and if they can't share it,
it's not a shared website." Sharing is not a feature of mimawsi, it is mimawsi.

## The artifact contract

- **One self-contained `.html` file.** All CSS and JS inlined, all media base64-embedded.
- **Openable by someone who knows nothing about computers.** Download, double-click, done.
- **25MB cap.** Chosen over 5MB because base64 inflates binary by ~33%.
- **No external calls of any kind.** No `fetch`, no `XHR`, no remote `src`, no beacons,
  no external fonts.

The no-network rule earns its place three times over:

1. **Safety** — a file that cannot reach the network cannot exfiltrate.
2. **Offline** — works in the field with no connectivity.
3. **Cost** — no server-side compute means no bill. This is the business model.

> The rule binds the **tools**, not the site. mimawsi's own backend may call an AI model
> at upload time; that is a one-off per submission, not a per-visitor cost.

## Product decisions

| # | Decision | Outcome |
|---|---|---|
| Q1 | Artifact format | Single self-contained `.html` |
| Q2 | Network access | Banned outright |
| Q3 | Download vs run-in-page | Both; download is the promise, in-page is the shopfront |
| Q4 | Threat model | Gate on malicious **code**; report-and-remove horrific **content** |
| Q5 | Scope | Open to everybody — journalism-only niche rejected |
| Q6 | Identity | Required to upload, nothing to browse or download |
| Q7 | Premise | Distribution bet; seed the catalogue ourselves |
| Q8 | Size cap | 25MB |
| Q9 | Enforcement | Inject CSP `<meta>` at publish **and** scan — *spike pending* |
| Q10 | Mobile | In-page runner in v1; downloads can't be opened on iOS/Android |
| Q16 | Upload in v1? | **Yes** — it is the product |
| Q17 | GitHub | Backend only, invisible to users. Never a PR-based front door |
| Q18 | Curation | Editor-assembled topic pages (images / sound / everything). Deferred |
| Q19 | Request board | Dropped for now |
| Q20 | Scanner outcomes | Nothing auto-approves in v1; auto-reject the unambiguous, human-review the rest |
| Q21 | Upload feedback | Honest async: acknowledge receipt, run it immediately, show real status |
| Q22 | Submission route | Drag-and-drop only |
| Q23 | Metadata | Title + description from user; AI may draft the description |
| Q24 | Stack | Static-first + serverless on Cloudflare |
| Q25 | Maker profiles | None. Username only |
| Q26 | Auth | Google sign-in only |
| Q27 | Scanner location | Deferred; assume GitHub Actions for now |
| Q28 | Review UI | Protected admin page, tool running in sandboxed iframe |

## Upload flow

1. Drag and drop the `.html` file.
2. **It runs immediately in the sandboxed iframe** — their own file, already local,
   nothing faked.
3. Fast structural scan gives instant feedback.
4. Title + description (AI-drafted, user-edited). Screenshot auto-captured.
5. Google sign-in.
6. Queued: "we've got it, your share link goes live once checked."
7. Human review at the admin page → approve or reject.
8. Rejection explains **why** and **how to fix it**. Because most of these tools are
   AI-generated, the fix instruction can literally be a prompt to paste back into Claude.

Pattern note: this is **asynchronous request-reply**, not optimistic UI. Optimistic UI
suits actions that almost always succeed; moderation rejects a real fraction, so faking
success and retracting is worse than an honest pending state. Amazon does not fake
"order placed" — it is true, and the states after it are real.

## Architecture

| Concern | Choice | Why |
|---|---|---|
| Catalogue | Astro on Cloudflare Pages | Ships no JS by default; no bandwidth limits on any tier |
| Tool files | R2 bucket | S3-compatible; **egress always free** |
| Upload | One Worker | 100k requests/day free |
| Metadata | Git | Free versioning, provenance, public audit trail |
| Scanning | GitHub Actions | Free and unlimited on public repos |

**Why Cloudflare specifically:** a 25MB file that goes viral is terabytes. 100k downloads
= 2.5TB. On Vercel or Netlify that is an unannounced bill; Cloudflare's zero-egress model
means success cannot bankrupt the site. For a free product shipping large files, this is
structural, not a preference.

**Do not put tool files in git.** GitHub recommends repos stay under 1GB, and browser
uploads cap at 25MB — exactly the file limit, so it fails at the boundary.
Files in R2, metadata in git.

## Accepted risks

- **Downloads cannot be recalled.** Once a file is on a laptop it works forever. A tool
  can be delisted but existing copies persist. Checksums and versioning were considered
  and rejected as too complicated; email reachability is the only recall mechanism.
- **Manual review is a bottleneck.** One good day on Hacker News buries two reviewers.
  Mitigation is to cap intake, not to auto-approve.
- **Google-only sign-in excludes non-Google users.** Accepted for v1.
- **The scanner will never be airtight.** Which is why CSP injection matters — the
  browser enforces the promise where the scanner misses.

## Open items

1. **CSP spike — blocking.** One HTML file, `default-src 'none'`, a `fetch` that should
   fail, opened from `file://` in Chrome, Firefox and Safari. Meta-tag CSP is documented
   and `frame-ancestors`/`sandbox` are known not to work via meta, but **`file://`
   enforcement is undocumented**. If it does not hold, the safety model needs rethinking.
2. Scanner location — Worker vs Actions (Q27, deferred).
3. Editor-assembled curation pages (Q18, deferred).
4. Remix / tool families — deferred, happens off-site for now.
5. Request board (Q19) — dropped, may return.
6. Review SLA — 48h proposed, not yet committed.