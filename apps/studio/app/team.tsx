'use client'
import { useState } from 'react'
type Task = {
  id: string
  role: string
  brief: string
  result: string | null
  state: string
  depth: number
  parent: string | null
}
const names: Record<string, string> = {
  developer: 'Разработчик',
  marketing: 'Маркетолог',
  analytics: 'Аналитик',
  support: 'Поддержка',
}
export default function Team({
  roles,
  tasks,
  create,
  refresh,
}: {
  roles: { name: string }[]
  tasks: Task[]
  create: (body: object) => Promise<void>
  refresh: () => void
}) {
  const [parent, setParent] = useState(''),
    [brief, setBrief] = useState(''),
    [role, setRole] = useState('developer'),
    [notice, setNotice] = useState('')
  return (
    <main className="panel">
      <h1>Команда проекта</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await create({ id: crypto.randomUUID(), role, brief, parent: parent || undefined })
            setBrief('')
            setParent('')
            setNotice('Задача принята')
          } catch (e) {
            setNotice((e as Error).message)
          }
        }}
      >
        <label>
          Исполнитель
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {names[r.name]}
              </option>
            ))}
          </select>
        </label>
        {parent && (
          <p>
            Передача результата задачи {parent}{' '}
            <button type="button" onClick={() => setParent('')}>
              Отменить передачу
            </button>
          </p>
        )}
        <label>
          Поручение
          <textarea
            value={brief}
            maxLength={2000}
            onChange={(e) => setBrief(e.target.value)}
            required
          />
        </label>
        <button>Создать задачу</button>
        <output>{notice}</output>
      </form>
      <button onClick={refresh}>Обновить задачи</button>
      {tasks.map((t) => (
        <section key={t.id}>
          <small>
            {names[t.role]} · {t.state}
          </small>
          <h2>{t.brief}</h2>
          {t.result && <p style={{ whiteSpace: 'pre-wrap' }}>{t.result}</p>}
          {t.state === 'ready' && t.depth < 3 && !tasks.some((x) => x.parent === t.id) && (
            <button onClick={() => setParent(t.id)}>Передать результат</button>
          )}
        </section>
      ))}
    </main>
  )
}
