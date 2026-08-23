# IAM policies

The JSON files here are **paste-ready**: IAM rejects unknown keys, so the
reasoning lives in this file rather than inside the documents. Substitute
`ACCOUNT_ID` before use; real identifiers are never committed, because this
repository is public.

## mimawsi-terraform-policy.json

Permissions the LOCAL identity needs to run Terraform for task-1.3 and the phases after it. This is the infrastructure identity, not the CI deploy role: RULE-17a keeps GitHub Actions away from DynamoDB and the published prefix, and nothing here is attached to that role. Scoped by mimawsi-* name prefix so a mistake cannot reach the other projects in this account. IAM is read-only on purpose: Terraform needs to read the OIDC role in order to adopt it, never to create roles.

### Why it stops where it does

- **Scoped to `mimawsi-*`.** This account also carries podmorph, avatardata,
  impactr and spencerpj. A mistake in a Terraform run should not be able to reach
  them. `ListTables` and `ListFunctions` cannot be name-scoped by AWS, so they
  stay `*`; listing discloses names and nothing else.
- **IAM is read-only.** Terraform must read `mimawsi-github-deploy` to adopt it.
  Write access would let a Terraform run rewrite the trust policy that is the
  whole CI security boundary, so changing it stays a deliberate console action.
- **PassRole is limited to Lambda**, and only for `mimawsi-*` roles. Unscoped
  PassRole is a privilege-escalation route: it lets the holder hand any role to
  any service.

## Attaching it

IAM > Policies > Create policy > JSON, paste, name it `mimawsi-terraform`.
Then IAM > Users > `mimawsi-deploy` > Add permissions > Attach policies directly.

Requires an admin identity: `mimawsi-deploy` cannot grant itself permissions.
