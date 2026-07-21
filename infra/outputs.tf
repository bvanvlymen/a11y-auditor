output "reports_bucket" {
  description = "Name of the audit reports bucket"
  value       = aws_s3_bucket.reports.bucket
}

output "jobs_table" {
  description = "Name of the DynamoDB jobs table"
  value       = aws_dynamodb_table.jobs.name
}

output "jobs_queue_url" {
  description = "URL of the SQS jobs queue"
  value       = aws_sqs_queue.jobs.url
}

output "worker_ecr_repository_url" {
  description = "ECR repository URL for the worker Lambda image"
  value       = aws_ecr_repository.worker.repository_url
}

output "api_function_url" {
  description = "Public URL for the API Lambda (POST to submit a job, GET ?jobId=... for status)"
  value       = aws_lambda_function_url.api.function_url
}
