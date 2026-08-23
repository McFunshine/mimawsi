# Where an upload lands before anyone has looked at it.
#
# Nothing serves from here: no CloudFront distribution has it as an origin, and
# the bucket is closed to the internet. That is the point — a pending submission
# is unreviewed, potentially hostile input, and the only things that should ever
# read it are the scan pipeline and a reviewer.

resource "aws_s3_bucket" "pending" {
  bucket = "mimawsi-pending-${var.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "pending" {
  bucket = aws_s3_bucket.pending.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pending" {
  bucket = aws_s3_bucket.pending.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# A submission that is rejected, or simply never reviewed, should not sit here
# forever. Declarative expiry (RULE-38) means no operator action and no scheduled
# job to forget about. It was written when submissions were to be DynamoDB rows
# with a TTL, and paired with that TTL so a record never outlived its bytes; the
# store is now a single bucket, so the pairing no longer applies. See the rule.
resource "aws_s3_bucket_lifecycle_configuration" "pending" {
  bucket = aws_s3_bucket.pending.id

  # Scoped to the uploaded bytes, and to nothing else. An unscoped filter matches
  # every object in the bucket, which now includes index.json — the record of every
  # submission and every published tool — and the published bytes themselves. That
  # rule would have quietly deleted the entire store on its ninetieth day.
  #
  # A pending record can now outlive its bytes, where before a DynamoDB TTL kept
  # the two aligned. That surfaces as a NotFoundError when the review CLI reaches
  # for a file that expired, which is the honest answer: the file is genuinely gone.
  rule {
    id     = "expire-unreviewed-uploads"
    status = "Enabled"

    filter {
      prefix = "pending/"
    }

    expiration {
      days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# The site bucket already exists and is adopted in generated.tf. Its public
# access block is asserted here rather than assumed: RULE-2 says the bucket is
# never publicly readable, and a rule nobody checks is a hope.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
