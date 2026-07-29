# Milestone 3 Summary — AI layer (Claude explains violations in plain English)

**Status: ✅ COMPLETE** (2026-07-29) — submitted a real URL to the deployed pipeline and got back a report where every axe-core violation carries a plain-English explanation written for the site owner, not the developer.

## What M3 was

axe-core tells you `color-contrast` failed on three nodes. That's useful to a developer and meaningless to the person who actually owns the site. M3 turns each violation into three things a non-developer can act on: what's wrong, who it hurts, and what to change. The scan pipeline from M2 is unchanged; this bolts onto the end of it.

## What was built

### `lib/explain.js` — the AI layer
- `explainViolations(violations)` → explanations keyed by violation id. No Playwright and no AWS imports, so the CLI, the worker Lambda, and any test call the identical code path (same pattern as `lib/scan.js` in M2).
- **One request per page, not per violation.** A single round trip instead of N, and the model sees the page's problems together — a missing landmark and a broken skip link are the same story to a screen-reader user.
- **Slimmed payload.** axe violation objects carry every WCAG tag, the full node list, and axe's own `failureSummary` boilerplate; a real report's `violations` array measures 3–10 KB. `slim()` keeps id, impact, help, description, and the first 3 offending nodes (HTML capped at 200 chars) — under 1 KB. Input tokens are what we pay for.
  - Keeping *some* real node HTML is what makes the output specific rather than generic. The model wrote "a submit button that only shows an arrow icon" and "a dropdown for choosing a plan (Free/Pro)" — it's describing the actual page, not reciting the rule. Worth not trimming further.
- **Structured outputs** (`output_config.format` with a JSON schema) rather than "please reply with JSON". The API validates the shape, so a malformed reply fails at the call site instead of throwing inside `JSON.parse` three steps later during the S3 write.
- Model: `claude-sonnet-5` at `effort: "low"`. Explaining a known WCAG rule is recall, not reasoning — low effort produced **zero thinking tokens** while keeping the prose quality, and thinking bills as output.

### Local CLI (`audit.js`)
- `--explain` is **opt-in**. Scanning is free, explaining costs API credit, and every debug run of the scraper shouldn't bill you.
- Built and iterated locally *before* touching Lambda: sub-second edit-run loop at ~2 cents a pass, versus docker build → ECR push → `terraform apply` for every prompt tweak.

### `fixtures/broken.html`
- The site this was built for passes all 23 rules it's tested against, which is great for the client and useless for testing. A deliberately inaccessible fixture fails 8 WCAG A/AA rules on purpose (contrast, labelling, document structure) so the AI layer has something to describe. Note it's only reachable over `file://` — Lambda can't see it, so the deployed pipeline is tested against W3C's public "before" demo page instead.

### Worker integration (`worker/handler.js`)
- Key fetched from SSM **once per container, not once per job** — Lambda reuses warm containers, so a per-invoke `GetParameter` adds a round trip to every scan for nothing. Cached as the *promise* rather than the value, so two concurrent cold invocations share one call instead of racing.
- The explain call sits after the browser closes and before the S3 write: Chromium isn't held open across a network call, and the report object is still mutable.
- Guarded by `ANTHROPIC_API_KEY_PARAM &&` — unset means the AI layer is simply off and scans still complete. A kill switch for spend that needs no redeploy.

### Secret handling — the decision worth keeping
- The API key lives in **SSM Parameter Store as a SecureString**, created out of band and **deliberately not managed by Terraform**. An `aws_ssm_parameter` resource — *or* a `data` source reading it — writes the plaintext into `terraform.tfstate`, which lives in S3. Terraform only ever knows the parameter's *name*; the worker resolves the value at runtime.
- The Lambda env var carries the parameter **name**, never the key. Env vars are readable by anyone with `lambda:GetFunction` and are shown in plaintext in the console.
- IAM: `ssm:GetParameter` scoped to the exact parameter ARN (not the `/a11y-auditor/*` prefix, so a future secret under the same path doesn't silently widen the worker's reach), plus `kms:Decrypt` on the AWS-managed `aws/ssm` key conditioned on `kms:ViaService`. **`ssm:GetParameter` alone returns AccessDenied for a SecureString** — reading one requires decrypting it, and the error points at KMS, not SSM, which sends you looking in the wrong place.
- Parameter Store rather than Secrets Manager: standard parameters are free, Secrets Manager is $0.40/secret/month — 20% of the whole project's monthly budget for one string.

