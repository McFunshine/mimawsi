# Technical Design and Constraints: mimawsi.com v1

## Overview

A free catalogue of single-file, zero-install HTML tools that anyone can try in-page and
download to keep. See [spec.md](./spec.md) and [criteria.md](./criteria.md).

**Stack (all new — this is a greenfield repository).** Astro (static catalogue) → S3 +
CloudFront · AWS Lambda Function URLs, TypeScript on Node 22 (upload, auth, results, admin) ·
DynamoDB (all mutable state) · S3 (tool files) · SES (notifications) · GitHub Actions
(scan, screenshot, CSP injection, publish) · Google OAuth direct · Vitest + Playwright (tests).

**Two languages, one boundary.** TypeScript everywhere that shares a contract with the
browser. Python in the scan workflow only — semgrep is a Python package, so that runtime is
present regardless, and the job shares no type with anything. See RULE-44.

## Design

**Components.** *Catalogue* — statically generated, served from CloudFront, no runtime
compute. *Runner* — sandboxed iframe on a separate origin that executes a tool. *Upload
Lambda* — authenticates, hashes, stores, writes a pending submission row. *Auth Lambda* — Google OAuth exchange,
issues a session cookie. *Admin Lambda* — queue reads and approve/reject/delist writes. *Results Lambda* — the
pipeline's only write path: accepts scan findings and screenshot references and records them
against a submission. *Pipeline* — GitHub Actions workflows that extract, scan, screenshot,
inject CSP and publish.

**Boundaries.** Lambdas are the only writers to DynamoDB; the pipeline reaches it solely
through the results Lambda and holds no database credentials. Only the post-approval publish
workflow writes to the published S3 prefix. The catalogue is read-only and has no
credentials.

**Flow.** A dropped file runs locally and is pre-checked in the browser; nothing is
transmitted. On submit, the user authenticates, the Lambda hashes the bytes, stores them
under a pending prefix and writes a submission row. The scan workflow extracts inline script
with parse5, runs semgrep over the extracted JavaScript, screenshots with Playwright, and
posts findings to the results Lambda. A reviewer approves; the publish workflow injects the
CSP meta tag, copies the file to the published prefix, writes metadata, and rebuilds the
catalogue. SES notifies the maker.

**Key dependencies.** TypeScript: `astro`, `@playwright/test`, `parse5` (CSP injection),
`aws-sdk v3`, `vitest`. Python, confined to the scan workflow and retention jobs (RULE-44):
`semgrep`, `html5lib` (extraction), `pytest`. Declined: Cognito, RDS/Aurora, API Gateway, SQS,
any bespoke JavaScript analyser.

## Codebase Alignment

There is nothing to inherit. The repository contains only `spec/`, `.claude/skills/` and a
`CLAUDE.md` covering context-mode tool routing — no build files, no source, no ADRs, and it
is **not yet a git repository**. Every rule below is therefore a new decision rather than a
diff against convention. `CLAUDE.md` imposes no code conventions and is not in tension with
anything here. Initialising git is a prerequisite, since the publish pipeline and the free
Actions allowance both depend on a public GitHub repository.

## Rules

### RULE-1
**Covers:** project-wide
**MUST** initialise the project as a git repository with a public GitHub remote before any pipeline work.
**Reason:** GitHub Actions minutes are unlimited only on public repositories, and the scan, screenshot and publish steps all depend on that allowance.

### RULE-2
**Covers:** AC-7, AC-58
**MUST** serve every published tool file and catalogue asset through CloudFront backed by S3, and **MUST NOT** expose the S3 bucket for direct public reads.
**Reason:** S3-to-CloudFront transfer is free within one account, whereas direct S3 internet egress is billed past 100GB. This is the single largest cost lever in the system.

### RULE-3
**Covers:** project-wide
**MUST** configure an AWS billing alarm before the site accepts public traffic.
**Reason:** CloudFront egress is free only to 1TB/month; beyond that it is ~$0.085/GB. One popular 25MB tool can cross it (Accepted Risk 7).

### RULE-4
**Covers:** AC-20, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-49, AC-51
**MUST** hold all mutable state — accounts, submissions, reports, rate-limit counters — in DynamoDB.
**Reason:** Always-free at 25GB with no idle cost, and it is the only AWS store meeting the zero-cost constraint that also offers conditional writes.

