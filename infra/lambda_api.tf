# M2 API Lambda — plain zip deployment (no native deps, unlike the worker).
# Run `npm ci --omit=dev` in ../api once before the first apply, and again
# after any dependency change — archive_file zips whatever is on disk.

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../api"
  output_path = "${path.module}/api.zip"
}

resource "aws_lambda_function" "api" {
  function_name    = "a11y-auditor-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs20.x"
  handler          = "handler.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      JOBS_TABLE = aws_dynamodb_table.jobs.name
      QUEUE_URL  = aws_sqs_queue.jobs.url
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["content-type"]
  }
}

# authorization_type = "NONE" above only controls what IAM requires of
# callers — it does NOT itself allow public invocation. Without this
# resource-based permission, the Function URL returns 403 Forbidden to
# every caller regardless of auth type.
resource "aws_lambda_permission" "api_public_url" {
  statement_id           = "AllowPublicFunctionUrlInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# As of Oct 2025, AWS also requires an explicit lambda:InvokeFunction grant
# for NONE-auth function URLs (previously InvokeFunctionUrl alone was
# enough) — omitting it now gets every caller a 403. AWS's own docs scope
# this to "only when invoked via the function URL" using an
# invoked-via-function-url condition, but the AWS provider's
# aws_lambda_permission resource has no argument for that condition key, so
# this grants InvokeFunction to "*" unconditionally. Net effect: this
# function also becomes callable via the raw Lambda Invoke API by any AWS
# principal, not just through the URL — a minor widening of the "public, no
# auth" call already made, worth knowing about if this ever changes.
resource "aws_lambda_permission" "api_invoke_function" {
  statement_id  = "AllowPublicInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "*"
}
