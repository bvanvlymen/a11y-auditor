// M0 — local proof of concept.
// Usage: npm run audit -- https://example.com

import { chromium } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'
import fs from 'node:fs'

const url = process.argv[2]
if (!url) {
  console.error('Usage: npm run audit -- <url>')
  process.exit(1)
}

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor']

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const { violations, passes, incomplete } = results

  violations.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.impact) - SEVERITY_ORDER.indexOf(b.impact)
  )

  const host = new URL(url).hostname.replace(/\./g, '-')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile = `reports/${host}-${stamp}.json`
  fs.mkdirSync('reports', { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2))

  console.log(`\nAudited: ${url}`)
  console.log(`Passed checks: ${passes.length} | Needs review: ${incomplete.length} | Violations: ${violations.length}\n`)

  for (const v of violations) {
    console.log(`[${v.impact?.toUpperCase()}] ${v.id} — ${v.help}`)
    console.log(`  Affects ${v.nodes.length} element(s) | ${v.helpUrl}\n`)
  }

  console.log(`Full report: ${outFile}`)
  process.exitCode = violations.length > 0 ? 2 : 0
} finally {
  await browser.close()
}
