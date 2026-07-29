// M2 worker Lambda — triggered by SQS. One message = one audit job.
// batch_size is 1 (see infra/lambda_worker.tf), so event.Records always
// has exactly one entry.

import chromium from '@sparticuz/chromium'
import { chromium as playwrightChromium } from 'playwright-core'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import Anthropic from '@anthropic-ai/sdk'
import { runAudit } from './lib/scan.js'
import { explainViolations } from './lib/explain.js'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const s3 = new S3Client({})
const ssm = new SSMClient({})

const JOBS_TABLE = process.env.JOBS_TABLE
const REPORTS_BUCKET = process.env.REPORTS_BUCKET
// M3: the SSM parameter holding the Anthropic key (see infra/locals.tf).
// Unset means the AI layer is simply off — scans still run and complete.
const ANTHROPIC_API_KEY_PARAM = process.env.ANTHROPIC_API_KEY_PARAM

// Lambda reuses warm containers, so resolve the key once per container
// rather than once per job — a per-invoke GetParameter adds a round trip
// to every scan and eats SSM's throughput limit for nothing. Cached as the
// promise rather than the value so two concurrent cold invocations share
// one call instead of racing.
let anthropicClientPromise = null

function getAnthropicClient() {
  if (!anthropicClientPromise) {
    anthropicClientPromise = (async () => {
      const { Parameter } = await ssm.send(
        new GetParameterCommand({ Name: ANTHROPIC_API_KEY_PARAM, WithDecryption: true })
      )
      const apiKey = Parameter.Value.trim()

      // A key carrying anything outside printable ASCII — an ANSI escape
      // picked up from a colourised terminal, a stray newline — is rejected
      // by undici when it builds the x-api-key header, three layers below
      // this, and surfaces as a bare "Connection error." with no socket ever
      // opened. Fail here instead, where the message can name the real
      // problem. Throwing inside this promise also clears the cache below,
      // so repairing the parameter takes effect on the next invocation
      // rather than waiting for the container to cycle.
      const badIndex = [...apiKey].findIndex((ch) => {
        const c = ch.charCodeAt(0)
        return c < 0x21 || c > 0x7e
      })
      if (badIndex !== -1) {
        throw new Error(
          `${ANTHROPIC_API_KEY_PARAM} holds a character that is illegal in an HTTP header ` +
            `at index ${badIndex} (char code ${apiKey.charCodeAt(badIndex)}) — ` +
            `check for ANSI escape codes or newlines captured when the value was stored`
        )
      }

      return new Anthropic({ apiKey })
    })().catch((err) => {
      // Never cache a failure: a transient SSM error would otherwise
      // disable the AI layer for the whole life of this container.
      anthropicClientPromise = null
      throw err
    })
  }
  return anthropicClientPromise
}

async function markProcessing(jobId) {
  await ddb.send(
    new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'processing', ':updatedAt': new Date().toISOString() },
    })
  )
}

async function markDone(jobId, reportKey, summary) {
  await ddb.send(
    new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, reportKey = :reportKey, summary = :summary',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'done',
        ':updatedAt': new Date().toISOString(),
        ':reportKey': reportKey,
        ':summary': summary,
      },
    })
  )
}

async function markFailed(jobId, errorMessage) {
  await ddb.send(
    new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, #error = :error',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: { ':status': 'failed', ':updatedAt': new Date().toISOString(), ':error': errorMessage },
    })
  )
}

export const handler = async (event) => {
  for (const record of event.Records) {
    const { jobId, url } = JSON.parse(record.body)
    await markProcessing(jobId)

    try {
      const browser = await playwrightChromium.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      })

      let report
      try {
        report = await runAudit(browser, url)
      } finally {
        await browser.close()
      }

      // The scan is the product; the prose is an enhancement. This gets its
      // own try/catch on purpose — the browser run above is the expensive
      // part, and a rate limit or an exhausted balance must not throw it
      // away and send the job round the SQS retry loop to be re-scanned.
      if (ANTHROPIC_API_KEY_PARAM && report.violations.length > 0) {
        try {
          const client = await getAnthropicClient()
          const { explanations, usage } = await explainViolations(report.violations, { client })
          report.explanations = explanations
          console.log(
            `explained ${Object.keys(explanations).length} violation(s) for ${jobId} — ` +
              `${usage.input_tokens} in / ${usage.output_tokens} out tokens`
          )
        } catch (err) {
          // APIConnectionError's message is the useless constant string
          // "Connection error." — the actual failure (ENOTFOUND, ECONNREFUSED,
          // a TLS error, an abort) is only ever on err.cause. Log the chain,
          // or a network problem is indistinguishable from any other.
          const parts = [`${err.name}: ${err.message}`]
          if (err.status) parts.push(`status=${err.status}`)
          for (let c = err.cause, depth = 0; c && depth < 3; c = c.cause, depth++) {
            parts.push(`cause[${depth}]=${c.code ?? c.name ?? ''} ${c.message ?? c}`)
          }
          console.error(`explain step failed for ${jobId} (report saved without it): ${parts.join(' | ')}`)
        }
      }

      const reportKey = `reports/${jobId}.json`
      await s3.send(
        new PutObjectCommand({
          Bucket: REPORTS_BUCKET,
          Key: reportKey,
          Body: JSON.stringify(report, null, 2),
          ContentType: 'application/json',
        })
      )

      await markDone(jobId, reportKey, report.summary)
    } catch (err) {
      await markFailed(jobId, err.message)
      throw err // let SQS retry / route to the DLQ after maxReceiveCount
    }
  }
}
