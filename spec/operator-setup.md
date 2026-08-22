# Operator setup and parallel workstreams

What **you** have to do by hand, what the agent builds, and what can run at the same time.
Companion to [tasks.yaml](./tasks.yaml).
> **Concrete values live in `.env.local`** (gitignored). This file uses `${VAR}`
> placeholders so the runbook can be public. Copy `.env.example` to `.env.local` and
> fill it in; `source .env.local` before running any command here.


---

## The four streams

Only stream A blocks anything, and only late. Phases 1–3 are largely buildable and testable
locally against fixtures, so your AWS setup runs alongside the build rather than in front of it.

| Stream | Who | Runs when | Blocks |
|---|---|---|---|
| **A — Accounts and infrastructure** | You | Start now | Deployment, and phases 3 and 5 specifically |
| **B — Build** | Agent | Start now | — |
| **C — Content** | You and Claire | Start now | **cp-5** — hard blocker |
| **D — Design** | You / designer | Start after cp-1 | cp-2 polish |

**The important consequence:** streams B, C and D need nothing from you to begin. Start
stream A's two long-lead items today and the rest can proceed while they process.

---

## What you already have ✅

Checked against two existing projects. **Both long-lead items are largely solved.**

### SES production access — already enabled

From `~/Repos/impactr/demo3comms/docs/deployment-details.md`, verified live against AWS on
2026-07-11:

| | |
|---|---|
| AWS account | `${AWS_ACCOUNT_ID}` |
| Region | `eu-north-1` (Stockholm) — everything in one region |
| **Production access** | **ENABLED, out of sandbox** |
| Quota | 50,000 / 24h · 14 msg/sec · `HEALTHY` |
| Verified sending identities | `${SES_VERIFIED_DOMAIN}` (domain, Easy DKIM), `${SES_VERIFIED_EMAIL}`, plus one other domain |

**Production access is per account, per region.** Build mimawsi in that account in
`eu-north-1` and the sandbox problem simply does not exist — the ~24h support request that was
the longest pole in this plan is already done.

**Still needed:** verify `mimawsi.com` as a *new sending identity* — three Easy-DKIM CNAMEs
plus SPF. That is DNS propagation, minutes to an hour, not a support ticket.

Confirm current status with:
`aws sesv2 get-account --region eu-north-1 --query ProductionAccessEnabled`

That repo also documents the exact DNS record shapes for DKIM, MAIL FROM and SPF — copy the
pattern rather than rediscovering it.

### Google OAuth — project exists, needs a new client

`~/Repos/my_stuff/idea_thing` already has a working Google OAuth setup, and
That other domain is real. Its own `PRODUCTION_SETUP.md` documents the console steps.

**Reusable:** the setup knowledge, and the fact you have done this before.
**Not reusable:** the implementation (Java/Spring, does not port to a TypeScript Lambda) and —
importantly — **not the Google Cloud project either.** The OAuth consent screen is per-project
and shows its app name and logo to every user signing in. Reusing `idea_thing`'s project would
show mimawsi's makers the wrong application name at the moment they are deciding whether to
trust it. **Create a new project.**

---

## The one decision this raises: shared account or separate?

Reusing account `${AWS_ACCOUNT_ID}` gets you SES production access for free and is the pragmatic
choice for a side project. Two things to know before you commit to it:

- **Free-tier allowances are per account.** The 1TB/month CloudFront egress that makes mimawsi
  free is shared with everything else in that account, so mimawsi's real headroom is 1TB minus
  whatever the other projects use.
- **Blast radius.** The scan pipeline processes hostile files by design. Sharing an account
  puts other projects inside the radius of a compromise there. RULE-17a and RULE-29 keep that
  job credential-free, which is the mitigation — but it is a reason to keep IAM scoping tight.

**Recommendation: share the account for v1**, keep IAM roles narrow, and revisit if mimawsi
gets real traffic. The SES saving is worth more now than the isolation is.

