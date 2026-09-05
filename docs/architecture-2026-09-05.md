# Architecture, as at 2026-09-05

A snapshot, not a specification. It describes what exists on this date and why,
including the parts that are wrong and known to be wrong. `docs/architecture.md`
describes the intended design; where the two disagree, this one is what is
actually deployed.

Written because the system stopped fitting in one person's head: two
repositories, three buckets, two CloudFront distributions, a Lambda, and a
publishing path that crosses all of them.

---

## The shape of it

```
                          ┌──────────────────────────┐
  a maker's browser ─────▶│  www.mimawsi.com         │  catalogue, static
                          │  CloudFront E3D7OMES…    │  ← S3 site bucket (root)
                          └──────────────────────────┘
                                     │ /share
                                     ▼
                          ┌──────────────────────────┐
                          │  Lambda Function URL     │  mimawsi-submit
                          │  Google ID token or      │
                          │  operator token          │
                          └──────────────────────────┘
                                     │ writes
                                     ▼
                    s3://mimawsi-pending/  pending/<id>.html
                                           index.json        ← the store
                                     │
                    [ operator runs `npm run publish` ]
                                     │
                    ┌────────────────┼─────────────────────┐
                    ▼                ▼                     ▼
        published/<id>.html    site bucket           published.json
        (in the store)         tools/<id>.html       (in git) → CI → deploy
                                     │
                                     ▼
                          ┌──────────────────────────┐
  a runner iframe ───────▶│  d202poqh1o8myi…         │  tools only
                          │  CloudFront E2X56NE5…    │  ← S3 site bucket (/tools)
                          └──────────────────────────┘
```

## Why two distributions in front of one bucket

This looks redundant and is the most important decision in the system.

A published tool is a stranger's JavaScript. If it were served from the same
origin as the catalogue, it could read the catalogue's pages, storage and any
session in them. Serving it from a second, unrelated hostname makes the browser
treat it as a foreign site, and the same-origin policy does the rest.

The `/run/<id>` page embeds the tool from that other origin in an iframe with
`sandbox="allow-scripts allow-downloads"` — deliberately **without**
`allow-same-origin`, which would hand back everything the sandbox exists to deny.

## Four layers of containment

A published tool is contained four times over, and each layer works if the others
fail.

| layer | what it stops |
|---|---|
| Separate origin | reading the catalogue's pages or storage |
| `sandbox` without `allow-same-origin` | the frame having any origin at all |
| CSP injected **into the file** | any network access: `default-src 'none'` |
| CSP repeated as a response header, plus `frame-ancestors` | who may embed it |

The third layer is the one that matters most, because it travels. The policy is
inside the HTML, so a downloaded tool behaves identically offline — which is the
promise the site makes, and the reason the policy is injected at publish rather
than applied at the edge.

## Storage

Three buckets, all private. None is publicly readable; CloudFront reads the site
bucket through an Origin Access Control, and nothing reads the others.

| bucket | holds | versioned | expiry |
|---|---|---|---|
| `mimawsi-site-<acct>` | the built catalogue, and `tools/` | no | none |
| `mimawsi-pending-<acct>` | submissions, published copies, `index.json` | **no** | `pending/` after 90 days |
| `mimawsi-admin-<acct>` | `approvers.json`, backups | yes | none |

`index.json` in the pending bucket **is the database.** There is no DynamoDB in
the running system: four tables exist from an earlier phase and nothing reads
them. A bucket does one write per upload and one small list per review, which is
what this actually needs.

Writes to the index use a conditional `PutObject` (`If-Match` on the ETag), so
two concurrent uploads cannot lose each other. Measured, not assumed: without it,
four of five concurrent submissions vanished.

**The pending bucket is not versioned.** It holds every submission and the index,
and a bad write is unrecoverable. This is a known gap.

## Identity

Two mechanisms, both presented as `Authorization: Bearer`:

- **Google ID token.** The browser signs in with Google Identity Services and
  receives a signed JWT. The Lambda verifies the signature against Google's
  published keys, pins `RS256`, and checks issuer, expiry and — the one that is
  easy to omit — **audience against our own client id**. Without that check a
  token minted for any other site on the internet would verify perfectly.
- **Operator token.** A shared secret in the Lambda's environment. It is how a
  script authenticates without a browser and the way back in if Google is
  unreachable.

Identity is the Google `sub`, never the email: Google's own guidance is that an
address can change hands. The `sub` is stored in `maker.value` in `index.json`,
alongside `makerEmail` for sending a rejection.

## Two repositories

| | |
|---|---|
| `McFunshine/mimawsi` | the site, the Lambda, the infrastructure. Public. |
| `McFunshine/mimawsi_external` | every published tool, one folder each. Public. |

The second exists so nobody has to take the site's word for anything: the bytes
are there, the checks they passed are beside them, and `tool.html` is
byte-identical to what the site serves, so anyone can hash both and compare.

Its checks run on every push and are discovered from the directory rather than
registered, so a tool cannot be added without being checked. They cover
credentials, personal data, network access, the policy, the recorded hash, and
whether a review note exists. They fail hard and have no allowlist.

**Only the reviewed file is ever committed, never the original.** A submission
carrying an API key would publish that key permanently; git history is not
something a later commit undoes.

## Publishing

`npm run publish -- --latest` reads the bucket names from Terraform state,
approves the newest submission, injects the policy, writes the bytes to the
store and to the serving bucket, invalidates the CDN, updates `published.json`,
commits and pushes. CI then rebuilds.

It refuses to run on a dirty tree, and refuses if the approve touched anything
but the catalogue index.

CI skips the browser suite when `published.json` is the only changed file —
publishing changes no code, so those 86 seconds proved that code nobody edited
still worked. The check is narrow: any other path means a full run.

The deploy uses **two** syncs. Everything but `tools/` mirrors with `--delete`;
`tools/` syncs without it. A single `sync --delete` treated the published tool
bytes as files that should not exist — because they are gitignored and therefore
absent from the build — and deleted every one of them on every deploy.

## Costs

About **fifty pence a month** at idle, which is two Route53 hosted zones. S3
storage is pennies, DynamoDB is pay-per-request and unused, CloudFront's first
terabyte is permanently free, and the Lambda has no provisioned concurrency —
the setting that would bill at rest.

Nothing here has a floor that ordinary use would breach. The exception, when it
arrives, is LLM calls in the improvement pipeline: no free tier, and cost that
scales linearly with popularity.

## What is deliberately not built

- **No approval page.** Approving is a command on the operator's laptop. A page
  that can publish arbitrary HTML to the site is the highest-value target in the
  system, and a laptop with AWS credentials is a stronger boundary than a token
  in `sessionStorage`. This is the next thing to build.
- **No scanning of submissions.** The checks in `mimawsi_external` run on tools
  already published. Nothing inspects a submission before a human does.
- **No rejection path.** `reject` exists in the CLI and emails nobody.
- **No rate limiting.** One authenticated account can submit without bound.
- **No billing alarm.** Overdue since the site went public.

## Known wrong

- `mimawsi_external` holds three tools; the site serves eight. The repository has
  been out of date since the day it was created, which undermines the one claim
  it exists to make.
- The pending bucket is not versioned.
- `spec.md:151` still lists automated rewriting as a non-goal, and phases 4–5 are
  written against reject-and-resubmit. The product intent changed and the spec
  did not.
- RULE-1 requires a public repository for Actions minutes. The plan is to take
  the site repository private, which the rule as written forbids.
- RULE-17a is narrower than it has been treated as: it governs the pipeline that
  processes hostile input, not deployment. Both need amending.
