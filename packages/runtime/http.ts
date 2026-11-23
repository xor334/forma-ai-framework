import { Problem } from './types.ts'
export function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
export function failure(error: unknown) {
  if (error instanceof Problem) return reply({ error: error.message }, error.status)
  if ((error as { code?: string })?.code === '23505')
    return reply({ error: 'Ключ операции уже использован' }, 409)
  return reply({ error: 'Служба временно недоступна' }, 503)
}
export async function input(request: Request, limit = 300_000) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new Problem(415, 'Нужен JSON')
  const reader = request.body?.getReader()
  if (!reader) throw new Problem(400, 'Пустой запрос')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.length
      if (bytes > limit) {
        await reader.cancel()
        throw new Problem(413, 'Слишком большой запрос')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString())
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error()
    return data
  } catch {
    throw new Problem(400, 'Некорректный объект JSON')
  }
}