---

## AWS — the infrastructure list

The agent writes the infrastructure definitions (task-1.3). You do the parts that need an
account, a card or a DNS record.

### Account and access
- [ ] AWS account, root MFA enabled, root keys deleted if any exist
- [ ] **Use `eu-north-1` (Stockholm) and stay in it.** Sweden is in the EU so RULE-37 is
      satisfied; your account already lives there; SES production access is already granted
      there and is region-locked; and it is among the cheapest AWS regions
- [ ] An admin IAM user or SSO role for yourself
- [ ] **GitHub OIDC identity provider** in IAM, plus a role the publish workflow assumes.
      Do this instead of long-lived access keys in GitHub secrets — the pipeline handles
      hostile files, so a static key in CI is the credential you least want to leak

### Storage
- [ ] Three S3 buckets — pending, published, site assets. **Names are globally unique**, so
      expect `mimawsi-published-eu-west-1` rather than `published`
- [ ] All three **block public access**; CloudFront reaches them via Origin Access Control
- [ ] Lifecycle rules for 90-day expiry on pending and unpublished prefixes (RULE-38)
- [ ] Versioning on the published bucket — cheap insurance, the only irreplaceable asset

### Delivery
- [ ] **ACM certificate in `us-east-1`** ⚠️ — CloudFront only accepts certificates from
      us-east-1 regardless of where everything else lives. This trips almost everyone. It does
      not conflict with RULE-37: a TLS certificate is not personal data
- [ ] CloudFront distribution over the site and published buckets
- [ ] **A second origin or distribution for the runner on a distinct domain** — RULE-23
      requires tools execute on a separate origin. Something like `runner.mimawsi.com`.
      Decide this before task-2.3
- [ ] Response headers policy carrying the CSP header for the runner origin (RULE-24)

### Data
- [ ] DynamoDB tables: accounts, submissions, reports, bans
- [ ] TTL attribute enabled on the tables holding expiring records (RULE-38)
- [ ] On-demand capacity — keeps you inside the always-free allowance with no idle cost

### Cost safety
- [ ] **Budget and billing alarm before any public traffic** (RULE-3). Egress is free to
      1TB/month then billed; the failure mode is a bill, not an outage, so it is silent
- [ ] SNS topic to an address you actually read

---

## Step by step — SES for `mimawsi.com`

Region `eu-north-1` throughout. You are **not** setting up production access; that already
exists on this account and region. You are only adding a new sending identity.

You do **not** need inbound MX records. `demo3comms` needed those because it *receives* mail;
mimawsi only sends decision notifications, so skip everything about `inbound-smtp`.

> ## ✅ DONE — 2026-08-11
> `dkim: SUCCESS · mailfrom: SUCCESS · verified: True · production: True · 50,000/24h`
>
> Identity created, all six DNS records published to zone `${ROUTE53_ZONE_ID}`, verified in
> ~2 minutes. **task-5.4 is unblocked.** Remaining check: send to a *non-verified* external
> address to prove production access applies to this identity.
> DKIM tokens: `${SES_DKIM_1}`, `${SES_DKIM_2}`,
> `${SES_DKIM_3}`. MAIL FROM `mail.mimawsi.com`, DMARC `p=none`.
>
> **DMARC has no `rua=`, deliberately.** External reporting requires the *receiving* domain to
> publish `mimawsi.com._report._dmarc.<their-domain>`, which you cannot create for gmail.com or
> proton.me — so a `rua` pointing there would silently collect nothing. `p=none` alone is valid.

1. **SES console → `eu-north-1` → Identities → Create identity → Domain → `mimawsi.com`**
2. **Enable Easy DKIM**, RSA_2048. If DNS is in Route 53 in the same account, tick *Publish DNS
   records to Route 53* and it does step 3 for you.
