# Spec: mimawsi.com v1

Pipeline position: proposal → **spec** → criteria → rules → review → plan

Input: [proposal.md](./proposal.md) · Prior decisions: [grilling-decisions.md](./grilling-decisions.md)

---

## Feature summary

mimawsi.com is a free catalogue of single-file HTML tools that anyone can try in the
browser and download to keep. A tool is exactly one self-contained `.html` file of 25MB or
less that makes no network requests of any kind, so it works offline forever and cannot
exfiltrate anything. Anyone may browse, run and download without an account. To share a
tool, a maker drags the file in — it runs locally in their browser immediately, with
nothing uploaded — then signs in with Google and submits it, at which point it enters a
human review queue. Published tools carry an injected Content-Security-Policy that makes
the browser itself enforce the no-network promise. The site is static-first on AWS
with serverless functions, so it costs effectively nothing to run.

## Resolved ambiguities

| Decision | Outcome | Rationale |
|---|---|---|
| Tool capability envelope | Read user-chosen files, process, generate a download, and persist settings via `localStorage`/`IndexedDB`. Workers, WASM, camera and mic remain out of scope | Covers the trigger use case (text on images → save result). Storage is permitted because it is local-only and therefore not an exfiltration route |
| CSP directives | `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:` | Tools are entirely inline, so `'unsafe-inline'` is mandatory; `data:`/`blob:` carry embedded and generated images |
| Rejection scope | Auto-reject **only** for reaching the network; everything else is reviewer judgement | Follows from the exfiltration-only principle. Also resolves the awkwardness that CSP has no directive for storage and so could never have enforced a storage ban |
| Screenshots | Headless Chrome in GitHub Actions at approval | Actions is free and unlimited on public repos, so this is genuinely zero-cost; Actions is already in the pipeline |
| Sign-in timing | Prompted at Submit; bytes reach object storage only after | Anonymous uploads would let a script exhaust free-tier storage and start costing money |
| Hosting | AWS | Operator runs no additional hosting provider. Always-free tier covers it: CloudFront 1TB/month egress, Lambda 1M requests, DynamoDB 25GB |
| Scanner scope | Outbound network capability only; **not** code quality | Operator's explicit narrowing — tools are not rejected for being poorly put together |
| Scanner implementation | Off-the-shelf engine (semgrep) in GitHub Actions | Operator declines to write and maintain a parser |
| Account creation | Implicit on first Google sign-in; username chosen once, defaulted from Google profile name | No separate signup step |
| Fast scan location | Client-side in the browser at drop, **advisory only** | Gives instant feedback at zero cost; an attacker can bypass it, so it is never authoritative |
| Deep scan location | GitHub Actions, authoritative | Free on public repos; the only scan a publish decision may rely on |
| Post-publish edits | File and metadata changes both re-enter review; URL stable; latest approved version served; no history | Closes the bypass where a bland tool is approved then its description rewritten into abuse |
| Unpublish | Immediate, no review | Removal is always safe |
| Reports | Anonymous, queued, tool stays live; admins hold an instant delist action | Anonymous maximises reports and cannot be weaponised; auto-delist would let one click silence any maker |
| Identical files | Rejected on hash match, pointing at the existing tool | Prevents duplicate clutter without needing an ownership model |
| Rejected submissions | Editable and resubmittable against the same record | Rejection is a repair loop, not a wall |
| Search | Title, description and tags, client-side over a prebuilt static index | Zero server cost; fits the static architecture |
| Review turnaround | No stated SLA, no queue position, no intake cap | User's explicit choice — see accepted risks |

## Explicit assumptions

1. **The maker is more technical than the downloader.** Uploading requires having produced
   an HTML file; browsing requires nothing.
2. **Most tools are far below the cap.** 25MB is the ceiling, not the norm; typical
   single-file tools are under 1MB, so 10GB of R2 holds thousands.
3. **Review volume stays low enough for two people** during v1. Not defended by any
   mechanism — see accepted risks.
4. **Tools are AI-generated more often than hand-written**, which is why rejection guidance
   can take the form of a prompt to paste back into an assistant.
5. **The catalogue is seeded by the operators.** Supply is not assumed to arrive on its own.
6. **Per-account submission rate limit of 5/day** is sufficient to blunt bulk abuse.
7. **Google account availability** is assumed for anyone wishing to share.