### Failure isolation
- The explain call has its **own** try/catch, separate from the scan's. The browser run is the expensive part; a rate limit, an exhausted balance, or a bad credential must not throw away a completed scan and send the job round the SQS retry loop to be re-scanned. On failure: log it, save the report without prose, still mark the job `done`.

## The bug worth writing up

**Symptom:** the deployed worker failed every explain call with `Connection error.` — while, in the same invocation, Playwright reached w3.org and the AWS SDK reached DynamoDB, S3, and SSM.

**What it wasn't** (ruled out with evidence, in this order): the code, the image, the dependencies, Node 20, or the key itself — the *exact* deployed image, run locally under Docker with the key from `.env`, called the API successfully. Not a VPC problem either (`vpc: null`, and Chromium had internet). Not a timeout (22.9s of a 120s budget) or memory (700 MB of 2048).

**What it was:** the key stored in SSM was 233 characters. A real `sk-ant-api03` key is 108. Everything from index 108 on was **ANSI escape sequences** — char code 27, nine of them at 3-character intervals — terminal colour output captured when the value was first written. undici refused to build the `x-api-key` header, so **no socket was ever opened**, which the SDK reported as the maximally unhelpful "Connection error."

**Why it took a redeploy to find:** the original catch block logged `err.message`. For `APIConnectionError` that message is a constant string carrying nothing. The real failure is only ever on `err.cause`. The fix was to walk the full cause chain — which immediately printed `cause[1]=UND_ERR_INVALID_ARG invalid x-api-key header` and ended the investigation.

**Two lessons, both now in the code:**
1. The key is trimmed and validated at fetch time, and a character illegal in an HTTP header throws an error that *names the problem and its index* — rather than surfacing three layers down as a network error.
2. That validation throws **inside the cached promise**, which clears the cache. Repairing the parameter now takes effect on the next invocation instead of being stuck until the container cycles. The original code cached a client built from a bad key indefinitely, because client *construction* succeeds — the key is only checked at request time.

The headline, though: this was an unrecoverable dependency failure, no retry possible, and the pipeline still returned a complete 5-violation report with the job marked `done`. The failure-isolation decision paid for itself on its first real outing. The redeploy was only ever about *diagnosing*, never about recovering the scan.

## Cost

Measured, not estimated. `claude-sonnet-5` at introductory pricing ($2/$10 per MTok, through 2026-08-31):

| Scan | Tokens | Cost |
| :--- | :--- | ---: |
| 1 violation | 1,198 in / 233 out | ~$0.005 |
| 5 violations (deployed, W3C demo) | 2,155 in / 886 out | ~$0.013 |
| 8 violations (local fixture) | 2,021 in / 1,222 out | ~$0.016 |

Roughly **200–300 reports per $5** at the worst case, and clean pages cost nothing — the guard skips the call when there are no violations. Prepaid credit with auto-reload **off** is the hard spend ceiling.

Prompt caching was considered and rejected: the stable system prompt clears Sonnet 5's 1024-token minimum, but the 5-minute TTL means sporadic one-off reports miss it every time. Worth revisiting only if scans start arriving in bursts.

## Verified end-to-end (2026-07-29)

- Local: `npm run audit -- "file://$PWD/fixtures/broken.html" --explain` → 8 violations, 8 explanations, ids matching exactly, persisted into the report JSON.
- Deployed: `POST` W3C's "before" demo → job `done`, CloudWatch shows `explained 5 violation(s) … 2155 in / 886 out tokens`, and the S3 report carries 5 explanations keyed to the 5 violations.
- Failure path proven for real (not simulated): with a corrupt credential, the job still completed with a full 5-violation report and the error logged.

## Known boundary — deliberate, not an oversight

The API's `GET ?jobId=...` returns the DynamoDB record: `status`, `summary`, `reportKey`. **It does not return the explanations.** Those exist only inside the S3 report, and that bucket is public-access-blocked. So nothing outside the AWS account can currently read the plain-English output.

That's M4's job — the frontend and the emailed report are what give this a reader. Recording it here so it reads as a decision rather than a gap.

## Next: M4 — Next.js frontend + SES email reports

Give the explanations somewhere to be read: a URL submission form, a results view, and an emailed report. That's also what closes the boundary above.
