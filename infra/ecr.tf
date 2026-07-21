# M2: holds the worker Lambda's container image. Pushed to manually via
# scripts/build-push-worker.sh — Terraform never builds or pushes images
# itself (see lambda_worker.tf for how the resulting digest gets deployed).

resource "aws_ecr_repository" "worker" {
  name = "a11y-auditor-worker"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Untagged images pile up every time "latest" is overwritten by a new push
# — expire them quickly so storage cost doesn't creep.
resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 1 day"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 1
      }
      action = { type = "expire" }
    }]
  })
}
