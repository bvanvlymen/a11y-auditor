// M0 CLI — local audit entry point. The actual scan logic lives in
// lib/scan.js, shared with the M2 worker Lambda.
// Usage: npm run audit -- https://example.com

import { chromium } from 'playwright'
import fs from 'node:fs'
import { runAudit } from './lib/scan.js'

const url = process.argv[2]
if (!url) {
  console.error('Usage: npm run audit -- <url>')
  process.exit(1)
}

const browser = await chromium.launch()
try {
  const report = await runAudit(browser, url)

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
    console.log(`  Affects ${v.nodes.length} element(s) | ${v.helpUrl}\n`)
  }

  console.log(`Full report: ${outFile}`)
  process.exitCode = violations.length > 0 ? 2 : 0
} finally {
  await browser.close()
}
