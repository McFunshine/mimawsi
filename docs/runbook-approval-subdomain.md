# Runbook — bringing up `approval.mimawsi.com`

Written 2026-09-05. Every fact below was verified against the live account, not
recalled: zone delegation by `dig`, certificate inventory by `aws acm`, and the
deploy user's ACM permission by a deliberately-invalid request that came back
`ValidationException` rather than `AccessDenied`.

## The one thing to understand before starting

**You cannot finish this today unless the admin Lambda exists.** A CloudFront
distribution must be created with an origin, and the origin for this subdomain is
the admin Lambda's Function URL, which is still to be built.

That is not a reason to wait, because the work splits cleanly:

- **Part A (do now, ~10 min of waiting):** request the certificate and validate
  it. This is the slow, order-dependent part and it blocks nothing else.
- **Part B (after the admin Lambda exists):** distribution, DNS record, page.

Doing Part A now means that when the Lambda is ready, Part B is fifteen minutes
rather than an hour of waiting on DNS propagation.

## Verified starting state

| Thing | Value |
|---|---|
| Authoritative zone | `Z08048752S76S8K5PMR7I` — its NS set matches public DNS |
| Orphan zone, do not touch | `Z08060842IN4BXO82HL29` — different NS, nothing delegates to it |
| Existing certificate | `a3418cde-…` in us-east-1, covers `mimawsi.com` + `www` **only** |
| Wildcard available? | **No.** There is no `*.mimawsi.com` certificate |
| `approval.mimawsi.com` | Does not resolve |
| Deploy identity | IAM user `mimawsi-deploy`, has `acm:RequestCertificate` |
| Provider alias | `aws.us_east_1` already declared in `terraform/versions.tf`, unused so far |

Note that Route53 and ACM are **not** in Terraform at all. The site
distribution is, with the certificate ARN hardcoded as a string
(`generated.tf:161`). This runbook follows that existing pattern rather than
changing it mid-task.

---

## Part A — the certificate — **DONE 2026-09-05**

Ran from the CLI; it took about ninety seconds end to end.

| | |
|---|---|
| Certificate | `arn:aws:acm:us-east-1:418272759693:certificate/575e7fd9-0499-4ea5-a415-7d992a32b982` |
| Status | `ISSUED`, expires 2027-03-22 |
| Validation CNAME | `_9a601b5c198093ce28713681b6aaf4fe.approval.mimawsi.com` → `_1dec71b390efcf5ed04ee71a1318079b.jkddzztszm.acm-validations.aws` |
| Written to zone | `Z08048752S76S8K5PMR7I` (the live one) |

`RenewalEligibility` reads `INELIGIBLE`. That is expected and not a problem: ACM
reports that for any certificate not yet attached to a supported resource. It
flips to `ELIGIBLE` once the distribution in Part B uses it.

**Leave the validation CNAME in place.** ACM re-reads it to renew.

The steps below are kept as the record of what was run.

### A1. Request it, in us-east-1

The region is not a preference. CloudFront reads certificates from us-east-1 and
nowhere else, and the failure is silent: the distribution simply will not offer
a certificate you created in Stockholm.

```sh
export AWS_PROFILE=mimawsi

aws acm request-certificate \
  --region us-east-1 \
  --domain-name approval.mimawsi.com \
  --validation-method DNS \
  --key-algorithm RSA_2048 \
  --tags Key=project,Value=mimawsi
```

It prints the ARN. Keep it.

A separate certificate rather than adding a SAN to the existing one: adding a
name to an issued certificate is not possible in ACM — you request a replacement
covering all three names and re-point the site distribution at it. That is a
change to the thing currently serving the live site, to gain nothing.

### A2. Read the validation record ACM wants

```sh
CERT=<the arn from A1>

aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

Gives a `Name`, `Type: CNAME`, and `Value`.

### A3. Put that record in the **live** zone

This is where the afternoon gets lost. Zone `Z08048752S76S8K5PMR7I`. Writing it
to the orphan produces a certificate that never validates and no error anywhere
that says why.

```sh
cat > /tmp/validation.json <<'JSON'
{
  "Comment": "ACM validation for approval.mimawsi.com",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "<Name from A2>",
      "Type": "CNAME",
      "TTL": 300,
      "ResourceRecords": [{ "Value": "<Value from A2>" }]
    }
  }]
}
JSON

aws route53 change-resource-record-sets \
  --hosted-zone-id Z08048752S76S8K5PMR7I \
  --change-batch file:///tmp/validation.json
