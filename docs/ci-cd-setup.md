# GitHub → AWS: what to set up, and what is not ready yet

## First, the honest position

**There is almost nothing to deploy yet.** Phase 0 runs entirely on fakes: storage
is a local directory, identity is a stub, the "publish pipeline" is a CLI writing
files into `packages/site/`. The S3 + DynamoDB adapters arrive at **task-3.5**,
auth at **task-3.4**, the scanning pipeline in **phase 4**.

A deploy workflow today could ship the static catalogue and nothing else — and
that catalogue's submit button would point at an API that does not exist in AWS.
So the useful thing to build now is **CI** (does it pass?), not **CD** (ship it).

CI is written and committed: [.github/workflows/ci.yml](../.github/workflows/ci.yml).
It runs typecheck, 41 unit tests and 43 Playwright tests on three engines, and
holds **no AWS credentials at all**.

## Set up in GitHub now

1. **Create the repository — it must be PUBLIC.**
   RULE-1: Actions minutes are unlimited only on public repos, and the scan,
   screenshot and publish steps all depend on that allowance. A private repo
   silently breaks the economics of the whole pipeline.

2. **Push, and confirm Actions is enabled.** CI runs on every branch and PR.

3. **Branch protection on `main`** once the first PR is green — require the
   `test` check. (operator-setup.md defers this to "more than one person", but a
   required check costs nothing now.)

4. **Nothing else yet.** Do not add AWS secrets before there is a deploy job to
   use them; an unused credential is pure risk.

## Secrets and variables — and why there are fewer than you'd expect

**Use OIDC, not access keys.** GitHub Actions federates into an IAM role and gets
short-lived credentials. There is no `AWS_ACCESS_KEY_ID` to store, rotate, or leak.
Note `operator-setup.md` records an IAM **user** `mimawsi-deploy` with a local
profile — that is fine for your laptop, but CI must not use it.

| Name | Kind | Needed by | Notes |
|---|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | **variable** | first deploy job | Not secret — an ARN is not a credential |
| `AWS_REGION` | variable | first deploy job | One EU region (RULE-37) |
| `SITE_BUCKET` | variable | site deploy | Private; CloudFront reads it (RULE-2) |
| `CLOUDFRONT_DIST_ID` | variable | site deploy | For invalidation (RULE-43) |
| `GOOGLE_OAUTH_CLIENT_ID` | variable | task-3.4 | Public by design |
| `GOOGLE_OAUTH_CLIENT_SECRET` | **secret** | task-3.4 | The only true secret so far |

To create the OIDC role in AWS:
- Add the IAM OIDC identity provider for `token.actions.githubusercontent.com`.
- Create a role whose trust policy allows **only your repo**, and ideally only
  specific refs — `repo:<owner>/<repo>:ref:refs/heads/main` — not `repo:<owner>/*`.
- Grant it the narrowest policy that does the job (see the constraint below).
- Give the deploy job `permissions: id-token: write`. **CI must never have it.**

## The constraint that changes the design

**RULE-17a: Actions MUST NOT hold direct credentials to DynamoDB or the published
S3 prefix.** All pipeline writes go through the results Lambda.

So the eventual workflow is *not* "Actions has AWS keys and syncs everything". It
splits:

- **Catalogue/site deploy** — Actions may write the *site* bucket and invalidate
  CloudFront. This is fine.
- **Publishing a tool** (scan → screenshot → inject CSP → publish) — Actions does
  the work but **posts results to the results Lambda**, which is the only writer
  to DynamoDB and the published prefix.

task-4.x validation makes this checkable: *"GitHub Actions holds no DynamoDB or S3
credentials anywhere in the workflow definition."*

## Blockers to decide before a deploy job exists

1. **The live infra was built by CLI, not Terraform.** Route 53 zone, ACM cert,
   CloudFront distribution and the site bucket exist outside any state file.
   task-1.3 requires importing them or recreating. **Import** the zone and the
   cert/distribution — recreating the zone changes nameservers and breaks the
   GoDaddy delegation.
2. **Runner origin undecided.** RULE-23 needs tools on a separate origin, but the
   certificate covers only `mimawsi.com` and `www.`. A `runner.mimawsi.com`
   subdomain needs a new or replacement certificate. Decide before task-2.3.
3. **You cannot verify from your current network.** A FortiGate appliance MITMs
   HTTPS and returns 403 for `mimawsi.com`. Any "deploy failed" signal from this
   machine may be the appliance, not AWS. Verify from elsewhere.

## Suggested order

1. Public repo + push + CI green. ← *do this now*
2. Branch protection requiring `test`.
3. task-1.3: import the CLI-built resources into IaC, add the OIDC role.
4. A site-only deploy job on `main` (site bucket + invalidation) — genuinely
   useful once the catalogue is worth showing.
5. Everything else follows the phase order; the publish pipeline lands in phase 4
   and must route through the results Lambda.
