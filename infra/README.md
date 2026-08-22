# Infrastructure records

What is deployed, as configuration rather than as memory of a console session.
These are **templates**: real account ids, bucket names and distribution ids are
substituted in, never committed, because this repository is public (RULE-1).
The live values are in the operator's notes.

| Placeholder | What it is |
|---|---|
| `ACCOUNT_ID` | AWS account |
| `SITE_BUCKET` | private bucket holding the built catalogue and the published tools |
| `SITE_DISTRIBUTION_ID` | CloudFront distribution for `mimawsi.com` |
| `RUNNER_DISTRIBUTION_ID` | CloudFront distribution for the runner origin |
| `ORIGIN_ACCESS_CONTROL_ID` | OAC both distributions read the bucket through |
| `RUNNER_RESPONSE_HEADERS_POLICY_ID` | response headers policy applied to the runner |

## Why there are two distributions

Tools execute on a **distinct origin** from the catalogue (RULE-23). The runner
distribution deliberately has no custom domain: its `*.cloudfront.net` name is
already a separate origin, so it needs no certificate, which is what let the
runner ship before the `runner.mimawsi.com` certificate question is settled.

Both read the same private bucket through Origin Access Control — the catalogue
at the root, the runner with an origin path of `/tools`. The bucket itself is
never publicly readable (RULE-2).

## These were built by CLI, not by IaC

So was everything before them. task-1.3 imports the lot into Terraform; these
files exist so that is a mechanical job rather than an archaeological one.
Nothing here should be edited by hand in the console without updating the file.
