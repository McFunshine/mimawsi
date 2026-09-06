# Granting the deploy identity what the spend alarm needs

`terraform/billing.tf` is written and validates but cannot apply: `mimawsi-deploy`
holds none of the permissions it needs. All three were probed directly on
2026-09-06 and all three returned AccessDenied.

The policy to paste is `iam-billing-alarm.json`, beside this file. It is bare
policy JSON with no comments, because IAM rejects any key it does not recognise —
including a `_comment` one, which is how the first version of this file would have
failed.

## Do it as a new inline policy, not by editing the existing one

Adding a separate policy rather than editing what is there:

- cannot break the permissions the deploy already depends on;
- avoids the managed-policy version trap entirely — editing a managed policy
  creates a new version, and an edit saved without ticking **"Set this new version
  as the default"** appears to succeed and changes nothing. This project has lost
  an afternoon to that once already;
- is removable in one click if it turns out to be wrong.

## Steps

Sign in as an identity that can edit IAM. **Not** `mimawsi-deploy` — it cannot
edit its own permissions, which is deliberate.

1. IAM → **Users** → `mimawsi-deploy`
2. **Permissions** tab → **Add permissions** → **Create inline policy**
3. Choose the **JSON** tab
4. Replace everything in the box with the contents of `iam-billing-alarm.json`
5. **Next** → name it `mimawsi-billing-alarm` → **Create policy**

## If you have already added it once

Three actions were found missing only when the alarms were actually applied, so
a policy created before 2026-09-06 15:00 needs replacing with the current file:
`sns:GetSubscriptionAttributes`, `sns:SetSubscriptionAttributes` and
`sns:Unsubscribe` — Terraform reads a subscription back after creating it — plus
`cloudwatch:ListMetrics`, which AWS does not allow to be scoped to a resource and
so has a statement of its own.

Edit the inline policy `mimawsi-billing-alarm` and paste the file again. An inline
policy has no versions, so there is nothing to set as default.

## Then, in Billing

Both of these are console-only. Terraform can do neither, and without the first
the alarm is decoration.

6. Billing and Cost Management → **Billing Preferences** → tick **Receive Billing
   Alerts**. Until this is on, AWS never publishes `AWS/Billing EstimatedCharges`
   at all, and the alarm sits in INSUFFICIENT_DATA — which on a dashboard looks a
   great deal like healthy.
7. Billing and Cost Management → **Cost allocation tags** → find `project` →
   **Activate**. Roughly 24 hours before it appears in reports. This is what turns
   the tagging into per-project figures.

Steps 6 and 7 may need the account root or an identity with billing access.

## Then say so

`billing_alert_email` goes into `terraform.tfvars` and the alarms apply. SNS then
sends a confirmation email that **must be clicked** — an unconfirmed subscription
reports no error anywhere and simply never delivers.

## What this does and does not buy

The alarm is **account-wide**. `AWS/Billing EstimatedCharges` carries no tag
dimension — only Currency, ServiceName and LinkedAccount — so it measures this
account's whole spend, mimawsi alongside spencerpj.com and theideathing.com. It
answers "is something running away", not "which project".

Per-project *alerting* needs a Budget filtered on the `project` tag, and budgets
need `budgets:*`, which is deliberately not in this grant. Per-project *reporting*
arrives with step 7 and needs nothing further.
