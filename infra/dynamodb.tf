# M2: job records. On-demand billing — no capacity planning needed at this
# traffic level, and it's what keeps this at effectively $0 idle cost.

resource "aws_dynamodb_table" "jobs" {
  name         = "a11y-auditor-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}
