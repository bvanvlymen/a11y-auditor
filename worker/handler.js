// M2 worker Lambda — triggered by SQS. One message = one audit job.
// batch_size is 1 (see infra/lambda_worker.tf), so event.Records always
// has exactly one entry.

import chromium from '@sparticuz/chromium'
import { chromium as playwrightChromium } from 'playwright-core'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { runAudit } from './lib/scan.js'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const s3 = new S3Client({})

const JOBS_TABLE = process.env.JOBS_TABLE
const REPORTS_BUCKET = process.env.REPORTS_BUCKET

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
