variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "deploy_worker_lambda" {
  description = "True once an image has been pushed to ECR (scripts/build-push-worker.sh) and the worker Lambda created. Only false before that first image exists — flipped back to true here so a plain 'terraform apply' doesn't destroy the worker."
  type        = bool
  default     = true
}
