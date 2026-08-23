# Terraform

## State

In S3, encrypted and versioned, **never in the repository**. A previous project
committed a `terraform.tfstate` containing a `GOOGLE_CLIENT_ID`; this repository
is public, so the same mistake here would be considerably worse. `terraform.tfvars`
is gitignored for the same reason — real account ids and bucket names are inputs,
not literals.

**Known gap: there is no state lock.** Locking on Terraform 1.5.7 needs a DynamoDB
table, and the deploy identity cannot reach DynamoDB. One operator makes the window
small, but two concurrent applies could corrupt state. Fixed either by granting
DynamoDB access, or by moving to a version with S3-native locking — see the
licensing note below.

## What is adopted, and what is not

Adopted (imported from resources built by hand, `plan` reports no changes):

- the site bucket
- the catalogue CloudFront distribution
- the runner CloudFront distribution
- the origin access control both read the bucket through
- the runner response headers policy

**Not yet adopted**, because Terraform's identity cannot read IAM (`iam:GetRole`
is denied): the GitHub OIDC provider and the `mimawsi-github-deploy` role. They are
real and in use — see `infra/github-oidc` — and should be imported as soon as
Terraform has an identity that can read them.

**Not yet built** (task-1.3 proper): the pending and published buckets, and the
DynamoDB tables for accounts, submissions, reports and bans. Blocked on the same
permission gap: the deploy identity cannot touch DynamoDB, Lambda or SES.

## Importing rather than recreating

Recreating is not an option for two of these. A new Route 53 zone changes the
nameservers and breaks the GoDaddy delegation; a new distribution means a new
domain and a fresh propagation. `import` blocks with `-generate-config-out`
produced the configuration from the live resources, so `plan` reflects what is
actually deployed rather than a guess at it.

## Two decisions still open

1. **Terraform 1.5.7 is the last MPL-licensed release.** Later versions are BUSL.
   Staying here costs S3-native state locking; OpenTofu is the MPL fork and has it.
2. **Which identity runs Terraform.** The current deploy user cannot manage
   DynamoDB, Lambda, SES or read IAM, so it cannot complete task-1.3.
