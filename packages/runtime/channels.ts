import { database } from './db.ts'
import { requestId, stringValue } from './types.ts'
export async function lead(key: string, contact: string, message: string) {
  await database().query('SELECT forma.submit_lead($1,$2,$3)', [
    requestId(key),
    stringValue(contact, 240, 'Укажите контакт'),
    stringValue(message, 2000, 'Укажите сообщение'),
  ])
  return { id: key }
}
export async function ask(channel: 'web' | 'telegram', id: string, question: string) {
  const result = await database().query('SELECT * FROM forma.ask($1,$2,$3)', [
    channel,
    stringValue(id, 240, 'Нужен ID'),
    stringValue(question, 1000, 'Укажите вопрос'),
  ])
  let article = result.rows[0]
  if (!article && process.env.SEMANTIC_URL) {
    try {
      const r = await fetch(new URL('/search', process.env.SEMANTIC_URL), {
        method: 'POST',
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(4000),
        redirect: 'error',
      })
      const hit = r.ok ? await r.json() : null
      if (hit)
        article = (
          await database().query('SELECT * FROM forma.public_citation($1,$2)', [
            hit.id,
            hit.revision,
          ])
        ).rows[0]
    } catch {
      /* The ticket is already recorded for a human response. */
    }
  }
  return article
    ? { answer: article.body, source: article.title }
    : { answer: 'Вопрос передан команде.', source: null }
}