3. **Publish 3 DKIM CNAMEs** — `<token>._domainkey.mimawsi.com` → `<token>.dkim.amazonses.com`.
4. **Set a custom MAIL FROM domain**: `mail.mimawsi.com`
   - MX → `10 feedback-smtp.eu-north-1.amazonses.com`
   - TXT → `v=spf1 include:amazonses.com ~all`
   - Behaviour on MX failure → *Use default MAIL FROM domain*, so a DNS mistake degrades
     instead of rejecting mail.
5. **Add DMARC** — TXT on `_dmarc.mimawsi.com` → `v=DMARC1; p=none; rua=mailto:you@…`
   Start at `p=none` and tighten once you can see reports.
6. **Wait for verification** — minutes to about an hour.
7. **Confirm:**
   ```
   aws sesv2 get-email-identity --email-identity mimawsi.com --region eu-north-1 \
     --query '{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}'
   aws sesv2 get-account --region eu-north-1 --query ProductionAccessEnabled
   ```
   Expect `true` / `SUCCESS` / `true`.
8. **Send a real test** to a non-verified external address — that is the check that proves
   production access applies to this identity, not just the account.

---

## Step by step — Google OAuth for mimawsi

⚠️ **Create a new Google Cloud project.** The consent screen is per-project and shows its app
name to your users.

1. **New project**, name it `mimawsi`.
2. **APIs & Services → OAuth consent screen → External.**
3. Fill in: app name `mimawsi`, support email, logo (from design inventory §1.1), **authorised
   domain `mimawsi.com`**, and the **privacy policy and terms URLs**.
   > ⚠️ **This is a real dependency.** Google requires *live* privacy policy and terms URLs
   > before you can publish the consent screen. Those are P0 content items (design inventory
   > §2.5, §2.6) — so the legal copy blocks Google OAuth publishing, not just launch.
   > Placeholder pages are enough to develop against; real ones are needed to publish.
4. **Scopes:** `openid`, `email`, `profile` only. All non-sensitive, so **no Google verification
   review** is required — this is why the design chose Google-only sign-in with no profile data.
5. **Credentials → Create credentials → OAuth client ID → Web application.** Name it
   `mimawsi-web`.
   - **Authorised JavaScript origins** (no paths, no trailing slash):
     ```
     https://mimawsi.com
     http://localhost:4321
     ```
   - **Authorised redirect URIs** (exact match — scheme, host, port, path all count):
     ```
     https://mimawsi.com/auth/google/callback
     http://localhost:4321/auth/google/callback
     ```
   - 4321 is Astro's dev port; adjust if task-1.2 picks another.

   > **⚠️ Architectural consequence for task-1.3 / task-3.4.** The auth handler is a Lambda
   > Function URL, whose real hostname is `https://<id>.lambda-url.eu-north-1.on.aws/`. Do
   > **not** register that as the redirect URI — it exposes infrastructure and changes if the
   > function is recreated. Instead **CloudFront needs a cache behaviour routing `/auth/*` to
   > the auth Lambda as an origin**, so the clean URI above is what Google ever sees. Register
   > it now regardless; Google does not verify the endpoint exists.
6. **Store the client ID and secret** in AWS Secrets Manager and as GitHub Actions secrets.
   **Never in the repo** — `idea_thing` has a `terraform.tfstate` containing `GOOGLE_CLIENT_ID`,
   which is worth not repeating here.
7. **Publish the app** — Publishing status → *Publish*. Until you do, sign-in is capped at
   ~100 test users. Needs step 3's URLs live. Do this before launch, not on launch day.

---

## Step 0 — DNS: delegate `mimawsi.com` to Route 53 ⬅️ *do this first*

**Current state** (checked 2026-08-11): registered at **GoDaddy**, nameservers
`ns43/ns44.domaincontrol.com`, domain parked. Nothing else configured.

**Do this before SES or ACM**, because both want to write DNS records and one of them cannot
work at all on GoDaddy DNS.

### Why move DNS (you are *not* transferring the registration)

