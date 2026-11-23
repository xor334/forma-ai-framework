'use client'
import Team from './team'
import CanvasBlock from './canvas'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Actor, Block, Page, Size } from '../../../packages/runtime/types'
import { pageForSchema, layoutAt } from '../../../packages/widget-contract/layout.mjs'

type Job = {
  id: string
  prompt: string
  status: string
  block_id: string
  before: object
  after?: object
  result?: { field: string; value: string }
}
type Article = {
  id: string
  title: string
  body: string
  audience: string
  valid_until: string
  revision: number
}
type State = {
  actor: Actor
  page: Page
  revision: number
  site: { active: string; previous: string; epoch: number }
  roles: { name: string }[]
  team: React.ComponentProps<typeof Team>['tasks']
  jobs: Job[]
  switches: { id: string; status: string }[]
  articles: Article[]
}
async function api(action: string, body?: object) {
  const res = await fetch(
    '/api/studio/' + action,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache: 'no-store' },
  )
  const result = await res.json()
  if (!res.ok) throw Object.assign(Error(result.error), { status: res.status })
  return result
}
const devices: Size[] = ['phone', 'tablet', 'wide']
const deviceName = { phone: 'Телефон', tablet: 'Планшет', wide: 'Компьютер' }
export default function Studio() {
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page | null>(null)
  const [selected, select] = useState(''),
    [size, setSize] = useState<Size>('wide')
  const [notice, tell] = useState(''),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false)
  const [mobilePanel, setMobilePanel] = useState('Холст')
  const [candidate, preview] = useState(''),
    [tab, setTab] = useState('Страница'),
    [task, setTask] = useState('')
  const [inbox, setInbox] = useState<{
    leads: { id: string; contact: string; message: string }[]
    tickets: { event_id: string; channel: string; question: string; response: string | null }[]
  } | null>(null)
  const local = useRef<Page | null>(null),
    base = useRef(0),
    saved = useRef<Page | null>(null),
    undo = useRef<Page[]>([])
  const queue = useRef<Promise<void>>(Promise.resolve()),
    drag = useRef(''),
    blocked = useRef(false)
  function load(data: State) {
    setState(data)
    local.current = data.page || null
    saved.current = local.current
    setPage(local.current)
    base.current = data.revision
    select((id) =>
      data.page?.widgets.some((b) => b.id === id) ? id : data.page?.widgets[0]?.id || '',
    )
    undo.current = []
    setDirty(false)
    blocked.current = false
    setConflict(false)
  }
  useEffect(() => {
    api('state')
      .then(load)
      .catch((e) => {
        if (e.status !== 401) tell(e.message)
      })
  }, [])
  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => tell(e.message))
  }
  const refresh = async () => setState(await api('state'))
  const flush = useCallback(() => {
    const persist = async () => {
      if (blocked.current) throw Error('Сначала загрузите новую ревизию')
      const next = local.current
      if (!next || next === saved.current) return
      try {
        const out = await api('save', { page: next, revision: base.current })
        base.current = out.revision
        saved.current = next
        setDirty(local.current !== next)
        tell('Сохранено')
      } catch (e) {
        if ((e as { status: number }).status === 409) {
          blocked.current = true
          setConflict(true)
        }
        throw e
      }
    }
    queue.current = queue.current.catch(() => {}).then(persist)
    return queue.current
  }, [])
  useEffect(() => {
    if (!dirty || conflict) return
    const timer = setTimeout(() => run(flush), 650)
    return () => clearTimeout(timer)
  }, [page, dirty, conflict, flush])
  function replace(value: Page) {
    local.current = value
    setPage(value)
    setDirty(true)
    preview('')
  }
  function edit(change: (p: Page) => void) {
    if (!local.current || blocked.current) return
    const before = local.current,
      copy = structuredClone(before)
    change(copy)
    undo.current.push(before)
    replace(copy)
  }
  function move(id: string, to: number) {
    edit((p) => {
      const i = p.widgets.findIndex((w) => w.id === id)
      if (i < 0) return
      const [b] = p.widgets.splice(i, 1)
      p.widgets.splice(Math.max(0, to), 0, b)
    })
  }
  const block = page?.widgets.find((w) => w.id === selected)
  function changeBlock(fn: (b: Block) => void) {
    edit((p) => fn(p.widgets.find((b) => b.id === selected)!))
  }
  function resize(w: number, h: number, id = selected) {
    edit((p) => {
      Object.assign(p, pageForSchema(p, 2))
      const b = p.widgets.find((b) => b.id === id)!
      b.layout[size] = { ...layoutAt(b.layout, size), widthPercent: w, minHeightPx: h }
    })
  }
  const metrics = block ? layoutAt(block.layout, size) : {},
    width = metrics.widthPercent ?? Math.round(((metrics.span || 12) * 100) / 12)
  const owner = state?.actor.role === 'owner'
  async function publish(target: string) {
    await api('publish', { id: crypto.randomUUID(), epoch: state!.site.epoch, target })
    tell('Выпуск передан на проверку')
    await refresh()
  }
  function resetSession() {
    setState(null)
    setPage(null)
    local.current = null
    saved.current = null
    preview('')
    setInbox(null)
    setTask('')
    tell('')
    setTab('Страница')
  }
  if (!state)
    return (
      <main className="login">
        <p className="brand">Forma</p>
        <h1>Студия проекта</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const data = Object.fromEntries(new FormData(e.currentTarget))
            run(async () => {
              await api('login', data)
              load(await api('state'))
              tell('')
            })
          }}
        >
          <label>
            Электронная почта
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button>Войти</button>
        </form>
        <output>{notice}</output>
      </main>
    )
  const operator = state.actor.role === 'operator'
  const tabs = operator
    ? ['Обращения']
    : ['Страница', 'Предложения', 'Выпуски', 'Команда', 'Знания', ...(owner ? ['Обращения'] : [])]
  return (
    <>
      <header>
        <strong className="brand">Forma</strong>
        <nav>
          {tabs.map((t) => (
            <button
              aria-pressed={tab === t}
              key={t}
              onClick={() => {
                setTab(t)
                run(async () => {
                  if (t === 'Обращения') setInbox(await api('inbox'))
                  else await refresh()
                })
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <button
          onClick={() =>
            run(async () => {
              if (dirty) await flush()
              await api('logout', {})
              resetSession()
            })
          }
        >
          Выйти
        </button>
      </header>
      <div className="status" aria-live="polite">
        {dirty ? 'Есть несохранённые правки' : notice || 'Студия проекта'}
        {dirty && notice ? ' · ' + notice : ''}
        {conflict && (
          <button
            onClick={() =>
              run(async () => {
                load(await api('state'))
                tell('Загружена актуальная ревизия')
              })
            }
          >
            Загрузить актуальную ревизию
          </button>
        )}
      </div>
      {tab === 'Страница' && page && block && (
        <main className="work" data-panel={mobilePanel}>
          <nav className="mobile-tabs" aria-label="Панели редактора">
            {['Холст', 'Блоки', 'Свойства', 'Агент'].map((name) => (
              <button
                key={name}
                aria-pressed={mobilePanel === name}
                onClick={() => setMobilePanel(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          <aside className="library">
            <h2>Блоки</h2>
            {page.widgets.map((b, i) => (
              <button
                key={b.id}
                draggable
                onDragStart={() => {
                  drag.current = b.id
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  move(drag.current, i)
                }}
                className="row"
                aria-pressed={b.id === selected}
                onClick={() => {
                  select(b.id)
                  setMobilePanel('Свойства')
                }}
              >
                {b.content.props.title}
              </button>
            ))}
            <button
              onClick={() => {
                const id = 'block-' + crypto.randomUUID()
                edit((p) =>
                  p.widgets.push({
                    id,
                    required: false,
                    targets: ['web', 'ios', 'android'],
                    layout: { phone: p.schemaVersion === 1 ? { span: 12 } : { widthPercent: 100 } },
                    content: {
                      type: 'forma.text',
                      version: 1,
                      props: { title: 'Новый блок', body: 'Текст блока' },
                    },
                  }),
                )
                select(id)
                setMobilePanel('Свойства')
              }}
            >
              Добавить блок
            </button>
            <label>
              Добавить изображение
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  run(async () => {
                    const response = await fetch('/api/studio/upload', {
                      method: 'POST',
                      body: file,
                    })
                    const data = await response.json()
                    if (!response.ok) throw Error(data.error)
                    const id = 'image-' + crypto.randomUUID(),
                      title = file.name
                    edit((p) => {
                      Object.assign(p, pageForSchema(p, 2))
                      p.widgets.push({
                        id,
                        required: false,
                        targets: ['web', 'ios', 'android'],
                        layout: { phone: { widthPercent: 100 } },
                        content: {
                          type: 'forma.image',
                          version: 1,
                          props: { title, alt: title, mediaHash: data.hash },
                        },
                        fallback: { type: 'forma.text', version: 1, props: { title, body: title } },
                      })
                    })
                    select(id)
                    setMobilePanel('Свойства')
                  })
                }}
              />
            </label>
          </aside>
          <article>
            <div className="toolbar">
              <h1>{page.title}</h1>
              <select
                aria-label="Устройство"
                value={size}
                onChange={(e) => setSize(e.target.value as Size)}
              >
                {devices.map((d) => (
                  <option key={d} value={d}>
                    {deviceName[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className={'canvas ' + size}>
              {page.widgets.map((b) => (
                <CanvasBlock
                  key={b.id}
                  block={b}
                  size={size}
                  selected={b.id === selected}
                  select={() => select(b.id)}
                  resize={resize}
                />
              ))}
            </div>
          </article>
          <aside className="inspector">
            <div className="properties">
              <h2>Свойства блока</h2>
              {(['title', 'body', 'schedule'] as const)
                .filter((k) => typeof block.content.props[k] === 'string')
                .map((k) => (
                  <label key={k}>
                    {{ title: 'Заголовок', body: 'Текст', schedule: 'Расписание' }[k]}
                    <textarea
                      aria-label={{ title: 'Заголовок', body: 'Текст', schedule: 'Расписание' }[k]}
                      value={block.content.props[k]}
                      onChange={(e) =>
                        changeBlock((b) => {
                          b.content.props[k] = e.target.value
                        })
                      }
                    />
                  </label>
                ))}
              {block.content.props.action && (
                <label>
                  Текст кнопки
                  <input
                    value={block.content.props.action.label}
                    onChange={(e) =>
                      changeBlock((b) => {
                        b.content.props.action!.label = e.target.value
                      })
                    }
                  />
                </label>
              )}
              <label>
                Ширина, %
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="any"
                  value={width}
                  onChange={(e) => {
                    if (e.target.validity.valid && e.target.value)
                      resize(+e.target.value, metrics.minHeightPx ?? 0)
                  }}
                />
              </label>
              <label>
                Минимальная высота, px
                <input
                  type="number"
                  min="0"
                  max="4096"
                  value={metrics.minHeightPx ?? 0}
                  onChange={(e) => {
                    if (e.target.validity.valid) resize(width, +e.target.value)
                  }}
                />
              </label>
              <div className="tools">
                {[-1, 1].map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      move(selected, page.widgets.findIndex((b) => b.id === selected) + n)
                    }
                  >
                    {n < 0 ? 'Выше' : 'Ниже'}
                  </button>
                ))}
                <button
                  disabled={!undo.current.length}
                  onClick={() => replace(undo.current.pop()!)}
                >
                  Отменить
                </button>
                <button onClick={() => run(flush)}>Сохранить</button>
              </div>
            </div>
            <div className="agent">
              <label>
                Задача для агента
                <textarea value={task} onChange={(e) => setTask(e.target.value)} />
              </label>
              <button
                disabled={!task.trim()}
                onClick={() =>
                  run(async () => {
                    await flush()
                    await api('task', {
                      id: crypto.randomUUID(),
                      revision: base.current,
                      blockId: selected,
                      prompt: task,
                    })
                    setTask('')
                    setTab('Предложения')
                    await refresh()
                  })
                }
              >
                Предложить правку
              </button>
            </div>
          </aside>
        </main>
      )}
      {tab === 'Предложения' && (
        <main className="panel">
          <h1>Предложения агента</h1>
          <button onClick={() => run(refresh)}>Обновить</button>
          {state.jobs.map((j) => (
            <section key={j.id}>
              <h2>{j.prompt}</h2>
              <p>
                {j.block_id} · {j.status}
              </p>
              {j.after && (
                <div className="diff">
                  <pre>{JSON.stringify(j.before, null, 2)}</pre>
                  <pre>{JSON.stringify(j.after, null, 2)}</pre>
                </div>
              )}
              {owner &&
                j.status === 'proposed' &&
                [true, false].map((accept) => (
                  <button
                    key={String(accept)}
                    onClick={() =>
                      run(async () => {
                        await flush()
                        await api('decision', { id: j.id, accept })
                        load(await api('state'))
                      })
                    }
                  >
                    {accept ? 'Принять' : 'Отклонить'}
                  </button>
                ))}
            </section>
          ))}
        </main>
      )}
      {tab === 'Выпуски' && (
        <main className="panel">
          <h1>Выпуски</h1>
          <button
            onClick={() =>
              run(async () => {
                await flush()
                const r = await api('preview', { revision: base.current })
                preview(r.id)
                await refresh()
              })
            }
          >
            Подготовить предпросмотр
          </button>
          {candidate && (
            <section>
              <code>{candidate}</code>
              <iframe title="Предпросмотр снимка" sandbox="" src={'/preview/' + candidate} />
              {owner && (
                <button onClick={() => run(() => publish(candidate))}>Выпустить этот снимок</button>
              )}
            </section>
          )}
          <p>Активный выпуск · {state.site.active || 'Ожидает публикации'}</p>
          {state.site.previous && owner && (
            <button onClick={() => run(() => publish(state.site.previous))}>
              Вернуть предыдущий выпуск
            </button>
          )}
          <button onClick={() => run(refresh)}>Проверить состояние</button>
          {state.switches.map((s) => (
            <p key={s.id}>
              {s.id} · {s.status}
            </p>
          ))}
        </main>
      )}
      {tab === 'Команда' && (
        <Team
          roles={state.roles}
          tasks={state.team}
          create={async (body) => {
            await api('team', body)
            await refresh()
          }}
          refresh={() => run(refresh)}
        />
      )}
      {tab === 'Знания' && (
        <main className="panel">
          <h1>База знаний</h1>
          {owner && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const f = e.currentTarget,
                  data = Object.fromEntries(new FormData(f))
                run(async () => {
                  await api('article', { ...data, id: crypto.randomUUID(), revision: 0 })
                  f.reset()
                  await refresh()
                })
              }}
            >
              <label>
                Название
                <input required name="title" />
              </label>
              <label>
                Ответ
                <textarea required name="body" />
              </label>
              <label>
                Видимость
                <select name="audience">
                  <option value="internal">Для команды</option>
                  <option value="public">Опубликовано для клиентов</option>
                </select>
              </label>
              <label>
                Актуально до
                <input type="date" required name="validUntil" />
              </label>
              <button>Сохранить статью</button>
            </form>
          )}
          {state.articles.map((a) => (
            <section key={a.id}>
              <h2>{a.title}</h2>
              <p>{a.body}</p>
              <small>{a.audience}</small>
              {owner && a.audience === 'public' && (
                <button
                  onClick={() =>
                    run(async () => {
                      await api('article', {
                        ...a,
                        audience: 'internal',
                        validUntil: a.valid_until,
                      })
                      await refresh()
                    })
                  }
                >
                  Отозвать публикацию
                </button>
              )}
            </section>
          ))}
        </main>
      )}
      {(tab === 'Обращения' || operator) && (
        <main className="panel">
          <h1>Обращения</h1>
          <button onClick={() => run(async () => setInbox(await api('inbox')))}>Обновить</button>
          {inbox?.leads.map((l) => (
            <section key={l.id}>
              <strong>{l.contact}</strong>
              <p>{l.message}</p>
            </section>
          ))}
          {inbox?.tickets.map((t) => (
            <section key={t.channel + t.event_id}>
              {t.channel} · {t.question}
              {t.response ? (
                <p>{t.response}</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const text = new FormData(e.currentTarget).get('text')
                    run(async () => {
                      await api('respond', { channel: t.channel, id: t.event_id, text })
                      setInbox(await api('inbox'))
                    })
                  }}
                >
                  <label>
                    Ответ клиенту
                    <textarea required name="text" />
                  </label>
                  <button>Согласовать ответ</button>
                </form>
              )}
            </section>
          ))}
        </main>
      )}
    </>
  )
}
