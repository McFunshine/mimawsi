# Proposal: mimawsi.com v1

**Made It, Might As Well Share It** — a free catalogue of single-file, zero-install HTML tools.

Prior art for this proposal: [grilling-decisions.md](./grilling-decisions.md), which records
28 settled decisions and the alternatives rejected. Treat those as **already decided** unless
this proposal contradicts them.

---

## Problem

Small, genuinely useful browser tools get built and then die, because distribution is
harder than creation. Installing anything is impossible inside a locked-down organisation
(newsrooms, schools, NHS trusts), and every existing channel — app stores, npm, GitHub —
assumes technical skill the maker's audience does not have.

The trigger case: a journalist vibe-coded a text-on-images tool for their newsroom. The
tool itself underwhelmed. The *distribution* did not — it was one HTML file that anyone
could download and double-click, with no install, no account, no IT ticket.

## Thesis

This is a **distribution** problem, not a creation problem. Good small tools already exist
and cannot be found or run. We will seed the catalogue with our own tools rather than wait
for supply.

## What v1 is

A website where anyone can **share** a single-file HTML tool and anyone else can find it,
try it in the browser, and download it to keep forever. Sharing is not a feature of
mimawsi — it *is* mimawsi. A version without upload was proposed and rejected.

### The artifact contract

- Exactly one self-contained `.html` file — CSS and JS inlined, media base64-embedded
- Maximum 25MB
- **Makes no external network requests of any kind**
- Openable by someone who knows nothing about computers: download, double-click, works

The no-network rule is load-bearing three times: it makes exfiltration impossible, it
makes tools work offline in the field, and it means we never pay for compute. That last
point is the business model — the site is free and must cost near nothing to run.

> The rule binds the **tools**, not our backend. mimawsi may call an AI model at upload
> time; that is one cost per submission, not per visitor.

### Core flows

**Discover** — browse the catalogue, search, run any tool in a sandboxed iframe, download it.
No account needed to browse, run, or download.

**Share** — drag and drop an `.html` file. It runs immediately in the browser (it is the
user's own file, already local). A fast structural scan gives instant feedback. The user
supplies a title and description, with an AI-drafted description they can edit, and a
screenshot captured automatically. They sign in with Google. The submission is queued with
an honest pending state: "we've got it, your share link goes live once checked."

**Review** — a human opens a protected admin page showing the tool running beside its
scanner report, and approves or rejects. Nothing auto-approves in v1. Rejection explains
what is wrong and how to fix it; because most of these tools are AI-generated, the fix
instruction can be a prompt to paste back into Claude.

### Safety model

Two unrelated threats, handled differently:

- **Malicious code** — gated before publish. A scanner auto-rejects the unambiguous
  (network primitives, `eval`/`Function()`, obfuscation, external `src`, oversize).
  Separately, a CSP `<meta>` tag is injected into every published file so the browser
  enforces the no-network promise even where the scanner misses.
- **Horrific content** — cannot be detected statically. Human review before publish, plus
  a report mechanism afterwards.

### Architecture

Static-first with serverless functions, on Cloudflare. Astro on Cloudflare Pages for the
catalogue; an R2 bucket for tool files; one Worker for upload; metadata in git; GitHub
Actions for deep scanning.

Cloudflare is chosen for one structural reason: a 25MB file going viral is terabytes of
egress, and Cloudflare does not charge for it. On metered hosts, success produces an
unannounced bill. Tool files must not live in git — GitHub recommends repos stay under 1GB
and caps browser uploads at exactly 25MB.

## Explicitly out of scope for v1

- Any payment system — everything is free
- Automated rewriting or improvement of uploaded tools
- Remix / tool families — happens off-site for now
- Maker profile pages — username only
- A request board for tool ideas
- Editor-curated topic pages — wanted, but deferred
- Ownership and licensing of uploaded code — judged not important

## Known open items

1. **CSP enforcement from `file://` is unverified and blocking.** Meta-tag CSP is
   documented, but no source confirms behaviour for locally-opened files. Needs an
   empirical spike across Chrome, Firefox and Safari before the safety model is relied on.
2. Scanner location — Worker (fast, CPU-limited) vs GitHub Actions (free, slower). Assume
   Actions for now.
3. Review turnaround has no committed SLA; 48h was proposed.
4. Manual review is a throughput bottleneck with two reviewers, mitigated by capping
   intake rather than auto-approving.
5. Google-only sign-in excludes anyone without a Google account. Accepted for v1.
6. Downloads cannot be recalled. Delisting a tool does not remove existing copies;
   checksums and versioning were considered and rejected as too complicated.