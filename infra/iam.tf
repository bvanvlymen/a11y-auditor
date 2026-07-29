# M2: one role per Lambda, each scoped to only what that function touches.

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# --- api Lambda -------------------------------------------------------

resource "aws_iam_role" "api" {
  name               = "a11y-auditor-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "api_basic" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.jobs.arn]
  }

  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "a11y-auditor-api-policy"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# --- worker Lambda -----------------------------------------------------

resource "aws_iam_role" "worker" {
  name               = "a11y-auditor-worker-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "worker_basic" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "worker" {
  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.jobs.arn]
  }

  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.reports.arn}/reports/*"]
  }

  # M3: read the Anthropic API key at cold start. Scoped to this one
  # parameter — not the /a11y-auditor/* prefix — so adding an unrelated
  # secret under the same path later doesn't silently widen the worker's
  # reach.
  statement {
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.anthropic_param_name}"]
  }

  # A SecureString is useless without the key that encrypts it, so
  # ssm:GetParameter alone would fail with AccessDenied on decrypt. The
  # ViaService condition means this grant only works for calls arriving
  # through SSM — it can't be used to decrypt anything else in the account.
  statement {
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_key.ssm.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

# The AWS-managed key that encrypts SecureString parameters by default.
# Looked up rather than hardcoded: its id differs per account and region.
data "aws_kms_key" "ssm" {
  key_id = "alias/aws/ssm"
}

resource "aws_iam_role_policy" "worker" {
  name   = "a11y-auditor-worker-policy"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

# --- log groups ---------------------------------------------------------
# Declared explicitly (rather than left to auto-create on first invoke) so
# retention is bounded and `terraform destroy` cleans them up too.

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/a11y-auditor-api"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/a11y-auditor-worker"
  retention_in_days = 14
}
