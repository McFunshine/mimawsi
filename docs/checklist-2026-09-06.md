# What is left, in the order I would do it

Written 2026-09-06, after the approval page went live and the first tool was
published through it. Every claim about current state below was checked against
the account or the repository, not recalled.

Ordered by what happens if it is left undone, not by effort.

---

## 1. Spend alarm — nothing else has unbounded downside

The only gap where the worst case has no ceiling. There are currently **zero**
CloudWatch alarms and no budget.

- [ ] **Enable billing alerts in the console.** Billing → Billing Preferences →
      "Receive Billing Alerts". Without this AWS never publishes the metric and
      the alarm sits in `INSUFFICIENT_DATA` forever, looking healthy.
      **Only the account root or a billing-permitted identity can do this.**
- [ ] SNS topic + email subscription. **You must click the confirmation email**;
      an unconfirmed subscription is silently never delivered to.
- [ ] `AWS/Billing` `EstimatedCharges` alarm.

**The gotcha:** billing metrics exist **only in us-east-1**, whatever region the
account works in. Same shape as the ACM rule, same silent failure — an alarm
built in Stockholm never fires because the metric is not there. The
`aws.us_east_1` provider alias already exists for the certificate.

**Correction to the handover.** It says `mimawsi-terraform` "has CloudWatch and
SNS but not Budgets", so a metric alarm is buildable and a budget is not. That is
wrong. Probed directly on 2026-09-06, `mimawsi-deploy` has **none** of the three:
`cloudwatch:PutMetricAlarm`, `sns:CreateTopic` and `budgets:ViewBudget` all
return AccessDenied. So the alarm needs an IAM edit too.

`terraform/billing.tf` is written and validates. It is disabled by default and
will apply the moment the grant in `docs/iam-billing-alarm.json` is added and
`billing_alert_email` is set — two statements, scoped to `mimawsi-*`, no wildcard.

A budget would still be better, because it forecasts rather than reacting to
money already spent. It is a larger grant, and the alarm closes the unbounded
downside today.

---

## 2. Dispatch token — completes work already deployed

The code is live with an empty token, which safely disables it. Every approval
currently needs the manual catch-up that was run by hand for Caption tool.

- [ ] Fine-grained PAT: **Only select repositories** → `McFunshine/mimawsi` and
      `McFunshine/mimawsi_external` → **Contents: Read and write**.
- [ ] `github_dispatch_token` in `terraform/terraform.tfvars`, then apply.
- [ ] Approve something and watch both repositories move on their own.

Nothing is wrong with either repository. The Lambda simply holds no credential.

---

## 3. Pending bucket is not versioned

It holds every submission and the index that describes them. An overwrite is
unrecoverable, which is why editing it today meant taking two backups by hand
first. A control that depends on remembering to take a backup is not a control.

- [ ] Enable versioning on `mimawsi-pending-*`.
- [ ] Lifecycle rule expiring noncurrent versions after ~90 days, so it does not
      grow without bound.

---

## 4. Identity for system-generated tools

Coming from the innovation work in §7: the platform will generate tools of its
own, derived from a submission that has already been approved. Those are not
external submissions and should not sit in a human's approval queue.

The operator token is the wrong instrument. It exists so scripts can authenticate
without Google, it is a shared secret in an environment variable, and it already
caused a real confusion — an upload authenticated as `operator` with no address,
producing a warning that read like a fault.

- [ ] A distinct maker identity, e.g. `system`, that is **not** a bearer token.
      The generator runs inside our own infrastructure and can be trusted by
      where it runs rather than by a string it presents.
- [ ] `Submission.origin`: `'submitted' | 'generated'`, and a `derivedFrom`
      pointing at the tool it came from. Provenance belongs in the record, not
      inferred from who the maker happens to be.
- [ ] Generated tools skip the queue but still pass the scanner, the policy
      injection and the record. Skipping review is a decision about *who wrote
      it*, never about whether it is checked.
- [ ] Then remove the operator token from the submit path (handover gap #6). Keep
      it for the publish CLI, which is a separate path and must survive Google
      being unreachable.

---

## 5. Rate limit — 20 per account per day

`DAILY_SUBMISSION_LIMIT = 5` exists in the domain and is enforced **nowhere**
(checked: the constant has exactly one reference, its own declaration).

- [ ] Raise to 20.
- [ ] Enforce it in `submit()`, so the rule lives with the other submission rules
      rather than in a handler.
- [ ] Count from the store's own records — no new table.
- [ ] Generated tools (§4) must not count against a human's allowance.

---

## 6. MIT licence, and the smaller honesty gaps

- [ ] `LICENSE` (MIT) on `mimawsi_external`.
- [ ] `LICENSE` (MIT) on the site repository.
- [ ] `README.md` on the site repository — the record repository has one, the
      site repository has none.
- [ ] A missing page returns raw S3 `AccessDenied` XML (checked: `/nope` → 403).
      Should be a 404 page.
- [ ] `spec.md:151` lists automated rewriting as a non-goal while §7 intends it.
      Run `/01-spec` before building it.
- [ ] RULE-1 and RULE-17a need the amendments described in the handover.

---

## 7. Idea generation and rewriting

The largest piece, and the one with the most ways to go quietly wrong. Not to be
started before the spec above is corrected.

**Shape it behind a port from the first line.** The intent is to try Grok because
it is said to be good and cheap, with the option to swap. That option only exists
if nothing outside one adapter ever knows which model is being used — the same
discipline that lets storage be a directory in tests and S3 in production.

- [ ] `GeneratorPort` in `packages/ports`: takes a tool and a brief, returns
      candidate tools. Knows nothing about any vendor.
- [ ] `packages/adapters-xai` implementing it. Model id and endpoint are config,
      never constants, so a swap is a variable and not a rewrite.
- [ ] A fake adapter, so the pipeline is testable with no network and no spend.
- [ ] Prompts held as files, versioned, and **treated as code**: a changed prompt
      is a changed program and belongs in a commit with a reason.
- [ ] Every generated tool goes through the existing gates — the scanner, the
      policy injection, the record. A generated tool is not a trusted tool.
- [ ] Generated tools must pass the record repository's checks *before* being
      published, not after. Today the checks run on what is already live.
- [ ] A spend ceiling on generation, and a per-run cap on how many tools one
      submission may produce. §1 is the account-wide net; this is the specific one.
- [ ] Decide what a generated tool says about itself on the site. A visitor
      should be able to tell a person's work from the platform's without reading
      the repository.

**On model choice:** the port makes this cheap to revisit, which is the point.
Worth benchmarking against Claude and whatever else is current at the time on the
one axis that matters here — how often the output passes the scanner and the
checks unedited — rather than on price alone. A cheaper model that fails the
checks twice as often is not cheaper.

---

## Not on this list, deliberately

**Nothing scans a submission before a human sees it.** The scanner in the record
repository runs on tools *already published*. This is real, and it is not here
because §7 forces the issue: the moment the platform generates tools, "a human
reads every one" stops being a plan. It should be solved as part of §7 rather
than twice.
