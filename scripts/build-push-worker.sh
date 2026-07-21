#!/usr/bin/env bash
# Builds the worker Lambda's container image and pushes it to ECR as
# ":latest". Run this whenever worker/ or lib/scan.js changes, then run
# `terraform apply` in infra/ — Lambda pins to the image digest, and
# Terraform resolves that digest from the "latest" tag on every apply, so
# this script + apply together are the full deploy loop.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_NAME="a11y-auditor-worker"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region)
ECR_HOST="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "Building ${REPO_NAME}:latest..."
# --provenance=false --sbom=false: modern Docker/BuildKit attaches
# attestation manifests by default, which turns the pushed image into an
# OCI image index. Lambda's CreateFunction rejects that format outright
# ("image manifest ... is not supported") — these flags keep the build a
# single, plain image manifest that Lambda accepts.
docker build --provenance=false --sbom=false --platform linux/amd64 -f worker/Dockerfile -t "${REPO_NAME}:latest" .

echo "Logging in to ${ECR_HOST}..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR_HOST}"

docker tag "${REPO_NAME}:latest" "${ECR_HOST}/${REPO_NAME}:latest"

echo "Pushing ${ECR_HOST}/${REPO_NAME}:latest..."
docker push "${ECR_HOST}/${REPO_NAME}:latest"

echo "Done. Run 'terraform apply' in infra/ to deploy this image."
