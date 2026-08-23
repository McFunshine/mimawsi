# The upload endpoint: the Lambda behind the Submit button on /share.

variable "operator_token" {
  description = <<-TEXT
    The bearer token that authenticates the only account permitted to submit,
    until Google OAuth arrives at task-3.4. Supplied in terraform.tfvars, which is
    gitignored — this repository is public.

    It reaches the function as an environment variable, so it is readable by
    anyone who can read the function's configuration or the Terraform state. Both
    are private, and the state bucket is encrypted, but this is the weaker option:
    SSM SecureString keeps it out of both. That is the upgrade, and it is worth
    making the moment this token guards anything but an upload queue.
  TEXT
  type        = string
  sensitive   = true
}

variable "lambda_role_name" {
  description = "Execution role for the Lambdas. Created by the operator in the console — the Terraform identity can read IAM but not write it."
  type        = string
  default     = "mimawsi-lambda-exec"
}

# Adopted, not managed. The infrastructure identity deliberately holds no
# iam:CreateRole: an identity that can mint roles and pass them to Lambda can grant
# itself anything, which is the escalation path that read-only IAM closes. The role
# is created once by hand and referenced here.
data "aws_iam_role" "lambda_exec" {
  name = var.lambda_role_name
}

# The bundle esbuild produces. Built by `npm run build --workspace @mimawsi/lambdas`
# before apply; CI does the same before deploying.
data "archive_file" "submit" {
  type        = "zip"
  source_file = "${path.module}/../packages/lambdas/dist/handler.mjs"
  output_path = "${path.module}/.terraform/submit.zip"
}

resource "aws_lambda_function" "submit" {
  function_name = "mimawsi-submit"
  role          = data.aws_iam_role.lambda_exec.arn
  runtime       = "nodejs22.x"
  handler       = "handler.handler"

  filename         = data.archive_file.submit.output_path
  source_code_hash = data.archive_file.submit.output_base64sha256

  # The bundle is ~1.3 MB and does nothing but hash bytes and call S3, so it needs
  # very little. Memory is the CPU dial on Lambda, though: below 512 MB the SDK's
  # own startup dominates a request that should take milliseconds.
  memory_size = 512

  # Well above a normal request. A submission that takes longer than this has hit
  # something wrong, and holding the connection open does not help the caller.
  timeout = 15

  environment {
    variables = {
      MIMAWSI_BUCKET         = aws_s3_bucket.pending.id
      MIMAWSI_OPERATOR_TOKEN = var.operator_token
    }
  }
}

# CORS is declared here rather than handled in the function, so preflight is
# answered by the platform and never runs code, and the list of origins permitted
# to submit is reviewable infrastructure instead of a string inside a handler.
resource "aws_lambda_function_url" "submit" {
  function_name      = aws_lambda_function.submit.function_name
  authorization_type = "NONE"

  cors {
    # The catalogue only. A Function URL with "*" here would let any page on the
    # internet drive this endpoint with a victim's token.
    allow_origins = ["https://www.mimawsi.com", "https://mimawsi.com"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 3600
  }
}

# NONE means the platform performs no authentication, not that the endpoint is
# open: the handler refuses every request without the operator token, and refuses
# before any bytes are hashed or stored (AC-19). IAM auth is not usable here —
# the browser has no SigV4 credentials to sign with.
#
# And NONE alone is not enough to make the URL reachable. Setting it declares that
# the platform will not authenticate, but the function's own resource policy still
# has to permit the call, so without this every request is answered 403 by Lambda
# before the handler runs — including /health, which is what made it obvious the
# refusal was not the handler's.
# Declared explicitly rather than relying on the provider adding it: this is the
# whole reason the URL is reachable, and a policy that exists only as a side
# effect of another resource is not one anybody can reason about.
# A public function URL needs BOTH of these, and AWS answers 403 with neither
# route reaching the handler if either is missing — /health included, which is
# what showed the refusal was the platform's rather than the code's.
#
# The two are not interchangeable and take different arguments: the URL-level
# grant is conditioned on the auth type, while the invoke-level grant uses
# lambda:InvokedViaFunctionUrl. Passing the auth type to the second is rejected
# outright ("FunctionUrlAuthType is only supported for lambda:InvokeFunctionUrl").
#
# invoked_via_function_url needs AWS provider v6; v5 has no such argument. That
# condition is the part worth keeping: it restricts the grant to calls arriving
# through the URL, so principal "*" cannot be used to invoke the function by any
# other route.
resource "aws_lambda_permission" "submit_url" {
  statement_id           = "AllowInvokeViaFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.submit.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "submit_url_invoke" {
  statement_id             = "AllowInvokeFunctionViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.submit.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# Log retention is set explicitly. Lambda creates this group on first invocation
# with retention "never expire", which quietly accrues cost forever — the one
# category of spend this project has no alarm for yet.
resource "aws_cloudwatch_log_group" "submit" {
  name              = "/aws/lambda/${aws_lambda_function.submit.function_name}"
  retention_in_days = 14
}

output "submit_url" {
  description = "Set as the PUBLIC_API_ORIGIN GitHub variable so the built /share page posts here."
  value       = aws_lambda_function_url.submit.function_url
}
