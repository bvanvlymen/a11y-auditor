# M2: decouples "a URL was submitted" from "the scan actually ran".
# Visibility timeout is 6x the worker's Lambda timeout, per AWS's own
# guidance for SQS-triggered Lambdas — long enough that a message can't
# become visible to a second worker while the first is still processing it.

resource "aws_sqs_queue" "jobs_dlq" {
  name = "a11y-auditor-jobs-dlq"
}

resource "aws_sqs_queue" "jobs" {
  name                       = "a11y-auditor-jobs"
  visibility_timeout_seconds = local.worker_timeout_seconds * 6

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}
