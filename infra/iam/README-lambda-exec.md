# `mimawsi-lambda-exec`

The execution role for the upload Lambda. **Created by hand in the console**, then
adopted by Terraform (`data "aws_iam_role"` in `terraform/lambda.tf`).

Created by hand because the Terraform identity holds no `iam:CreateRole`, and that
is deliberate rather than an oversight: an identity that can create a role *and*
pass it to Lambda can grant itself administrator, so read-only IAM is what closes
that escalation path. Widening the policy to make this one role convenient would
reopen it permanently, for a role that is created once and then never changes.

Replace `ACCOUNT_ID` in the policy with the real account id. It is a placeholder
because this repository is public.

## What it can do, and what it deliberately cannot

- **Read and write** objects in the pending bucket. That is the whole store: the
  submitted bytes, the published bytes, and `index.json`.
- **Never delete.** An explicit Deny, not merely an omitted Allow, because a Deny
  cannot be overridden by any policy added later. The upload path has no reason to
  remove anything, and a bug or an injection that reaches S3 with these credentials
  should not be able to empty the store. Expiry is the bucket's lifecycle rule,
  which is not this role's business.
- **Write its own log streams**, and not create log groups — Terraform creates the
  group with a retention period, so the function cannot make one that never expires.
- **No DynamoDB, no other bucket, no SES.** It needs none of them.
