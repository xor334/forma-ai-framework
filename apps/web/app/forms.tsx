'use client'
import { useRef, useState } from 'react'
export default function Forms() {
  return (
    <aside
      aria-label="Обратная связь"
      style={{ maxWidth: '63rem', margin: '2rem auto', padding: '1rem' }}
    >
      <Form chat={false} />
      <Form chat />
    </aside>
  )
}
function Form({ chat }: { chat: boolean }) {
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const [ticket, setTicket] = useState('')
  const retry = useRef({ key: '', body: '' })
  return (
    <form
      style={{ display: 'grid', gap: 10, maxWidth: 520, marginBottom: 28 }}
      onSubmit={async (e) => {
        e.preventDefault()
        const form = e.currentTarget
        const data = Object.fromEntries(new FormData(form))
        const body = JSON.stringify(data)
        if (body !== retry.current.body) retry.current = { key: crypto.randomUUID(), body }
        setBusy(true)
        try {
          const res = await fetch('/api/v1/' + (chat ? 'chat' : 'leads'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, id: retry.current.key }),
          })
          const result = await res.json()
          if (!res.ok) throw Error(result.error)
          setStatus(
            chat ? result.answer + (result.source ? ' · ' + result.source : '') : 'Заявка принята',
          )
          if (chat) setTicket(retry.current.key)
          form.reset()
          retry.current = { key: '', body: '' }
        } catch (e) {
          setStatus((e as Error).message)
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2>{chat ? 'Спросить команду' : 'Оставить заявку'}</h2>
      {!chat && (
        <label>
          Как с вами связаться <input required maxLength={240} name="contact" />
        </label>
      )}
      <label>
        {chat ? 'Ваш вопрос' : 'Сообщение'}{' '}
        <textarea name={chat ? 'question' : 'message'} required maxLength={chat ? 1000 : 2000} />
      </label>
      <button disabled={busy}>Отправить</button>{' '}
      {chat && ticket && (
        <button
          type="button"
          onClick={async () => {
            try {
              const r = await fetch('/api/v1/reply?id=' + ticket)
              const data = await r.json()
              if (!r.ok) throw Error(data.error)
              setStatus(data.answer || 'Ответ готовится')
            } catch (e) {
              setStatus((e as Error).message)
            }
          }}
        >
          Проверить ответ команды
        </button>
      )}
      <output aria-live="polite">{status}</output>
    </form>
  )
}
