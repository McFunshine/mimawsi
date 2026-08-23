variable "region" {
  description = "The single EU region everything lives in (RULE-37)."
  type        = string
  default     = "eu-north-1"
}

variable "account_id" {
  description = "AWS account id. Passed in rather than committed."
  type        = string
}

variable "site_bucket" {
  description = "Bucket holding the built catalogue and the published tools."
  type        = string
}
