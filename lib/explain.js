// M3 AI layer — turns axe-core's technical violation output into
// plain-English explanations for the person who owns the site, not the
// developer who'll fix it. Deliberately free of Playwright and AWS
// imports so the local CLI, the worker Lambda, and any test can call it
// with nothing but a violations array.
//
// One request covers the whole page rather than one per violation: it's
// a single round trip instead of N, and the model can see the page's
// problems together (a missing landmark and a skip-link failure are the
// same story to a screen-reader user).

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-5'

// Three nodes is enough for the model to describe what's actually broken.
// Sending all of them scales cost with page size for no added insight —
// the 30th unlabelled link teaches it nothing the 3rd didn't.
const MAX_NODES = 3
const MAX_HTML_CHARS = 200

const SYSTEM_PROMPT = `You are a certified Web Accessibility Specialist (WAS) explaining automated WCAG audit findings to a site owner who is not a developer.

For each violation you are given, write three things:

- whatItMeans: what is actually wrong on the page, in one or two plain sentences. Name the visible thing that's broken (a button, an image, the colour of some text), not the rule id.
- whoItAffects: which real people hit this barrier and what happens to them when they do. Be concrete and specific — "someone using a screen reader hears 'link' with no indication of where it goes" beats "users with disabilities may be affected".
- howToFix: the concrete change to make. Name the element and what it needs. One or two sentences.

Rules:
- No jargon without explaining it. If you must say "ARIA" or "semantic HTML", say what it means in the same breath.
- No hedging or filler. Skip "it is important to note that" and similar.
- Never invent findings. Describe only what the supplied violation data supports.
- Return one entry per violation, with the id copied exactly as given.`

// axe-core violation objects carry far more than the model needs: every
// WCAG tag, the full node list, and axe's own failureSummary boilerplate.
// A real report's violations array measures 3-10 KB; this trims it under
// 1 KB, and input tokens are the part we pay for.
function slim(violations) {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    description: v.description,
    nodes: (v.nodes ?? []).slice(0, MAX_NODES).map((n) => ({
      target: n.target,
      html: (n.html ?? '').slice(0, MAX_HTML_CHARS),
    })),
    totalNodes: (v.nodes ?? []).length,
  }))
}

// Structured outputs rather than "please reply with JSON": the response is
// schema-checked by the API, so a malformed reply fails loudly at the call
// instead of throwing inside JSON.parse three steps later in the pipeline.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    explanations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          whatItMeans: { type: 'string' },
          whoItAffects: { type: 'string' },
          howToFix: { type: 'string' },
        },
        required: ['id', 'whatItMeans', 'whoItAffects', 'howToFix'],
        additionalProperties: false,
      },
    },
  },
  required: ['explanations'],
  additionalProperties: false,
}

/**
 * @param {Array} violations - the `violations` array from runAudit()
 * @param {{client?: Anthropic, model?: string}} [options]
 * @returns {Promise<{explanations: Object, usage: Object|null}>}
 *   `explanations` is keyed by violation id for easy merging into a report.
 */
export async function explainViolations(violations, options = {}) {
  // A clean page is the happy path, and it costs nothing to notice.
  if (!violations?.length) return { explanations: {}, usage: null }

  const client = options.client ?? new Anthropic()
  const model = options.model ?? MODEL

  const response = await client.messages.create({
    model,
    // Thinking and reply share this budget on Sonnet 5. Four violations of
    // three paragraphs each is ~1.5K tokens of prose, so this leaves room.
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    // Explaining a known WCAG rule is recall, not reasoning. Low effort
    // keeps thinking spend (billed as output) proportionate.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Explain these ${violations.length} accessibility violation(s):\n\n${JSON.stringify(slim(violations), null, 2)}`,
      },
    ],
  })

  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error(`No text block in response (stop_reason: ${response.stop_reason})`)

  const parsed = JSON.parse(text)

  const explanations = {}
  for (const e of parsed.explanations) {
    explanations[e.id] = {
      whatItMeans: e.whatItMeans,
      whoItAffects: e.whoItAffects,
      howToFix: e.howToFix,
    }
  }

  return { explanations, usage: response.usage }
}