### RULE-5
**Covers:** project-wide
**MUST NOT** store mutable state in git.
**Reason:** Negative decision. Git offers no transactions, so concurrent submissions race and the rate limit in AC-26 becomes unenforceable. Git holds published metadata only, as an audit trail and rebuild trigger.

### RULE-6
**Covers:** project-wide
**MUST NOT** introduce RDS or Aurora Serverless.
**Reason:** Negative decision. Both were surveyed as the relational option; both carry idle capacity cost, which breaks the zero-cost constraint that the whole product depends on.

### RULE-7
**Covers:** AC-18, AC-19, AC-20, AC-21, AC-22
**MUST NOT** introduce Amazon Cognito.
**Reason:** Negative decision. Surveyed as the AWS-canonical identity service; declined because the requirement is one provider, no passwords, no profiles and no MFA, which Cognito's machinery and branding constraints do not repay. Reconsider if a second provider or account recovery is ever required.

### RULE-8
**Covers:** AC-18, AC-20
**MUST** verify the Google `id_token` signature against Google's published JWKS and validate its `aud` and `exp` claims before creating or resolving an account.
**Reason:** An unverified token is attacker-supplied input; accepting it would let anyone assume any identity.

### RULE-9
**Covers:** AC-19, AC-29
**MUST** carry the session in a signed cookie marked `HttpOnly`, `Secure` and `SameSite=Lax`.
**Reason:** The runner executes untrusted code on a sibling origin; a script-readable session token would be reachable if isolation ever failed.

### RULE-10
**Covers:** AC-24, AC-25, AC-26
**MUST** enforce the submission rate limit with a single conditional DynamoDB write, and **MUST NOT** implement it as a read followed by a separate write.
**Reason:** Read-then-write is racy under concurrent submissions and the limit would be trivially exceeded.

### RULE-11
**Covers:** AC-19
**MUST NOT** accept file bytes on any unauthenticated request path.
**Reason:** Anonymous writes let a script exhaust free-tier storage and start incurring cost.

### RULE-12
**Covers:** AC-23, AC-7, AC-46
**MUST** compute the content hash server-side and store the object under a key derived from it.
**Reason:** A client-supplied hash is forgeable, and content-addressed keys make duplicate detection, immutability and cache correctness fall out for free.

### RULE-13
**Covers:** project-wide
**MUST** use Lambda Function URLs and **MUST NOT** introduce API Gateway.
**Reason:** Negative decision. API Gateway is billed per request with no always-free allowance; Function URLs are included in Lambda's, and no Gateway feature is required.

### RULE-14
**Covers:** AC-30
**MUST** run the authoritative scan in GitHub Actions and **MUST NOT** run it in Lambda.
**Reason:** Actions is free on public repositories and unconstrained by Lambda's execution limits, which semgrep on a 25MB file could otherwise exceed.

### RULE-15
**Covers:** AC-31
**MUST** extract the contents of every `<script>` element, write them as `.js` files, and run semgrep against those files rather than against the `.html` file.
**Reason:** Semgrep's HTML support is experimental and it does not extract JavaScript from inline `<script>` elements — its extract mode was removed. A mimawsi tool is entirely inline script, so scanning the `.html` directly would read nothing material while reporting success. Extraction is not a parser or AST walker, so RULE-16 is unaffected.

### RULE-15c
**Covers:** AC-30, AC-31
**MUST** perform extraction with a parser that implements the HTML5 parsing algorithm — `html5lib` in Python, `parse5` in TypeScript — and **MUST NOT** use `lxml`, `html.parser`, regular expressions or any other non-conforming parser.
**Reason:** A parser that disagrees with browsers about malformed markup creates a differential: markup the scanner reads as inert text but a browser executes as script. That gap is unscanned executable code, and it is reachable deliberately by anyone who reads this file. Spec conformance is the property that closes it, and it must be demonstrated against adversarial fixtures rather than assumed from documentation.

### RULE-15a
**Covers:** AC-30, AC-31
**MUST** reject a submission whose HTML cannot be parsed, and **MUST NOT** treat an extraction that yields no script as a passing scan.
**Reason:** An empty extraction and a clean file are indistinguishable downstream; without this, a file crafted to defeat the extractor would publish unscanned.

