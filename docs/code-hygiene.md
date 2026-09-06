# Code hygiene, ranked by what it actually prevents

Written 2026-09-06. Opinionated on purpose: a list of every good practice is not
useful, because the cost of adopting all of them is what stops teams adopting any
of them.

Ordered by defects prevented per unit of effort, not by how professional it looks.

---

## What this project already does better than most

Worth stating, because the answer to "how do we get more professional" is partly
"keep doing these", and partly "do not let a tool undo them".

- **Ports and adapters, enforced by a contract suite.** The same tests run against
  the fake and the real adapter, and they are not allowed to be weakened for the
  real one. That is a genuinely strong discipline and most codebases do not have it.
- **Comments that say why, not what.** `storage.ts` explains why the submitted
  hash is stored rather than the published one. `lambda.tf` explains why a Function
  URL needs two permissions. That is the expensive kind of knowledge and it is
  written down where it is needed.
- **Commit messages that are arguments, not labels.** They record what was
  considered and rejected.
- **No infrastructure drift**, and infrastructure in the same repository as the
  code it serves.

**Do not adopt Conventional Commits here.** `feat:` and `fix:` would replace prose
that explains *why* with a taxonomy that explains *what*, which the diff already
says. It is a downgrade dressed as rigour. Machine-readable commit messages earn
their place when they drive automated releases; nothing here releases.

---

## Tier 1 — do these

### 1. Secret scanning, in the hook and in CI

**The highest-consequence gap, by a distance.** The site repository is public and
this project handles a Google client id, an operator token, an xAI key and a
GitHub PAT. A secret committed to a public repository is compromised the moment
it lands — deleting it later removes it from the tip and not from history, and
crawlers watch public pushes in real time.

It nearly happened today: `terraform.tfvars` is gitignored, but
`terraform.tfvars.example` is **tracked**, the two names differ by one word, and
the tracked one is the file an editor is likely to open first.

`gitleaks` as a pre-commit hook and a CI job. Costs about a second. The failure it
prevents is unrecoverable, which is what puts it above everything else here.

### 2. A formatter, applied without discussion

Removes an entire category of review comment and makes every diff show only what
changed in meaning. Requires no judgment from anybody once it is on.

**Biome** rather than Prettier + ESLint: one tool, one config, no plugin
resolution, and fast enough to run on every commit without anyone minding. For a
TypeScript monorepo this size the multi-tool setup buys nothing.

Take its defaults. The worst outcome here is spending an afternoon on quote style.

### 3. Lint rules for async correctness — the ones that catch real bugs

Most lint rules catch style. A few catch defects, and this codebase is exactly
where they pay:

- **no-floating-promises** — an un-awaited promise in a read-modify-write against
  S3 loses a write silently. This code is full of read-modify-write against S3.
- **no-misused-promises** — an async function passed where a sync callback is
  expected runs, rejects, and reports nothing.
- **no-unnecessary-condition** and unused-variable rules, which mostly find code
  that stopped being reachable when something else changed.

These need type information, so they are slower than syntax-only rules. Run them
in CI and on the changed files in the hook.

---

## Tier 2 — do these next

### 4. A pre-commit hook that stays under two seconds

**Lefthook**, running on **staged files only**: format, lint, secret scan. Not the
test suite.

The rule that matters: a hook people wait for is a hook people bypass with
`--no-verify`, and a bypassed hook is worse than no hook because it creates the
belief that something is being checked.

### 5. CI runs the same checks, because the hook is bypassable

The hook is a convenience that catches things early. CI is the gate. If the two
disagree, the hook is wrong. Anything that must be true has to be checked where it
cannot be skipped.

### 6. Pin GitHub Actions to commit SHAs

`actions/checkout@v4` is a moving tag. Whoever controls it controls what runs in a
workflow — and the workflows here have `contents: write` and can push to `main`.
Pin to SHAs with the version as a trailing comment, and let Dependabot raise the
bumps.

This is the supply-chain risk that actually applies to this project, as against
the ones that generally get talked about.

### 7. Dependabot, weekly, grouped

npm and GitHub Actions. Grouped so it produces one pull request a week rather than
eleven. An unattended dependency bot that opens more than anyone reads is a
notification generator, not a security control.

### 8. Terraform gets the same treatment as the code

`terraform fmt -check` and `terraform validate` in CI, and **tflint**.

Infrastructure is where this project's expensive mistakes have actually happened:
a certificate in the wrong region, a permission discovered only at apply, a policy
edit that saved and changed nothing. None of those were TypeScript.

### 9. A dirty-tree guard on `terraform apply`

`scripts/publish.mjs` already refuses to publish a tool from an uncommitted tree.
`terraform apply` has no equivalent, and on 2026-09-05 that let a Lambda be
deployed from code that existed only on one laptop — production running something
no commit described.

The principle is already agreed and written down. It is applied to one path and
not the other.

---

## Tier 3 — worth having, lower return

- **Coverage reported, never gated.** A number in the pull request is useful. A
  threshold produces tests written to move the number, which assert nothing and
  cost forever. This project's problem has never been too few tests.
- **`npm audit` / OSV in CI**, advisory rather than blocking.
- **A pull request template** with one question: what would tell us this was
  wrong? Most templates are checklists nobody reads.
- **CODEOWNERS** when there is more than one person. Today it would be theatre.

---

## Deliberately not recommended

- **Coverage thresholds.** See above.
- **A large lint ruleset.** Every rule that fires on correct code teaches people
  to reach for a disable comment, and that habit does not stay confined to the
  rules that deserved it.
- **Conventional Commits.** See the top of this file.
- **Running the full test suite in a pre-commit hook.** 116 unit and 43 browser
  tests is a CI job, not something to wait for before every commit.
- **A formatting debate.** Take the defaults.

---

## Order to actually do it in

1. gitleaks — hook and CI
2. Biome — format and lint, applied across the repository in one commit so no
   later diff is half formatting
3. Type-aware async rules in CI
4. Lefthook wiring the first three onto staged files
5. Terraform fmt, validate, tflint in CI
6. Pin the actions, then Dependabot
7. The apply guard

Steps 1 and 2 are most of the value and take under an hour.
