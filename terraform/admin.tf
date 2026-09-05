# Who may approve, and the queue they act on.
#
# Separate from the pending bucket on purpose. That one holds submitted bytes —
# hostile input until reviewed — and this one holds the list of people allowed to
# decide. Keeping the authority and the thing it judges in different buckets means
# a mistake in the submission path cannot reach the allowlist.

resource "aws_s3_bucket" "admin" {
  bucket = "mimawsi-admin-${var.account_id}"
}

# Nothing serves from here and nothing ever should. No distribution has it as an
# origin, and the allowlist is read server-side by the Lambda alone — a browser
# must never see it, because a browser cannot be trusted to enforce it.
resource "aws_s3_bucket_public_access_block" "admin" {
  bucket = aws_s3_bucket.admin.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "admin" {
  bucket = aws_s3_bucket.admin.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Versioned, which the other buckets are not. This one holds the answer to "who
# may publish to the site", so being able to see what it used to say, and to put
# it back, is worth more here than anywhere else.
resource "aws_s3_bucket_versioning" "admin" {
  bucket = aws_s3_bucket.admin.id

  versioning_configuration {
    status = "Enabled"
  }
}

# No lifecycle rule. Nothing in here expires: an allowlist that quietly emptied
# itself after ninety days would lock the operator out of their own site.

output "admin_bucket" {
  description = "Holds the approver allowlist. Read by the Lambda, never served."
  value       = aws_s3_bucket.admin.id
}
