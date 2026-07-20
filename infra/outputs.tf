output "reports_bucket" {
  description = "Name of the audit reports bucket"
  value       = aws_s3_bucket.reports.bucket
}
