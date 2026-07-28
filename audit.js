// M0 CLI — local audit entry point. The actual scan logic lives in
// lib/scan.js, shared with the M2 worker Lambda.
// Usage: npm run audit -- https://example.com [--explain]
//
// --explain adds the M3 plain-English layer. Opt-in rather than default:
// scanning is free, explaining costs API credit, and you don't want every
// debug run of the scraper billing you.

import { chromium } from 'playwright'
import fs from 'node:fs'
import { runAudit } from './lib/scan.js'
import { explainViolations } from './lib/explain.js'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--'))
const wantsExplain = args.includes('--explain')

if (!url) {
  console.error('Usage: npm run audit -- <url> [--explain]')
  process.exit(1)
}

const browser = await chromium.launch()
try {
  const report = await runAudit(browser, url)

  // A failed explain must not cost you the scan — Playwright already did
  // the expensive part. Log it, save the report without prose, carry on.
  let explanations = {}
  if (wantsExplain && report.violations.length > 0) {
    try {
      const result = await explainViolations(report.violations)
      explanations = result.explanations
      report.explanations = explanations
      console.log(
        `\nExplained ${Object.keys(explanations).length} violation(s) — ` +
          `${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens`
      )
    } catch (err) {
      console.error(`\nExplain step failed (report still saved): ${err.message}`)
    }
  }

  const host = new URL(url).hostname.replace(/\./g, '-')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile = `reports/${host}-${stamp}.json`
  fs.mkdirSync('reports', { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

  const { scannedViewports, summary, violations } = report
  console.log(`\nAudited: ${url} (${scannedViewports} viewport${scannedViewports === 1 ? '' : 's'} scanned)`)
  console.log(`Passed rules: ${summary.passedRules} | Needs review: ${summary.needsReview} | Violations: ${summary.violations}\n`)

  for (const v of violations) {
    console.log(`[${v.impact?.toUpperCase()}] ${v.id} — ${v.help}`)
    console.log(`  Affects ${v.nodes.length} element(s) | ${v.helpUrl}`)

    const e = explanations[v.id]
    if (e) {
      console.log(`  What it means: ${e.whatItMeans}`)
      console.log(`  Who it affects: ${e.whoItAffects}`)
      console.log(`  How to fix:    ${e.howToFix}`)
    }
    console.log()
  }

  console.log(`Full report: ${outFile}`)
  process.exitCode = violations.length > 0 ? 2 : 0
} finally {
  await browser.close()
}