## Handled edge cases

| Case | Behaviour |
|---|---|
| File over 25MB | Rejected client-side at drop, before any upload |
| Not a single `.html` file | Rejected client-side at drop |
| File identical to an existing tool | Submission rejected, existing tool linked |
| Tool renders nothing without user input | Screenshot captures whatever is present after a fixed delay; a near-blank image is acceptable |
| Tool uses `localStorage` | Permitted; local-only, so not an exfiltration route |
| Tool uses a Worker, WASM, camera or mic | Flagged for reviewer judgement, not auto-rejected. CSP denies Workers and WASM at runtime, so such a tool will not function as published |
| Client-side scan bypassed | Deep scan in Actions is authoritative and repeats every check |
| Maker edits a live tool | Live version keeps serving until the edit is approved |
| Tool reported at 2am | Stays live until a human reviews it |
| Tool delisted after download | Existing copies keep working forever; unrecallable by design |
| Uploader abandons mid-flow | Nothing was uploaded, so nothing to clean up |
| Screenshot job fails | Tool publishes without an image rather than blocking the queue |

## Behaviours to verify

**Discovery**
- **B-1** The system displays the catalogue of approved tools to any visitor with no sign-in.
- **B-2** The system returns matching tools when a visitor searches title, description or tags.
- **B-3** The system runs an approved tool in a sandboxed iframe when a visitor chooses to try it.
- **B-4** The system serves the original `.html` file unmodified-since-publish when a visitor downloads a tool.
- **B-5** The system displays a screenshot on a tool's card when one exists, and the card without one when it does not.

**Sharing**
- **B-6** The system runs a dropped `.html` file locally in the browser without transmitting it.
- **B-7** The system reports structural scan failures to the uploader at drop time, before any upload occurs.
- **B-8** The system rejects a dropped file larger than 25MB at drop time.
- **B-9** The system rejects a dropped file that is not a single `.html` file at drop time.
- **B-10** The system drafts a description from the file's source for the uploader to edit.
- **B-11** The system prompts Google sign-in when an unauthenticated uploader submits.
- **B-12** The system creates an account with a chosen username on a user's first sign-in.
- **B-13** The system transmits the file to storage only after successful sign-in and submission.
- **B-14** The system rejects a submission whose file hash matches an already-published tool, and links that tool.
- **B-15** The system refuses submissions from an account that has exceeded its daily limit.
- **B-16** The system places an accepted submission in the review queue with pending status.
- **B-17** The system shows a maker the current status of their own submissions.

**Scanning**
- **B-18** The system runs the authoritative deep scan on every submitted file.
- **B-19** The system auto-rejects a file containing a construct capable of making an outbound network request.
- **B-19a** The system flags, without auto-rejecting, a file containing dynamic code evaluation or an out-of-scope capability, for a reviewer to judge.
- **B-20** The system records scan findings against the submission for the reviewer to read.
- **B-21** The system captures a screenshot of the tool as part of the approval pipeline.

**Review**
- **B-22** The system shows a reviewer the tool running beside its scan report, on a page requiring admin authorisation.
- **B-23** The system publishes a tool when a reviewer approves it.
- **B-24** The system injects a Content-Security-Policy `<meta>` tag into every published file.
- **B-25** The system emails the maker when their submission is approved or rejected.
- **B-26** The system includes both the reason and remediation guidance in a rejection.
- **B-27** The system allows a rejected submission to be edited and resubmitted against the same record.

**After publish**
- **B-28** The system returns a tool to the review queue when its maker submits a changed file or changed metadata.
- **B-29** The system continues serving the live version while an edit to it is under review.
- **B-30** The system serves the latest approved version at a URL that does not change across edits.
- **B-31** The system unpublishes a tool immediately when its maker requests it, without review.
- **B-32** The system accepts a report against a published tool from a visitor with no account.
- **B-33** The system keeps a reported tool live and places the report in the admin queue.
- **B-34** The system delists a tool immediately when an admin invokes the delist action.

