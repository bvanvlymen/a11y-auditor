# Milestone 1 Summary — Terraform foundations + AWS account hygiene

**Status: ✅ COMPLETE** (2026-07-20) — budget alarm live, first Terraform resource created via the real `init → plan → apply` loop, root credentials retired.

## What M1 was

The second milestone of the **a11y-auditor** flagship project: AWS account hygiene (a spending guardrail, moving off root credentials) followed by the first real Terraform-managed resource — deliberately small, so the `init → plan → apply` loop could be learned before anything complicated.

## What was built

### AWS budget guardrail
- Created a **$5/month AWS Budget** (`monthly-guardrail`) with email alerts at 80% actual spend and 100% forecasted spend, sent to `arduino731@gmail.com`. Done before any resource existed, on purpose.

### First Terraform (`infra/`, commit `febb2ed`)
- `providers.tf` pins `hashicorp/aws ~> 5.0`.
- `main.tf` defines one private S3 bucket (`a11y-auditor-reports-<account-id>`) plus a public-access block.
- `outputs.tf` prints the bucket name.
- **Brian ran the full loop himself**: `terraform plan` (2 to add, 0 to destroy) → `terraform apply` → `yes` → verified the bucket exists (`aws s3 ls`). Cost: $0.00.

### Root credentials retired
- Discovered the AWS CLI was authenticating as the **root** account — the identity AWS says should never hold API keys.
- Created IAM user `brian-admin` (AdministratorAccess), rotated the CLI over to its keys, deleted both old root access keys (one from 2025, one from earlier in 2026).
- Re-verified `terraform plan` under the new identity — "No changes," proving the cutover was clean.

## AWS account hygiene fallout (same audit, same account)

While rotating off root, a broader look at IAM turned up several unrelated issues, fixed in the same pass:
- **Ghost `admin-user`** — unused IAM user, deleted.
- **`beshandyman-uploader`** — an "uploader" identity that had `AdministratorAccess` attached; detached, left scoped to `AmazonS3FullAccess` only.
- **`interpicker-ses-prod`** — had *no* policy at all, meaning SES sending was silently broken; attached a scoped `ses:SendEmail`/`ses:SendRawEmail` policy for the verified `arduino731@gmail.com` identity.
- Confirmed `interpicker-object` / `interpicker-object-dev` buckets are public static-asset buckets referenced directly by the InterPicker frontend — not a credential risk, just a different access pattern than the IAM-scoped uploaders.

This side work led directly into a related (separate) InterPicker EC2 → IAM-instance-role migration project, tracked on its own in the InterPicker repo — not part of this milestone's scope, but grew out of the same account audit.

## Narrative worth keeping (for the M5 case study)

> Set up a $5 budget alarm before writing a single line of infrastructure, then — while doing routine account hygiene — found and rotated a live root-account access key, an over-privileged "uploader" identity, and a silently-broken email permission. The same discipline a WAS certification represents for accessibility, applied here to cloud security.

## Next: M2 — the async pipeline

SQS + two Lambdas (crawl/audit worker + API) + DynamoDB. The M0 script becomes the worker's container image.