- **Apex ALIAS.** `mimawsi.com` must point at CloudFront, which gives you a hostname, not an
  IP — and DNS forbids a CNAME at the apex. Route 53's ALIAS record solves exactly this.
  GoDaddy DNS has no ALIAS/ANAME; its "Forwarding" feature is an HTTP redirect, not DNS. On
  GoDaddy you could only ever serve `www.mimawsi.com` properly. **This alone decides it.**
- SES can publish the DKIM records for you instead of you copying three CNAMEs by hand.
- ACM certificate validation becomes automatic.
- Your existing Terraform already uses `aws_route53_record`, so the DNS becomes code.

**Registration stays at GoDaddy.** You are only changing which nameservers answer for the
domain. Do not transfer the registrar — it is unnecessary and involves 60-day locks.

**Cost:** a Route 53 hosted zone is about **$0.50/month** plus fractions of a cent per million
queries. Not free, and the only recurring cost in the whole design. Worth naming honestly.

### Live values (created 2026-08-11)

| | |
|---|---|
| Hosted zone ID | `${ROUTE53_ZONE_ID}` |
| AWS account | `${AWS_ACCOUNT_ID}` |
| Nameservers | `${NS_1}` · `${NS_2}` · `${NS_3}` · `${NS_4}` |

The zone ID is what Terraform needs — reference the existing zone rather than creating a new
one, or the nameservers change and the GoDaddy delegation breaks.

### Steps

1. ~~**Route 53** → Create hosted zone → `mimawsi.com`, Public.~~ ✅ **Done 2026-08-11.**
2. ~~Copy the four NS values.~~ ✅ Recorded above.
3. **GoDaddy** → My Products → `mimawsi.com` → **DNS** → **Nameservers** → Change →
   *I'll use my own nameservers* → paste all four. Trailing dots are optional.
4. Wait. Usually 15–60 minutes; officially up to 48 hours.
5. **Verify:**
   ```
   dig +short NS mimawsi.com     # expect ns-*.awsdns-*.{com,net,org,co.uk}
   dig +short SOA mimawsi.com    # expect an awsdns nameserver
   ```
   Do not proceed until this returns AWS nameservers — until it does, every record you add in
   Route 53 is invisible to the world.
6. The GoDaddy parking page records disappear at this point. Expected.

Only once step 5 passes, continue to SES and ACM below.

---

## Domain checklist

- [x] `mimawsi.com` registered at GoDaddy ✅
- [ ] Route 53 hosted zone created and nameservers delegated (step 0)
- [ ] `www` and apex to CloudFront
- [ ] The runner subdomain to its distribution
- [ ] SES DKIM and SPF records
- [ ] ACM validation records

---

## GitHub

- [ ] **Public repository** — RULE-1. Actions minutes are unlimited only on public repos, and
      the entire pipeline depends on that
- [ ] Actions enabled
- [ ] Repository secrets: the AWS role ARN for OIDC, Google OAuth client ID and secret
- [ ] Branch protection on the default branch once more than one person commits

---

## What you do, by phase

| Before | You need |
|---|---|
| **task-1.3** | AWS account, region chosen, GitHub OIDC role |
| **task-2.3** | Runner domain decided and certificate issued |
| **task-3.4** | Google OAuth client ID and secret |
| **task-5.4** | SES out of sandbox ⏳ *request now* |
| **cp-5** | **Seed tools that actually work** |
| **cp-6** | Terms and privacy policy, legally reviewed |

---

## Stream C — content, and why it is the real critical path

No engineering task produces any of this, and cp-5 cannot pass without the first item.

- [ ] **Seed tools.** You and Claire building the first 10–20. The catalogue cannot launch
      empty, and this is the one thing no amount of building substitutes for
- [ ] **The promise, written for non-technical readers** — design inventory §6.1. One file,
      double-click, works offline forever, nothing leaves your computer, nobody installs
      anything. Appears in three places; write it once, properly
