// M2 API Lambda, behind a Lambda Function URL (same payload shape as API
// Gateway HTTP API v2). POST submits a job, GET checks its status.

import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const sqs = new SQSClient({})

const JOBS_TABLE = process.env.JOBS_TABLE
const QUEUE_URL = process.env.QUEUE_URL
const JOB_TTL_SECONDS = 90 * 24 * 60 * 60 // 90 days

const PRIVATE_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1'])

// Basic guard against obviously-internal targets (loopback, RFC1918,
// link-local incl. the cloud metadata address). Not DNS-rebinding-proof —
// that's a follow-up hardening item, not in scope for M2.
function isPrivateIpLiteral(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const [a, b] = match.slice(1).map(Number)
  if (a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

function isSafeUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname.toLowerCase()
  if (PRIVATE_HOSTNAMES.has(hostname)) return false
  if (isPrivateIpLiteral(hostname)) return false
  return true
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function handleSubmit(event) {
  let payload
  try {
    payload = JSON.parse(event.body ?? '{}')
  } catch {
    return json(400, { error: 'body must be valid JSON' })
  }

  if (typeof payload.url !== 'string' || !isSafeUrl(payload.url)) {
    return json(400, { error: 'url must be a valid http(s) URL' })
  }

  const jobId = randomUUID()
  const now = new Date().toISOString()

  await ddb.send(
    new PutCommand({
      TableName: JOBS_TABLE,
      Item: {
        jobId,
        url: payload.url,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        expiresAt: Math.floor(Date.now() / 1000) + JOB_TTL_SECONDS,
      },
    })
  )

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ jobId, url: payload.url }),
    })
  )

  return json(202, { jobId })
}

async function handleStatus(event) {
  const jobId = event.queryStringParameters?.jobId
  if (!jobId) return json(400, { error: 'jobId query parameter is required' })

  const { Item } = await ddb.send(new GetCommand({ TableName: JOBS_TABLE, Key: { jobId } }))
  if (!Item) return json(404, { error: 'job not found' })

  return json(200, Item)
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method
  if (method === 'POST') return handleSubmit(event)
  if (method === 'GET') return handleStatus(event)
  return json(405, { error: 'method not allowed' })
}
