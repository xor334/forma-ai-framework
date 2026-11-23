import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Page, Problem } from './types.ts'
const maxBytes = 8 * 1024 * 1024
let client: S3Client
export function objects() {
  if (!process.env.S3_ENDPOINT || !process.env.S3_BUCKET)
    throw new Problem(503, 'Настройте хранилище медиа')
  return (client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    region: 'us-east-1',
    requestChecksumCalculation: 'WHEN_REQUIRED',
  }))
}
function mime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  throw new Problem(415, 'Поддерживаются PNG и JPEG')
}
export async function upload(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Problem(400, 'Нужен файл')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const p = await reader.read()
      if (p.done) break
      size += p.value.length
      if (size > maxBytes) {
        await reader.cancel()
        throw new Problem(413, 'Файл больше 8 МБ')
      }
      parts.push(p.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = Buffer.concat(parts),
    type = mime(body),
    hash = createHash('sha256').update(body).digest('hex')
  if (process.env.FORMA_LOCAL_MEDIA) {
    await mkdir(process.env.FORMA_LOCAL_MEDIA, { recursive: true, mode: 0o700 })
    try {
      await writeFile(join(process.env.FORMA_LOCAL_MEDIA, hash), body, { flag: 'wx', mode: 0o600 })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    return hash
  }
  await objects().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: hash,
      Body: body,
      ContentType: type,
    }),
  )
  return hash
}
export function mediaKeys(page: Page): string[] {
  const keys = new Set<string>()
  for (const widget of page.widgets) {
    for (const content of [widget.content, widget.fallback]) {
      const hash = content?.props.mediaHash
      if (content?.type === 'forma.image' && typeof hash === 'string') keys.add(hash)
    }
  }
  return [...keys].sort()
}
export async function readMedia(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Problem(404, 'Файл не найден')
  if (process.env.FORMA_LOCAL_MEDIA) {
    const bytes = await readFile(join(process.env.FORMA_LOCAL_MEDIA, key))
    if (createHash('sha256').update(bytes).digest('hex') !== key)
      throw new Problem(422, 'Повреждённый файл')
    return { bytes, type: mime(bytes) }
  }
  const object = await objects().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  )
  if (!object.Body || !object.ContentLength || object.ContentLength > maxBytes)
    throw new Problem(422, 'Повреждённый файл')
  const bytes = Buffer.from(await object.Body.transformToByteArray())
  if (createHash('sha256').update(bytes).digest('hex') !== key)
    throw new Problem(422, 'Не совпала контрольная сумма файла')
  return { bytes, type: mime(bytes) }
}
export async function mediaResponse(page: Page, key: string) {
  if (!mediaKeys(page).includes(key)) throw new Problem(404, 'Файл не опубликован в этой версии')
  const { bytes, type } = await readMedia(key)
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
}
