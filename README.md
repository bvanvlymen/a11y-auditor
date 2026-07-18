# a11y-auditor

Paste a URL, get a scored WCAG accessibility report with plain-English fix explanations — built by a certified **Web Accessibility Specialist (WAS)**.

> 🚧 Work in progress. Currently at **M0: local proof of concept**.

## Current status — M0

A local Node script that loads any page in headless Chromium (Playwright), runs [axe-core](https://github.com/dequelabs/axe-core) WCAG 2.1 A/AA checks against it, and produces a severity-ranked report.

```bash
npm install
npx playwright install chromium
npm run audit -- https://example.com
```

Console output shows violations ranked critical → minor; the full JSON report lands in `reports/`.

## Roadmap

| Milestone | Scope | Status |
| :--- | :--- | :--- |
| M0 | Local audit script (Playwright + axe-core) | ✅ |
| M1 | Terraform foundations — S3, remote state, AWS budget alarm | ⬜ |
| M2 | Async pipeline — Lambda + SQS + DynamoDB + S3 | ⬜ |
| M3 | AI layer — Claude API explains violations in plain English | ⬜ |
| M4 | Next.js frontend + SES email reports | ⬜ |
| M5 | CI/CD via GitHub Actions (OIDC) + portfolio case study | ⬜ |

Target running cost: **under $2/month** (Lambda + free tiers).
