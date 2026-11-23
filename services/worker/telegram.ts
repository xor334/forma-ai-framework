import { setTimeout as pause } from 'node:timers/promises'
import { database, transaction } from '../../packages/runtime/db.ts'
const token = process.env.TELEGRAM_TOKEN
if (!token) throw Error('Задайте TELEGRAM_TOKEN')
async function telegram(method: string, data: object) {
  const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    redirect: 'error',
    signal: AbortSignal.timeout(40000),
  })
  if (!response.ok) throw Error('Канал недоступен')
  const result = await response.json()
  if (!result.ok) throw Error('Канал отклонил запрос')
  return result.result
}
while (true) {
  try {
    const outgoing = await transaction(async (db) => {
      const reply = (await db.query('SELECT * FROM forma.telegram_replies ORDER BY id LIMIT 1'))
        .rows[0]
      if (!reply) return null
      const claim = await db.query(
        "UPDATE forma.telegram_events SET state='sending' WHERE id=$1 AND state='recorded' RETURNING id",
        [reply.id],
      )
      return claim.rowCount ? reply : null
    })
    if (outgoing) {
      let state = 'sent'
      try {
        await telegram('sendMessage', { chat_id: outgoing.chat_id, text: outgoing.response })
      } catch {
        state = 'uncertain'
      }
      await database().query('UPDATE forma.telegram_events SET state=$2 WHERE id=$1', [
        outgoing.id,
        state,
      ])
      continue
    }
    const last = (
      await database().query('SELECT coalesce(max(id),-1)+1 AS next FROM forma.telegram_events')
    ).rows[0]
    const events = await telegram('getUpdates', {
      offset: Number(last.next),
      timeout: 25,
      allowed_updates: ['message'],
    })
    for (const event of events) {
      const text = event.message?.text
      const decision = await transaction(async (db) => {
        const inserted = await db.query(
          "INSERT INTO forma.telegram_events(id,state,chat_id) VALUES($1,'recorded',$2) ON CONFLICT DO NOTHING RETURNING id",
          [
            event.update_id,
            event.message?.chat?.type === 'private' ? String(event.message.chat.id) : null,
          ],
        )
        if (!inserted.rowCount || !text || event.message.chat.type !== 'private') return null
        const row = (
          await db.query("SELECT * FROM forma.ask('telegram',$1,$2)", [
            String(event.update_id),
            text.slice(0, 1000),
          ])
        ).rows[0]
        if (process.env.TELEGRAM_AUTO_REPLY !== 'true' || !row) return null
        await db.query("UPDATE forma.telegram_events SET state='sending' WHERE id=$1", [
          event.update_id,
        ])
        return {
          chat_id: event.message.chat.id,
          text: (row.body + ' · ' + row.title).slice(0, 4096),
        }
      })
      if (decision) {
        let state = 'sent'
        try {
          await telegram('sendMessage', decision)
        } catch {
          state = 'uncertain'
        }
        await database().query('UPDATE forma.telegram_events SET state=$2 WHERE id=$1', [
          event.update_id,
          state,
        ])
      }
    }
  } catch {
    console.error('Канал ожидает восстановления связи')
    await pause(2000)
  }
}
