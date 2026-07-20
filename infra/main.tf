# M1 learning resource: the private bucket that will hold audit reports.
# Bucket names are globally unique across all of AWS, so the account id
# is appended to avoid collisions.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "reports" {
  bucket = "a11y-auditor-reports-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "reports" {
  bucket = aws_s3_bucket.reports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