**Data lifecycle**
- **B-35** The system deletes the account record, email address and submission history when a maker deletes their account.
- **B-36** The system keeps a maker's published tools in the catalogue when that maker deletes their account, attributed anonymously.
- **B-37** The system purges a rejected submission and its stored file 90 days after rejection.
- **B-38** The system purges a delisted or unpublished tool's stored file 90 days after it leaves the catalogue.
- **B-39** The system retains a one-way hash of the email address and the ban reason when an account is banned, and retains nothing else about that account.
- **B-40** The system refuses account creation when the applicant's email address matches a retained ban hash.

## Accepted risks

1. **No review SLA.** User's explicit choice at Q6 after being shown that this is the
   silence pattern which kills upload retention. Mitigated only by the decision email.
2. **No intake cap.** A single day of heavy attention can produce a queue two people cannot
   clear. There is no mechanism to shed load.
3. **Downloads cannot be recalled.** Delisting removes a tool from the catalogue; every
   copy already downloaded keeps working. Checksums and versioning were considered and
   rejected as too complicated.
4. **Harmful content survives until a human looks**, by design, since auto-delist would be
   griefable.
5. **Scanning cannot detect obfuscated code.** Static analysis is defeated by JavaScript's
   dynamic features, so a determined attacker who obfuscates a network call will pass the
   scan. The controls that carry this risk are CSP (ED-1), human review of every submission,
   and post-publication reporting — not the scanner.
6. **Google-only sign-in** excludes anyone without a Google account.
7. **Egress is free to 1TB/month, then ~$0.085/GB.** Roughly 41,000 downloads of a
   maximum-size file, or ~2 million downloads of a typical one. Requires a billing alarm.

## Out of scope

Payment of any kind · automated rewriting or improvement of tools · remix and tool families ·
maker profile pages · a request board for tool ideas · editor-curated topic pages ·
ownership and licensing of uploaded code · version history and rollback · auto-approval of
any submission · email or GitHub submission routes · Web Workers, WASM, camera and
microphone in tools.

## External dependencies

**ED-1 — CSP enforcement from `file://`. Resolved for Chrome and Firefox; Safari outstanding.**

*Question:* Does a `<meta http-equiv="Content-Security-Policy">` tag block network requests
when the file is opened directly from disk?

*Answer:* **Yes.** Verified empirically on 2026-08-11 — see
[spikes/ed-1-csp/FINDINGS.md](../spikes/ed-1-csp/FINDINGS.md). Chrome and Firefox both fired
`securitypolicyviolation` events from a `file://` page for `fetch`, `XMLHttpRequest`,
`sendBeacon`, external images and `eval`, while permitting inline script, `data:` and `blob:`
images, and a generated blob download. AC-54 and AC-55 both hold, and the candidate directive
string is confirmed correct.

*Remaining:* Safari/WebKit is untested — it has no headless CLI and has historically diverged
on both CSP details and `file://` handling. Verify through the test harness (RULE-31) before
launch. Two independent engines agreeing makes a third divergence unlikely but not impossible.

*Bonus finding:* omitting `'unsafe-eval'` means `eval` and `Function()` cannot execute in a
published tool at all, so a tool relying on them is broken rather than dangerous — which
retrospectively justifies flagging rather than rejecting them (B-19a).

**ED-2 — Data retention and deletion. Resolved 2026-08-11.**

*Account deletion* removes the account record, email address and submission history. Published
tools **stay in the catalogue, attributed anonymously** — a published tool is a work rather
than personal data, and full deletion would let one departing maker gut the catalogue while
existing downloads kept working regardless. This must be stated plainly in the Terms before
a maker uploads.

*Retention* of rejected submissions and delisted tool objects is **90 days**, then hard
deletion. Long enough for resubmission, appeal or dispute; short enough to satisfy storage
limitation; automatic, so it needs no operator discipline.

*Precedence:* an **erasure request overrides the retention window immediately**. A maker who
deletes their account five days after a rejection has that submission removed at once, not 85
days later. The single exception is the ban hash, which survives because it rests on
abuse-prevention grounds rather than on retention. Retention governs data nobody has asked to
have erased; it is a maximum, never a minimum.

*Ban records* survive deletion as a **one-way hash of the email address plus reason and date,
and nothing else** — enough to refuse re-registration without retaining personal data, on
abuse-prevention grounds. Must be named in the privacy policy.

*The operator is EU-based*, so GDPR applies to mimawsi as controller and personal data is kept
in an EU region (RULE-37). Not legal advice — have the Terms and privacy policy reviewed
before launch.