- [ ] **Nine rejection messages** with remedy and paste-able prompt — §6.2. Needed by task-5.5
- [ ] **Maker guidance plus a known-good example file** — §6.3
- [ ] **Report reasons** — §6.4
- [ ] **Terms and privacy policy.** The Terms must state that published tools remain in the
      catalogue after account deletion, since that is the one thing a maker might not expect

---

## Gotchas worth knowing now

1. **ACM must be us-east-1** for CloudFront while everything else is EU. Not a contradiction,
   just an AWS quirk that costs an afternoon if discovered late.
2. **SES sandbox** silently limits you to verified recipients. Everything will look like it
   works in development and fail for real makers.
3. **S3 bucket names are globally unique** — pick a naming convention before creating three.
4. **The runner needs its own domain**, decided before task-2.3, not retrofitted.
5. **Use OIDC, not access keys**, for GitHub to AWS. The scan job handles hostile input by
   design.
6. **Google OAuth caps unpublished apps at ~100 users.** Fine for testing, invisible until
   launch day if you forget to publish.

---

## Provisioned infrastructure — live values

Created 2026-08-22 via CLI as a smoke test of the full path. **These are real resources.**

| Thing | Value |
|---|---|
| AWS account | `${AWS_ACCOUNT_ID}` |
| Deploy identity | IAM user `mimawsi-deploy`, local profile `mimawsi` |
| Route 53 zone | `${ROUTE53_ZONE_ID}` |
| Site bucket | `${SITE_BUCKET}` (eu-north-1, **public access blocked**) |
| ACM certificate | `${ACM_CERT_ARN}` (us-east-1, ISSUED) |
| CloudFront distribution | `${CLOUDFRONT_DIST_ID}` → `${CLOUDFRONT_DOMAIN}` |
| Origin Access Control | `${CLOUDFRONT_OAC_ID}` |
| Aliases | `mimawsi.com`, `www.mimawsi.com` (A + AAAA) |
| Status | ✅ **VERIFIED LIVE** 2026-08-22 — `https://www.mimawsi.com` served over HTTPS with CSP intact, confirmed from an unfiltered network |
| Price class | `PriceClass_100` (US/EU edges — cheapest) |

Bucket policy grants `s3:GetObject` **only** to CloudFront, conditioned on the distribution
ARN. The bucket is never publicly readable, satisfying RULE-2.

### ⚠️ This was built by CLI, not Terraform

rules.md defers the IaC tooling choice to the planning step, so these resources exist outside
any state file. At task-1.3 they must either be **imported** into Terraform or torn down and
recreated. Importing is strongly preferred for two of them:

- **The Route 53 zone** — recreating changes the nameservers and breaks the GoDaddy delegation.
- **The ACM certificate and CloudFront distribution** — recreation means a new distribution
  domain and a fresh 15-minute deploy each time.

### Runner origin still undecided

RULE-23 requires tools execute on a **separate origin**. The certificate covers only
`mimawsi.com` and `www.mimawsi.com`, so a runner subdomain needs either a new certificate or a
replacement covering `runner.mimawsi.com` too. **Decide before task-2.3.**

### ⚠️ Local network intercepts TLS — you cannot verify from this machine

A **FortiGate appliance** (`CN=FGT80FTK23015803`, `O=Fortinet`) MITMs HTTPS on this network.
Requests to `mimawsi.com` are served a Fortinet-issued certificate and return `403` with no
`Server: CloudFront` header — the appliance answering, not CloudFront. Newly registered domains
are commonly blocked as "uncategorised" until classified.

**Consequences:**
- Any TLS or HTTP check run from this machine tests the proxy, not the site. Verify from
  **mobile data** or another network before believing a failure is real.
- This will recur throughout the build. When something looks broken, check for
  `Server: CloudFront` / `X-Amz-Cf-Pop` headers first — their absence means the request never
  left the building.
- If the block persists, submit `mimawsi.com` to Fortinet's URL categorisation service, or add
  a local allow rule.
