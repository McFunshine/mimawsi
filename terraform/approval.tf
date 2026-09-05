# The approval subdomain: approval.mimawsi.com
#
# A third distribution and a second Lambda, both deliberate. The submit endpoint
# is public and unauthenticated at the platform level; it must never hold the
# ability to publish to the site, which is why this runs on its own role.
#
# The subdomain is origin isolation, not secrecy. It appears in certificate
# transparency logs within minutes of the certificate being issued, so anyone can
# find it. The value is that a published tool, running on the runner origin, has
# no same-origin path to admin storage.

variable "approval_domain" {
  description = "Hostname for the approval page. Must match a name on the certificate below."
  type        = string
  default     = "approval.mimawsi.com"
}

variable "approval_certificate_arn" {
  description = <<-TEXT
    ACM certificate for the approval hostname. Must be in us-east-1: CloudFront
    reads certificates from that region and no other, and the failure is silent —
    the distribution simply does not offer a certificate created elsewhere.

    Requested and DNS-validated on 2026-09-05; the validation CNAME lives in the
    live zone below and must not be deleted, because ACM re-reads it to renew.
  TEXT
  type        = string
  default     = "arn:aws:acm:us-east-1:418272759693:certificate/575e7fd9-0499-4ea5-a415-7d992a32b982"
}

variable "hosted_zone_id" {
  description = <<-TEXT
    The live mimawsi.com zone. There are two: this one carries the delegation the
    registrar actually points at, confirmed by its NS set matching public DNS.
    The other, Z08060842IN4BXO82HL29, is an orphan nothing resolves through, and
    writing to it produces changes that never take effect and say nothing about
    why.
  TEXT
  type        = string
  default     = "Z08048752S76S8K5PMR7I"
}

variable "admin_role_name" {
  description = "Execution role for the approval Lambda. Created by hand, like the other — the Terraform identity holds no iam:CreateRole."
  type        = string
  default     = "mimawsi-admin-exec"
}

data "aws_iam_role" "admin_exec" {
  name = var.admin_role_name
}

data "archive_file" "admin" {
  type        = "zip"
  source_file = "${path.module}/../packages/lambdas/dist/admin.mjs"
  output_path = "${path.module}/.terraform/admin.zip"
}

resource "aws_lambda_function" "admin" {
  function_name = "mimawsi-admin"
  role          = data.aws_iam_role.admin_exec.arn
  runtime       = "nodejs22.x"
  handler       = "admin.handler"

  filename         = data.archive_file.admin.output_path
  source_code_hash = data.archive_file.admin.output_base64sha256

  memory_size = 512

  # Longer than the submit endpoint's 15s. Approving does more: it reads the
  # submitted bytes, injects the policy, writes to two buckets and raises a
  # CloudFront invalidation.
  timeout = 30

  environment {
    variables = {
      MIMAWSI_BUCKET              = aws_s3_bucket.pending.id
      MIMAWSI_ADMIN_BUCKET        = aws_s3_bucket.admin.id
      MIMAWSI_SITE_BUCKET         = var.site_bucket
      MIMAWSI_RUNNER_DISTRIBUTION = aws_cloudfront_distribution.runner.id
      GOOGLE_CLIENT_ID            = var.google_client_id

      # No MIMAWSI_OPERATOR_TOKEN, deliberately. This function publishes to the
      # live site; a long-lived bearer string in an environment variable is not
      # what should guard that. Approving is Google plus the allowlist, or not
      # at all.
    }
  }
}

# No CORS block. The page and the routes it calls are the same origin, so no
# preflight happens and nothing needs permitting. Adding origins here would only
# create a way for another site to drive this endpoint with an approver's token.
resource "aws_lambda_function_url" "admin" {
  function_name      = aws_lambda_function.admin.function_name
  authorization_type = "NONE"
}

# Both permissions, for the reason written at length in lambda.tf: with only one
# of them every route answers 403 before the handler runs, /health included.
resource "aws_lambda_permission" "admin_url" {
  statement_id           = "AllowInvokeViaFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.admin.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "admin_url_invoke" {
  statement_id             = "AllowInvokeFunctionViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.admin.function_name
  principal                = "*"
  invoked_via_function_url = true
}

resource "aws_cloudwatch_log_group" "admin" {
  name              = "/aws/lambda/${aws_lambda_function.admin.function_name}"
  retention_in_days = 14
}

locals {
  # A Function URL is https://<id>.lambda-url.<region>.on.aws/ and CloudFront wants
  # the host alone, without scheme or trailing slash.
  admin_origin_host = replace(replace(aws_lambda_function_url.admin.function_url, "https://", ""), "/", "")
}

resource "aws_cloudfront_distribution" "approval" {
  enabled         = true
  comment         = "mimawsi approval origin: admin storage is reachable from here and nowhere else"
  aliases         = [var.approval_domain]
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  origin {
    origin_id   = "admin-lambda"
    domain_name = local.admin_origin_host

    # A Function URL is a custom origin, not an S3 one, and takes no origin access
    # control. It is reachable directly as well; the distribution is here for the
    # hostname and the certificate, not to make the function private.
    custom_origin_config {
      origin_protocol_policy = "https-only"
      http_port              = 80
      https_port             = 443
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "admin-lambda"
    viewer_protocol_policy = "redirect-to-https"

    # Approve and deny are not GETs.
    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    # CachingDisabled. A cached approval queue shows one approver another's stale
    # view, and a cached /source shows a file that has since been rejected.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # AllViewerExceptHostHeader. The Authorization header must reach the Lambda or
    # every request arrives unauthenticated — but plain AllViewer forwards
    # CloudFront's Host, which a Function URL rejects outright.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  viewer_certificate {
    acm_certificate_arn      = var.approval_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

# An A alias rather than a CNAME, matching apex and www in this zone. Alias
# queries are free and resolve inside Route53.
resource "aws_route53_record" "approval_a" {
  zone_id = var.hosted_zone_id
  name    = var.approval_domain
  type    = "A"

  alias {
    # Z2FDTNDATAQYW2 is CloudFront's fixed zone id — the same constant for every
    # distribution in every account, not something to look up.
    name                   = aws_cloudfront_distribution.approval.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "approval_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.approval_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.approval.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

output "approval_url" {
  description = "The approval page. Add this origin to the Google OAuth client's authorised JavaScript origins."
  value       = "https://${var.approval_domain}/"
}

output "approval_function_url" {
  description = "The Lambda directly, for checking /health without going through CloudFront."
  value       = aws_lambda_function_url.admin.function_url
}