```

`UPSERT` rather than `CREATE` so a re-run is not an error.

### A4. Wait for issue

```sh
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT"
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT" \
  --query 'Certificate.Status'
```

Usually a few minutes. `ISSUED` and Part A is done. The certificate costs
nothing and can sit unused indefinitely.

**Do not delete the validation CNAME afterwards.** ACM re-checks it to renew.
Removing it breaks renewal roughly thirteen months later, which is the least
debuggable outage available to you.

---

## Part B — after the admin Lambda exists

### B0. Google console — **DONE 2026-09-05**

`https://approval.mimawsi.com` added to Authorized JavaScript origins on client
`708712241310-3u6rjq51258ufm5ftuehiogcg2k49dnj` ("mimawsi web"), joining apex,
www and `http://localhost:4321`. Redirect URIs remain empty, which is correct for
this flow. Allow up to a few hours to take effect; an `origin_mismatch` shortly
after saving is propagation, not misconfiguration.

The client secret on that client is unused and should stay that way — the design
verifies the ID token server-side and keeps no session.

The original instructions follow, as the record.



Sign-in uses Google Identity Services in the credential/popup flow
(`google.accounts.id.initialize` + `renderButton`, `share.astro:221`). There are
no redirects, so redirect URIs are irrelevant. What is required:

**APIs & Services → Credentials → the OAuth 2.0 Client ID → Authorized
JavaScript origins → add `https://approval.mimawsi.com`.**

Origins are matched as exact strings. `mimawsi.com` being listed does not cover
a subdomain, which is the opposite of how the consent screen's *Authorized
domains* list behaves — that one does cover subdomains and needs no change.

Reuse the **same** client ID. The ID token's `aud` then stays what
`google-identity.ts` already verifies; a second client ID would mean a second
audience to accept, for nothing.

The admin page also needs its own Content-Security-Policy allowing
`https://accounts.google.com` in `script-src`, `connect-src` and `frame-src`.
The tool policy is `default-src 'none'` and would block sign-in outright — it is
the policy for *published tools*, not for platform pages.

### B1. Distribution

Add to Terraform rather than the console, following `aws_cloudfront_distribution.site`:

- **Alias:** `approval.mimawsi.com`
- **Certificate:** the Part A ARN, `ssl_support_method = "sni-only"`,
  `minimum_protocol_version = "TLSv1.2_2021"`
- **Origin:** the admin Lambda Function URL host, `custom_origin_config` with
  `origin_protocol_policy = "https-only"` — a Function URL is not an S3 origin
  and does not take an origin access control the way the site bucket does
- **Cache:** disabled. `CachingDisabled` (`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`).
  Caching an approval queue serves one operator another operator's stale view
- **Forward:** the `Authorization` header must reach the Lambda, or every
  request arrives unauthenticated. Use `AllViewerExceptHostHeader`
  (`b689b0a8-53d0-40ab-baf2-68738e2966ac`); plain `AllViewer` sends CloudFront's
  Host and the Function URL rejects it
- **Methods:** `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE` — approve and deny
  are not GETs

Expect 5–15 minutes to deploy.

### B2. DNS

An **A record, alias** — not a CNAME. Alias records are free to query and work
at an apex; more to the point it is what the other two records in this zone are,
and matching them keeps the zone readable.

```sh
cat > /tmp/approval.json <<'JSON'
{
  "Comment": "approval.mimawsi.com -> admin distribution",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "approval.mimawsi.com",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "Z2FDTNDATAQYW2",
        "DNSName": "<dxxxx>.cloudfront.net",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
JSON

aws route53 change-resource-record-sets \
  --hosted-zone-id Z08048752S76S8K5PMR7I \
  --change-batch file:///tmp/approval.json
```

`Z2FDTNDATAQYW2` is CloudFront's fixed zone id — the same constant for every
distribution in every account, not something to look up. Add an `AAAA` alias
identically if you want IPv6, as apex and www both have.

### B3. Check it

```sh
dig +short approval.mimawsi.com @8.8.8.8
curl -sI https://approval.mimawsi.com/health
```

A 403 on every route including `/health` is the two-permission Function URL trap
in `HANDOFF.md`, not a DNS problem.

---

## What this does and does not buy

The subdomain is **origin isolation, not secrecy** — it will be in certificate
transparency logs within minutes of Part A regardless of what you do. Anyone can
find it. The value is that a published tool, running on the runner origin, has no
same-origin path to admin storage. Authorisation is still the server-side
`ApproverList` check on every request, matched on Google `sub`.