### RULE-15b
**Covers:** AC-30, AC-31
**MUST** extract executable content from event-handler attributes, `javascript:` URLs, `<iframe srcdoc>` content and script elements nested in SVG, in addition to top-level `<script>` elements.
**Reason:** Each is a route to executing JavaScript that a naive `<script>`-only extractor would miss, leaving code unscanned at the security boundary. This enumeration is not provably complete — see Risk Hotspots — which is why RULE-15a fails closed and CSP backstops it.

### RULE-16
**Covers:** AC-31
**MUST NOT** write a bespoke JavaScript parser or AST walker.
**Reason:** Negative decision, recorded because it will be tempting later. The literature establishes that static analysis cannot reliably detect obfuscated malicious JavaScript, so a bespoke analyser would cost real maintenance while still missing a determined attacker. CSP, human review and reporting are the controls that actually carry the risk.

### RULE-17
**Covers:** AC-31, AC-31b, AC-31c
**MUST** limit auto-rejection to constructs capable of an outbound network request or an external subresource reference, and **MUST NOT** reject or flag a file for using `localStorage` or `IndexedDB`.
**Reason:** Operator's explicit scope: only reaching the network is disqualifying. Storage is local-only and therefore not an exfiltration route; tools are not rejected for being poorly built. Widening this silently would reject legitimate makers.

### RULE-17a
**Covers:** AC-32, AC-35
**MUST** route all pipeline writes through the results Lambda, and **MUST NOT** grant GitHub Actions direct credentials to DynamoDB or to the published S3 prefix.
**Reason:** The pipeline processes hostile input; keeping it credential-free preserves the Design boundary that Lambdas are the only database writers, and limits the blast radius of a compromised action.

### RULE-18
**Covers:** AC-31a, AC-32
**SHOULD** record every network request attempted during the Playwright screenshot run and attach it to the submission as a reviewer flag, observing requests or `securitypolicyviolation` events and **MUST NOT** infer the outcome from an API's return value.
**Reason:** Playwright already runs for AC-33, so this costs almost nothing, and it catches obfuscated attempts that a static engine cannot because obfuscation has resolved by runtime. The return-value prohibition is empirical: in the ED-1 spike Chrome's `navigator.sendBeacon` returned `true` for a request CSP had blocked, while Firefox returned `false`. Omit the whole rule only if it proves flaky.

### RULE-19
**Covers:** AC-11, AC-30
**MUST** treat the in-browser pre-check as advisory and **MUST NOT** let its result authorise publication.
**Reason:** Client-side checks run on the attacker's machine and can be bypassed entirely.

### RULE-20
**Covers:** AC-38, AC-54
**MUST** inject the CSP `<meta>` element as the first child of `<head>`.
**Reason:** A meta policy governs only content the parser processes after it, so anything above it would be unprotected.

### RULE-21
**Covers:** AC-6, AC-38
**MUST** inject `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`, and **MUST NOT** add `'unsafe-eval'` or any directive beyond what inline script, inline style, embedded images and generated downloads require.
**Reason:** Verified against `file://` in Chrome and Firefox on 2026-08-11 — this exact string denies `fetch`, `XHR`, `sendBeacon`, external images and `eval` while permitting inline script and style, `data:`/`blob:` images and blob downloads. See [spikes/ed-1-csp/FINDINGS.md](../spikes/ed-1-csp/FINDINGS.md). Omitting `'unsafe-eval'` is load-bearing: it makes dynamically evaluated code non-functional in published tools.

### RULE-22
**Covers:** AC-38
**MUST NOT** rely on `frame-ancestors` or `sandbox` within the injected meta policy.
**Reason:** The CSP specification does not support either directive via `<meta>`; including them would give false assurance.

### RULE-23
**Covers:** AC-5, AC-60
**MUST** serve the in-page runner from a distinct origin and apply `sandbox` without `allow-same-origin` whenever `allow-scripts` is present.
**Reason:** A frame granted both can reach into its own sandbox attribute and remove it, defeating the isolation entirely.

### RULE-24
**Covers:** AC-6
**MUST** send the content policy as an HTTP response header for the in-page runner, in addition to the meta tag inside the file.
**Reason:** A header cannot be stripped by file content and is authoritative; this is the mechanism Neocities relies on for the same problem.

### RULE-25
**Covers:** AC-36, AC-53, AC-29
**MUST** verify reviewer authorisation server-side on every admin request, and **MUST NOT** rely on the absence of a link or route as access control.
**Reason:** Admin surfaces expose unreviewed hostile files; client-side gating is not access control.

