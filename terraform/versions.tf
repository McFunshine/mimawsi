terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # State lives in S3, never in the repository. A previous project committed a
  # terraform.tfstate containing a GOOGLE_CLIENT_ID; this repository is public,
  # so that mistake would be considerably worse here.
  #
  # No lock table yet: state locking on this Terraform version needs DynamoDB,
  # which the deploy identity cannot reach. Single operator, so the window is
  # small — but this is a gap, not a decision. See terraform/README.md.
  # Partial config: the bucket name is supplied at init from backend.hcl, which
  # is gitignored, so no account-derived name is committed to a public repo.
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key     = "mimawsi/terraform.tfstate"
    region  = "eu-north-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.region
}

# CloudFront certificates and some global resources are only addressable in
# us-east-1, whatever region everything else lives in.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
