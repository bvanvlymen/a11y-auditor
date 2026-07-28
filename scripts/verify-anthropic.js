// One-off smoke test for the M3 AI layer: confirms ANTHROPIC_API_KEY is
// readable, billing is funded, and reports what the round trip cost in
// tokens. Not part of the pipeline — run it by hand after setting up a key.
//
//   node --env-file=.env scripts/verify-anthropic.js

import Anthropic from '@anthropic-ai/sdk'

// Reads ANTHROPIC_API_KEY from the environment — never hardcode the key.
const client = new Anthropic()

const MODEL = 'claude-sonnet-5'

const response = await client.messages.create({
  model: MODEL,
  // Sonnet 5 thinks by default, and max_tokens caps thinking + reply
  // together — leave headroom or the answer truncates mid-sentence.
  max_tokens: 2048,
  // Explaining a WCAG violation is recall, not reasoning. Low effort keeps
  // the thinking spend (billed as output) proportionate to the task.
  output_config: { effort: 'low' },
  messages: [
    {
      role: 'user',
      content:
        'In one sentence, explain to a non-developer why an image missing alt text is an accessibility problem.',
    },
  ],
})

const text = response.content.find((b) => b.type === 'text')?.text ?? '(no text block)'

console.log(text.trim())
console.log('---')
console.log(`model:  ${response.model}`)
console.log(`tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`)
console.log(`stop:   ${response.stop_reason}`)