### RULE-26
**Covers:** AC-2, AC-36
**MUST NOT** serve pending or rejected submission content from any CloudFront path.
**Reason:** Unreviewed files are untrusted by definition and must not be publicly reachable before a human has seen them.

### RULE-27
**Covers:** AC-47
**MUST** make an unpublished tool unreachable through CloudFront immediately, and **MUST** apply the same 90-day bounded retention to unpublished tool objects and to rejected submission files before deleting them.
**Reason:** Unpublication must take effect at once, while a bounded retention window keeps the action reversible and preserves the moderation record without holding data indefinitely — which storage limitation under GDPR would not support. Rejected submissions and unpublished tools share the window because they pose the same question: can this be restored or disputed later?

### RULE-28
**Covers:** AC-39, AC-40, AC-41, AC-42
**MUST** send decision notifications through SES, including the failing check and its remediation text on rejection.
**Reason:** The rejection message is the maker's only repair path; a bare "rejected" makes resubmission guesswork.

### RULE-29
**Covers:** AC-30
**MUST** pin every GitHub Action to a commit SHA, and **MUST** separate scanning and publishing into two workflows: the scan workflow runs with a read-only token and is the only one that touches unreviewed input; the publish workflow holds write scope, runs only after a human approval, and never processes an unreviewed file.
**Reason:** The scan workflow processes hostile input by design, so it must not hold credentials that could publish arbitrary content. A single workflow cannot be both read-only and able to publish.

### RULE-30
**Covers:** project-wide
**MUST NOT** write tool file contents or user email addresses to application logs.
**Reason:** The product's headline promise is that nothing leaves the user's machine; logging contents would contradict it and create a PII store the privacy policy does not cover.

### RULE-31
**Covers:** AC-54, AC-55
**MUST** carry an automated test that opens a published file from the local filesystem and asserts both that an outbound request is denied and that a generated download succeeds.
**Reason:** ED-1 is unverified and load-bearing; a regression here silently voids the site's core promise.

### RULE-32
**Covers:** project-wide
**MUST** write application code in TypeScript except where RULE-44 places it in Python, use Vitest for TypeScript unit tests and Playwright for end-to-end tests, and use pytest for the Python components' own unit tests.
**Reason:** Greenfield repository with no existing convention; Playwright is already required for screenshots, so the e2e choice avoids a second browser-automation dependency. End-to-end tests stay in TypeScript regardless of what they exercise — they are black-box, so splitting them by the implementation language of the thing under test would buy nothing and cost a second browser-automation stack.

### RULE-34
**Covers:** AC-2, AC-19, AC-29, AC-36, AC-48, AC-53
**MUST** assert, in every test covering an `If ... then` criterion, that the prohibited outcome did not occur — no row written, no object stored, no state transition, no notification sent — and **MUST NOT** treat a rejected status code alone as sufficient.
**Reason:** The value of a negative criterion is entirely in its "and not" half; a test asserting only the error response passes even when the side effect happened anyway.

### RULE-35
**Covers:** AC-12, AC-13, AC-14, AC-24, AC-25, AC-26
**MUST** test every bounded value at three points: within the bound, exactly at it, and beyond it.
**Reason:** Off-by-one errors at a limit are the characteristic failure of bounded values, and only the exact-boundary case detects them.

### RULE-36
**Covers:** AC-37, AC-43, AC-44, AC-45, AC-46, AC-47, AC-52
**MUST** assert both the resulting state and any emitted effect for every state-transition criterion.
**Reason:** A transition test that checks only the new state passes when the notification, publication or catalogue rebuild that should accompany it never fired.

### RULE-37
**Covers:** AC-61, AC-68, AC-69, AC-70
**MUST** create every resource holding **non-public** personal data — account records, email addresses, submission history and ban hashes — in an EU region, and **MUST NOT** replicate that data outside the EU.
**Reason:** The operator is established in the EU, so GDPR applies to mimawsi as controller, and keeping non-public personal data in-region removes transfer-mechanism questions rather than requiring them answered. The restriction deliberately excludes content a maker chose to publish — a tool and the username shown beside it are meant for worldwide distribution, so the global CloudFront delivery in RULE-2 is unaffected. The Terms must say this plainly.

### RULE-38
**Covers:** AC-65, AC-66, AC-67
**MUST** implement retention expiry as an automatic scheduled deletion, and **MUST NOT** rely on an operator action to purge expired data.
**Reason:** A retention promise in a privacy policy that depends on someone remembering is a promise that will be broken. S3 lifecycle rules and DynamoDB TTL both express this declaratively.

