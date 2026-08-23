# All mutable state (RULE-5 keeps it out of git). On-demand billing: volume is
# unknown and low, and provisioned capacity would mean guessing at it and paying
# for the guess.
#
# Only key attributes are declared. DynamoDB is schemaless everywhere else, and
# declaring the rest here would be documentation pretending to be enforcement.

locals {
  tables_common = {
    billing_mode = "PAY_PER_REQUEST"
  }
}

resource "aws_dynamodb_table" "accounts" {
  name         = "mimawsi-accounts"
  billing_mode = local.tables_common.billing_mode
  hash_key     = "account_id"

  attribute {
    name = "account_id"
    type = "S"
  }

  # Sign-in arrives with a Google subject, not an account id, so resolving one to
  # the other has to be a lookup rather than a scan.
  attribute {
    name = "google_sub"
    type = "S"
  }

  global_secondary_index {
    name            = "by-google-sub"
    hash_key        = "google_sub"
    projection_type = "ALL"
  }

  # Usernames are captured once and displayed on published tools; losing this
  # table would orphan every attribution.
  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "submissions" {
  name         = "mimawsi-submissions"
  billing_mode = local.tables_common.billing_mode
  hash_key     = "submission_id"

  attribute {
    name = "submission_id"
    type = "S"
  }

  attribute {
    name = "state"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  attribute {
    name = "sha256"
    type = "S"
  }

  attribute {
    name = "account_id"
    type = "S"
  }

  # The review queue. An index on state is what makes SQS unnecessary at this
  # volume — see the queue entry under Design Exclusions.
  global_secondary_index {
    name            = "by-state"
    hash_key        = "state"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  # Duplicate detection (RULE-12). Submitting bytes that are already published is
  # refused, and that check has to be a lookup on the hash, not a table scan.
  global_secondary_index {
    name            = "by-sha256"
    hash_key        = "sha256"
    projection_type = "ALL"
  }

  # Ownership checks, and the rolling submission limit: both ask "what has this
  # account submitted", which is not answerable from the primary key.
  global_secondary_index {
    name            = "by-account"
    hash_key        = "account_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  # Retention is declarative (RULE-38): rejected submissions expire without an
  # operator or a scheduled job. The application sets expires_at; nothing has to
  # remember to run.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "reports" {
  name         = "mimawsi-reports"
  billing_mode = local.tables_common.billing_mode
  hash_key     = "report_id"

  attribute {
    name = "report_id"
    type = "S"
  }

  # Reports are read by the tool they concern, never by their own id: a reviewer
  # asks "what has been reported about this tool".
  attribute {
    name = "tool_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "by-tool"
    hash_key        = "tool_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "bans" {
  name         = "mimawsi-bans"
  billing_mode = local.tables_common.billing_mode
  hash_key     = "subject"

  # Deliberately not an account id: a ban has to survive the account being
  # deleted, or deleting the account would lift it.
  attribute {
    name = "subject"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
