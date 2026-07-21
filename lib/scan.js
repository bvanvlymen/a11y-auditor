// Core scan logic, shared by the local CLI (audit.js) and the M2 worker
// Lambda. Takes an already-launched Playwright `browser` so each caller
// controls how Chromium gets launched (bundled Playwright locally,
// @sparticuz/chromium in Lambda) independently of the scan itself.

import { AxeBuilder } from '@axe-core/playwright'

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor']
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

export async function runAudit(browser, url) {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

  // Zero out CSS animations and transitions so entrance effects finish
  // instantly — otherwise axe can measure mid-fade colors and report
  // false contrast results.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
    }`,
  })
  await page.waitForTimeout(500)

  // Sites often reveal sections only while they are in the viewport
  // (IntersectionObserver + opacity), so a single top-of-page scan misses
  // them. Scan once per viewport height and merge the results.
  const viewportHeight = page.viewportSize()?.height ?? 720
  const pageHeight = await page.evaluate(() => document.body.scrollHeight)
  const steps = Math.max(1, Math.ceil(pageHeight / viewportHeight))

  const violationsById = new Map()
  const passIds = new Set()
  const incompleteIds = new Set()

  for (let step = 0; step < steps; step++) {
    await page.evaluate((y) => window.scrollTo(0, y), step * viewportHeight)
    await page.waitForTimeout(600) // let observers fire and content settle

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()

    for (const p of results.passes) passIds.add(p.id)
    for (const i of results.incomplete) incompleteIds.add(i.id)
    for (const v of results.violations) {
      const existing = violationsById.get(v.id)
      if (!existing) {
        violationsById.set(v.id, { ...v, nodes: [...v.nodes] })
        continue
      }
      const seenTargets = new Set(existing.nodes.map((n) => JSON.stringify(n.target)))
      for (const n of v.nodes) {
        if (!seenTargets.has(JSON.stringify(n.target))) existing.nodes.push(n)
      }
    }
  }

  // A rule that failed anywhere on the page did not pass.
  for (const id of violationsById.keys()) {
    passIds.delete(id)
    incompleteIds.delete(id)
  }

  const violations = [...violationsById.values()].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.impact) - SEVERITY_ORDER.indexOf(b.impact)
  )

  await context.close()

  return {
    url,
    timestamp: new Date().toISOString(),
    scannedViewports: steps,
    summary: {
      passedRules: passIds.size,
      needsReview: incompleteIds.size,
      violations: violations.length,
    },
    violations,
    passedRuleIds: [...passIds].sort(),
    needsReviewRuleIds: [...incompleteIds].sort(),
  }
}