### RULE-39
**Covers:** AC-68, AC-69, AC-70
**MUST** store the ban identifier as a salted one-way hash of the email address, and **MUST NOT** store the address itself, a reversible transformation of it, or any other field from the deleted account.
**Reason:** Refusing re-registration is defensible as abuse prevention only if the retained value cannot be turned back into personal data. An unsalted hash of an email address is trivially reversible by dictionary attack, so the salt is load-bearing rather than decorative.

### RULE-40
**Covers:** AC-62, AC-63
**MUST** model tool attribution as a reference that can resolve to an absent maker, and **MUST NOT** couple a published tool's existence to the existence of its maker's account.
**Reason:** Account deletion must leave tools published and anonymously attributed; a foreign-key cascade or a required author field would silently delete catalogue content instead.

### RULE-41
**Covers:** AC-61, AC-66a
**MUST** implement erasure as an immediate explicit deletion that runs independently of the scheduled retention expiry, and **MUST NOT** implement it by shortening an object's retention clock.
**Reason:** RULE-38's expiry mechanisms are asynchronous and best-effort, which is acceptable for a 90-day maximum but not for a request the maker has actively made. Rescheduling rather than deleting leaves personal data present for an unbounded period after erasure was requested.

### RULE-42
**Covers:** AC-63
**MUST** trigger a catalogue rebuild when an account is deleted, and **MUST NOT** leave a deleted maker's username visible until the next unrelated rebuild.
**Reason:** The catalogue is statically generated, so a username persists in published output until the site is regenerated. A personal-data removal with an unbounded propagation delay is not defensible.

### RULE-43
**Covers:** AC-63, AC-46, AC-47
**MUST** invalidate the CDN cache for catalogue pages whenever the catalogue is rebuilt, and **MUST NOT** rely on cache expiry for the removal of a delisted tool, an unpublished tool or a deleted maker's username.
**Reason:** Content addressing (RULE-12) makes tool files self-invalidating, but catalogue pages are mutable at stable URLs. Without explicit invalidation, a removal that is legally or editorially required stays visible at edge locations for the life of the cached object.

### RULE-44
**Covers:** project-wide
**MUST** confine Python to the scan workflow, and **MUST NOT** implement in Python anything that shares a contract with the browser — the upload, auth, results or admin Lambdas, the CSP injector, or the catalogue.
**Reason:** The scan workflow is a genuine seam: it holds no credentials, shares no types, and communicates only through a JSON payload to the results Lambda. semgrep is already a Python package, so that job carries a Python runtime regardless. Everything else shares submission states, API shapes and session format with the frontend, where a single TypeScript definition prevents the duplicate-contract drift two languages otherwise guarantee. Retention was also considered and is **not** a Python home — RULE-38 makes it declarative, so there is no job to write.

### RULE-45
**Covers:** AC-38
**MUST** keep CSP injection in TypeScript using `parse5`, in the publish workflow.
**Reason:** The injector's output is exactly what the `file://` regression test (RULE-31) asserts. Splitting the mechanism and its test across two languages and two parsers would let them diverge silently, and this is the control the entire product promise rests on.

### RULE-33
**Covers:** AC-56, AC-57
**MUST** keep the catalogue operable without JavaScript for browsing and downloading.
**Reason:** Astro ships no JavaScript by default and the catalogue is static; preserving this makes AC-56 nearly free and keeps the site usable in locked-down environments — the same audience the product exists for.

## Cross-Reference

