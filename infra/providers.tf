terraform {
  required_version = ">= 1.10" # for native S3 state locking (use_lockfile)

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

  # M2: remote state (see backend-bootstrap.tf). Left commented out until the
  # bucket below actually exists — bootstrap order:
  #   1. apply once with this block commented out, to create the bucket
  #   2. uncomment this block
  #   3. terraform init -migrate-state
  backend "s3" {
    bucket       = "a11y-auditor-tfstate-339713165006"
    key          = "a11y-auditor/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}
