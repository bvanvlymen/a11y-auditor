# Milestone 0 Summary — a11y-auditor local proof of concept

**Status: ✅ COMPLETE** (2026-07-18) — tool built, live site audited, all violations fixed, re-audit fully green.

## What M0 was

The first milestone of the **a11y-auditor** flagship project (repo: [github.com/bvanvlymen/a11y-auditor](https://github.com/bvanvlymen/a11y-auditor), local: `~/Github/a11y-auditor`): a local Node script that loads any URL in headless Chromium (Playwright), runs axe-core WCAG 2.1 A/AA checks, and prints a severity-ranked report (critical → minor) to the console plus a full JSON report in `reports/`.

## What was built

### v1 — initial audit script (`68626b1`)
- `audit.js` (~50 lines): Playwright + `@axe-core/playwright`, single-viewport scan.
- Follow-up fixes: explicit browser context for AxeBuilder compatibility (`b359166`), and waiting for entrance animations to finish before analyzing to avoid mid-fade false positives (`02bc8f5`).

### v2 — full-page scan (`3e04f6e`)
- Disables CSS animations/transitions entirely, scrolls the page viewport-by-viewport (8 viewports on van-vlymen.com), runs axe at each stop, and merges/dedupes results.
- This mattered: v2 caught 5 violations that v1's single-viewport scan missed.

## Real-world results on van-vlymen.com (this repo)

The tool was pointed at the live portfolio and found genuine WCAG color-contrast violations, which were fixed here:

1. **v1 findings** → hero name and footer text contrast violations → fixed in `96b2d03`.
2. **v2 findings** → 5 Services-card contrast violations v1 had missed (`-500` Tailwind background shades) → swapped to `-700` shades in `d2683ab`.
3. Alongside the fixes: new **"Accessibility Audits (WAS-Certified)"** Services card and AI + certification framing in the About copy (`88294c1`, `745d9f7`).

**Final state:** everything merged to `main` and deployed; live re-audit with v2 shows **0 violations across all 8 viewports**. Before/after terminal output and JSON reports (in a11y-auditor's `reports/`) are banked as material for the M5 case study.

## Housekeeping

- Portfolio branches `a11y` and `services-contrast` merged and deleted; a parked `a11y` branch exists for the future M5 case-study card.
- a11y-auditor README documents the M0–M5 roadmap (target running cost under $2/month).

## Narrative worth keeping (for the M5 case study)

> v1 found a hero contrast violation → fixed it → v2's full-page scan found 5 more on the Services cards that v1 missed → fixed those → live site fully green. The tool improved, and each improvement found real bugs.

## Next: M1 — Terraform foundations

S3 + remote state + AWS budget alarm. **Already started**: first Terraform commit (`febb2ed`) landed in a11y-auditor — private S3 reports bucket + provider pinning.
