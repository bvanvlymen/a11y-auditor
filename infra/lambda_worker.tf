# M2 worker Lambda. Gated behind var.deploy_worker_lambda: on the very
# first apply, ECR has no image in it yet, so there's nothing for
# data.aws_ecr_image to find. Bootstrap order:
#   1. terraform apply                          (creates the ECR repo, everything else)
#   2. scripts/build-push-worker.sh              (pushes the first image)
#   3. terraform apply -var=deploy_worker_lambda=true   (creates this function)
# After that, each code change is just: build-push script, then apply —
# the data source re-resolves "latest" to whatever digest was last pushed.

data "aws_ecr_image" "worker" {
  count           = var.deploy_worker_lambda ? 1 : 0
  repository_name = aws_ecr_repository.worker.name
  image_tag       = "latest"
}

resource "aws_lambda_function" "worker" {
  count         = var.deploy_worker_lambda ? 1 : 0
  function_name = "a11y-auditor-worker"
  role          = aws_iam_role.worker.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker.repository_url}@${data.aws_ecr_image.worker[0].image_digest}"
  timeout       = local.worker_timeout_seconds
  memory_size   = local.worker_memory_mb

  environment {
    variables = {
      JOBS_TABLE     = aws_dynamodb_table.jobs.name
      REPORTS_BUCKET = aws_s3_bucket.reports.bucket

      # The parameter NAME, never the key itself. Lambda environment
      # variables are visible to anyone with lambda:GetFunction and are
      # echoed in the console, so the secret stays in SSM and the worker
      # fetches it at cold start using the IAM grant in iam.tf.
      ANTHROPIC_API_KEY_PARAM = local.anthropic_param_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]
}

resource "aws_lambda_event_source_mapping" "worker" {
  count            = var.deploy_worker_lambda ? 1 : 0
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.worker[0].arn
  batch_size       = 1
}
