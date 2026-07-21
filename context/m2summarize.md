# Milestone 2 Summary — Async pipeline (SQS + Lambda + DynamoDB)

**Status: ✅ COMPLETE** (2026-07-21) — submitted a real URL over the public API, watched it queue, get scanned by the worker, and land in DynamoDB + S3, end to end.

## What M2 was

Turn the M0 CLI into a real async service: submit a URL over HTTP, get a `jobId` back immediately, a worker picks the job off a queue and runs the actual scan, results land in DynamoDB (+ full report in the M1 reports bucket). This is the backbone M3 (Claude explains violations) and M4 (Next.js frontend) sit on top of.

## What was built

### Remote Terraform state (carried over from M1)
- M1 deferred this on purpose. Bootstrapped a versioned, encrypted, public-access-blocked S3 bucket (`a11y-auditor-tfstate-<account-id>`) with local state, then `terraform init -migrate-state` moved everything into it.
- Uses Terraform 1.10+'s native S3 locking (`use_lockfile = true`) — no separate DynamoDB lock table needed.

### Code split: `lib/scan.js`
- Pulled the actual scan logic out of `audit.js` into `runAudit(browser, url)`, shared by the CLI and the worker Lambda. Each caller launches its own `browser` (bundled Playwright locally, `@sparticuz/chromium` in Lambda) — one scanning implementation, two entry points.

### Worker Lambda (`worker/`)
- Container image (`public.ecr.aws/lambda/nodejs:20` + `playwright-core` + `@sparticuz/chromium` — the latter ships a prebuilt Chromium targeting exactly this Amazon-Linux-2023 base, so no extra system packages needed).
- SQS-triggered, `batch_size = 1`. Marks the job `processing` → runs the scan → writes the full report to `reports_bucket/reports/{jobId}.json` → marks `done` with a summary, or marks `failed` with the error and rethrows so SQS retries / eventually routes to the DLQ.
- 2048MB memory, 120s timeout. SQS visibility timeout is 6× that (720s), per AWS's own guidance for SQS-triggered Lambdas.

### API Lambda (`api/`)
- Plain zip, Node 20, behind a public **Lambda Function URL** (no API Gateway — simpler, no extra cost). Routes on HTTP method:
  - `POST { url }` — validates `http`/`https` scheme and rejects obviously-internal hostnames (loopback/RFC1918/link-local incl. the cloud metadata address — a basic SSRF guard, not DNS-rebinding-proof; full hardening is a later item), then writes a `queued` job to DynamoDB and enqueues `{ jobId, url }` to SQS.
  - `GET ?jobId=...` — reads the job record back.

### Infra glue
- DynamoDB `a11y-auditor-jobs`, on-demand billing, native TTL (~90 days) so demo jobs clean themselves up.
- SQS `a11y-auditor-jobs` + DLQ (`maxReceiveCount = 3`).
- Scoped IAM roles per function (api: PutItem/GetItem + SendMessage; worker: Receive/Delete/GetQueueAttributes + UpdateItem + S3 PutObject on `reports/*` only) plus explicit CloudWatch log groups (14-day retention) so logs don't accumulate unmanaged.
- ECR repo for the worker image, with a lifecycle policy expiring untagged images after 1 day.

### Deploy workflow (deliberately manual, not Terraform-automated)
- `scripts/build-push-worker.sh` builds and pushes the worker image to ECR as `:latest`; Terraform resolves that tag to a digest via `data.aws_ecr_image` and deploys whatever was last pushed. Keeps `terraform apply` purely declarative and leaves "automate the build" as the actual lesson of M5 (GitHub Actions + OIDC).
- Bootstrap chicken-and-egg (ECR repo doesn't exist until the first apply, but the worker Lambda needs an image that doesn't exist until after that first apply): solved with `var.deploy_worker_lambda`, gating the worker function + event source mapping behind a bool that starts `false` for the very first apply and flips to `true` (now the committed default) once an image exists.

## Two real bugs hit during deploy — good material for the eventual case study

1. **Docker image manifest rejected by Lambda.** Modern Docker (BuildKit) attaches provenance/SBOM attestation manifests by default, turning a single-platform image into an OCI image index — which `CreateFunction` flatly rejects ("image manifest ... is not supported"). Fix: `docker build --provenance=false --sbom=false --platform linux/amd64`.
2. **Public Function URL returned 403 despite a correct-looking resource policy.** As of October 2025, AWS requires **both** `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` grants for a `NONE`-auth URL (previously the first alone was enough — and Lambda now auto-creates that first grant, which is what made the policy look "already right"). The second grant's ideal scope (`lambda:InvokedViaFunctionUrl` condition, restricting it to only calls made through the URL) isn't exposed by the Terraform AWS provider's `aws_lambda_permission` resource, so the grant here is broader than AWS's own recommended pattern: this function is also invokable via the raw Lambda Invoke API by any AWS principal, not just through the URL. Given the endpoint is already intentionally public/unauthenticated, this is a minor widening of a decision already made, not a new exposure — worth revisiting if the provider ever adds support for that condition key.

Also caught (before it could bite): the `deploy_worker_lambda` variable's default was still `false` after the bootstrap apply, so a bare `terraform plan` would have silently destroyed the freshly-created worker Lambda and its SQS trigger the next time anyone ran it without the one-off `-var` flag. Fixed by flipping the committed default to `true` once the bootstrap was done.

## Verified end-to-end (2026-07-21)

- `POST` a real URL → `202 {jobId}` → polled `GET ?jobId=...` → `done` with a summary, on the very first poll.
- Confirmed the S3 report (`reports/<jobId>.json`) matches the exact shape the CLI already produces.
- `POST` an unreachable URL → job correctly landed in `failed` with the Playwright error message (`net::ERR_NAME_NOT_RESOLVED`) captured.
- Confirmed both CloudWatch log groups (`/aws/lambda/a11y-auditor-api`, `/aws/lambda/a11y-auditor-worker`) are the Terraform-managed ones (14-day retention), not auto-created.

## Next: M3 — the AI layer

Claude API explains each violation in plain English, ranked by severity. Likely hangs off the worker (or a third Lambda) reading the S3 report and writing an explanation back onto the DynamoDB job record.
