import { createHash } from 'node:crypto'
import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { objects } from '../packages/runtime/media.ts'
const Bucket = process.env.S3_BUCKET
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex')
if (process.argv[2] === 'export') {
  let token: string | undefined
  do {
    const list = await objects().send(
      new ListObjectsV2Command({ Bucket, ContinuationToken: token }),
    )
    for (const { Key } of list.Contents ?? []) {
      if (!Key || !/^[0-9a-f]{64}$/.test(Key)) throw Error('Чужой объект в бакете проекта')
      const item = await objects().send(new GetObjectCommand({ Bucket, Key }))
      const body = Buffer.from(await item.Body!.transformToByteArray())
      if (digest(body) !== Key) throw Error('Повреждён объект ' + Key)
      if (
        !process.stdout.write(
          JSON.stringify({ hash: Key, mime: item.ContentType, body: body.toString('base64') }) +
            '\n',
        )
      )
        await once(process.stdout, 'drain')
    }
    token = list.NextContinuationToken
  } while (token)
} else if (process.argv[2] === 'import') {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const row = JSON.parse(line),
      body = Buffer.from(row.body, 'base64')
    if (digest(body) !== row.hash) throw Error('Не совпала контрольная сумма')
    await objects().send(
      new PutObjectCommand({ Bucket, Key: row.hash, ContentType: row.mime, Body: body }),
    )
  }
} else throw Error('Нужен режим export или import')
