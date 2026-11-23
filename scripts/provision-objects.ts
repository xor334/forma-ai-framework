import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { setTimeout as pause } from 'node:timers/promises'
import { objects } from '../packages/runtime/media.ts'
const Bucket = process.env.S3_BUCKET
for (let n = 0; ; n++) {
  try {
    try {
      await objects().send(new HeadBucketCommand({ Bucket }))
    } catch {
      await objects().send(new CreateBucketCommand({ Bucket }))
    }
    break
  } catch (error) {
    if (n === 29) throw error
    await pause(2000)
  }
}
