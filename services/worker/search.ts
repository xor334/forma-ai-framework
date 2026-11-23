import { createServer } from 'node:http'
import { setTimeout as pause } from 'node:timers/promises'
import { database } from '../../packages/runtime/db.ts'
const endpoint = process.env.EMBEDDING_ENDPOINT,
  model = process.env.EMBEDDING_MODEL
if (!endpoint || !model) throw Error('Нужен отдельный профиль эмбеддингов')
const profile = JSON.stringify([endpoint, model])
async function embed(input: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.EMBEDDING_KEY) headers.Authorization = 'Bearer ' + process.env.EMBEDDING_KEY
  const r = await fetch(endpoint!, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw Error('Ошибка модели')
  const v = (await r.json()).data?.[0]?.embedding
  if (!Array.isArray(v) || !v.length || v.length > 4096 || !v.every(Number.isFinite))
    throw Error('Некорректный вектор')
  return JSON.stringify(v)
}
createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/search') {
    res.writeHead(404).end()
    return
  }
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 6000) {
        res.writeHead(413).end()
        return
      }
      chunks.push(chunk)
    }
    const text = JSON.parse(Buffer.concat(chunks).toString()).question
    if (typeof text !== 'string' || !text.length || text.length > 1000) {
      res.writeHead(400).end()
      return
    }
    const row = (
      await database().query('SELECT * FROM forma.search_public_vector($1::vector,$2,0.78)', [
        await embed(text),
        profile,
      ])
    ).rows[0]
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(row || null))
  } catch {
    res.writeHead(503).end()
  }
}).listen(3110)
while (true) {
  try {
    const row = (
      await database().query(
        'SELECT a.* FROM forma.public_knowledge a LEFT JOIN forma.article_vectors i ON i.article=a.id AND i.revision=a.revision AND i.profile=$1 WHERE i.article IS NULL ORDER BY a.id LIMIT 1',
        [profile],
      )
    ).rows[0]
    if (!row) {
      await pause(3000)
      continue
    }
    const vector = await embed(row.title + '\n' + row.body)
    await database().query(
      'INSERT INTO forma.article_vectors(article,revision,profile,embedding) VALUES($1,$2,$3,$4) ON CONFLICT(article) DO UPDATE SET revision=excluded.revision,profile=excluded.profile,embedding=excluded.embedding',
      [row.id, row.revision, profile, vector],
    )
  } catch {
    await pause(5000)
  }
}