| AC | Rules | AC | Rules |
|---|---|---|---|
| AC-1 | RULE-2 | AC-31 | RULE-14, 15, 15a, 15b, 15c, 16, 17 |
| AC-2 | RULE-26, 34 | AC-31a | RULE-18 |
| AC-3 | (none needed) | AC-31b | RULE-17 |
| AC-4 | (none needed) | AC-31c | RULE-17 |
| AC-5 | RULE-23 | AC-32 | RULE-17a, 18 |
| AC-6 | RULE-21, 24 | AC-33 | (none needed) |
| AC-7 | RULE-2, 12 | AC-34 | (none needed) |
| AC-8 | (none needed) | AC-35 | RULE-17a |
| AC-9 | (none needed) | AC-36 | RULE-25, 26, 34 |
| AC-10 | (none needed) | AC-37 | RULE-36 |
| | | AC-38 | RULE-20, 21, 22, 45 |
| AC-11 | RULE-19 | AC-38 | RULE-20, 21, 22 |
| AC-12 | RULE-35 | AC-39 | RULE-28 |
| AC-13 | RULE-35 | AC-40 | RULE-28 |
| AC-14 | RULE-35 | AC-41 | RULE-28 |
| AC-15 | (none needed) | AC-42 | RULE-28 |
| AC-16 | (none needed) | AC-43 | RULE-36 |
| AC-17 | (none needed) | AC-44 | RULE-36 |
| AC-18 | RULE-7, 8 | AC-45 | RULE-36 |
| AC-19 | RULE-9, 11, 34 | AC-46 | RULE-12, 36 |
| AC-20 | RULE-4, 8 | AC-47 | RULE-27, 36 |
| AC-21 | RULE-7 | AC-48 | RULE-25, 34 |
| AC-22 | RULE-7 | AC-49 | RULE-4 |
| AC-23 | RULE-4, 12 | AC-50 | (none needed) |
| AC-24 | RULE-4, 10, 35 | AC-51 | RULE-4 |
| AC-25 | RULE-4, 10, 35 | AC-52 | RULE-36 |
| AC-26 | RULE-4, 10, 35 | AC-53 | RULE-25, 34 |
| AC-27 | RULE-4 | AC-54 | RULE-20, 31 |
| AC-28 | RULE-4 | AC-55 | RULE-31 |
| AC-29 | RULE-9, 25, 34 | AC-56 | RULE-33 |
| AC-30 | RULE-14, 15a, 15b, 15c, 19, 29 | AC-57 | RULE-33 |
| | | AC-58 | RULE-2 |
| | | AC-59 | (none needed) |
| | | AC-60 | RULE-23 |
| AC-61 | RULE-37, 41 | AC-66a | RULE-41 |
| AC-62 | RULE-40, 34 | AC-67 | RULE-27, 38 |
| AC-63 | RULE-40, 42 | AC-68 | RULE-37, 39 |
| AC-64 | RULE-27, 35 | AC-69 | RULE-34, 37, 39 |
| AC-65 | RULE-27, 38, 35 | AC-70 | RULE-34, 37, 39 |
| AC-66 | RULE-38, 35 | | |

## Design Exclusions

- **Multi-region and failover** — no availability target is specified; a single region with
  CloudFront caching is sufficient for v1.
- **Infrastructure-as-code tooling choice** — deferred to the planning step; it constrains
  nobody's code and can be chosen when the first resource is created.
- **Queue infrastructure (SQS)** — not required. DynamoDB with an index on submission state
  serves the review queue at expected volume; introducing a queue would add a service for no
  present benefit.
- *(removed — cache invalidation turned out to need a rule; see RULE-43. Content addressing
  covers tool files but not catalogue pages, which are mutable at stable URLs.)*
- **Backup and restore of published tools** — no recovery objective is specified. The
  published S3 prefix is the only irreplaceable asset; versioning it is cheap, but a full
  backup strategy is deferred until the catalogue is worth restoring.

## External Dependencies

**ED-1 — CSP enforcement from `file://`. Resolved for Chrome and Firefox; Safari outstanding.**
*Answer:* Verified 2026-08-11 — meta CSP **is** enforced from `file://`, and blob downloads
still work under it. See [spikes/ed-1-csp/FINDINGS.md](../spikes/ed-1-csp/FINDINGS.md).
RULE-16's decision not to build a bespoke analyser stands: CSP genuinely carries the risk.
*Remaining:* Safari/WebKit untested — no headless CLI, and WebKit has diverged historically
on both CSP and `file://`. Verify via Playwright's WebKit build once RULE-31's harness exists,
before launch. If Safari alone fails, the promise holds for most users but cannot be stated
unconditionally.

**ED-2 — Data retention and deletion. Resolved 2026-08-11.** Account deletion removes the
account, email and submission history but leaves published tools in the catalogue,
anonymously attributed. Rejected submissions and delisted objects purge after 90 days. Ban
records survive as a one-way email hash plus reason and date. The operator is EU-based, so
GDPR applies and personal data stays in an EU region. See spec.md External dependencies.
*Remaining:* Terms and privacy policy need legal review before launch — a P0 content item,
not an engineering blocker.