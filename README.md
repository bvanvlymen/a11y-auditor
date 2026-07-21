# a11y-auditor

Paste a URL, get a scored WCAG accessibility report with plain-English fix explanations — built by a certified **Web Accessibility Specialist (WAS)**.

> 🚧 Work in progress. Currently at **M2: async pipeline**.

## Current status — M2

Local CLI (still the fastest way to test a scan):

```bash
npm install
npx playwright install chromium
npm run audit -- https://example.com
```

Console output shows violations ranked critical → minor; the full JSON report lands in `reports/`.

**Async pipeline** — the same scan logic (`lib/scan.js`), now running on AWS: submit a URL over HTTP, get a `jobId` back immediately, a queued Lambda worker runs the scan, results land in DynamoDB + S3.

```bash
curl -X POST "$(terraform -chdir=infra output -raw api_function_url)" \
  -H "content-type: application/json" -d '{"url":"https://example.com"}'
# => {"jobId": "..."}

curl "$(terraform -chdir=infra output -raw api_function_url)?jobId=<jobId>"
# => {"status": "done", "reportKey": "reports/<jobId>.json", "summary": {...}, ...}
```

Architecture: `api` Lambda (public Function URL) → SQS → `worker` Lambda (container image, Playwright + `@sparticuz/chromium`) → DynamoDB + S3. See `infra/` for the Terraform and `context/m2summarize.md` for how it's wired together.

## Roadmap

| Milestone | Scope | Status |
| :--- | :--- | :--- |
| M0 | Local audit script (Playwright + axe-core) | ✅ |
| M1 | Terraform foundations — S3, remote state, AWS budget alarm | ✅ |
| M2 | Async pipeline — Lambda + SQS + DynamoDB + S3 | ✅ |
| M3 | AI layer — Claude API explains violations in plain English | ⬜ |
| M4 | Next.js frontend + SES email reports | ⬜ |
| M5 | CI/CD via GitHub Actions (OIDC) + portfolio case study | ⬜ |

Target running cost: **under $2/month** (Lambda + free tiers).
