import { database, transaction } from './db.ts'
import { appendDraft, checkPage, draft } from './content.ts'
import { Actor, Page, Problem, requireRole, requestId, stringValue } from './types.ts'

export function applyEdit(page: Page, blockId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || !('field' in raw) || !('value' in raw))
    throw new Problem(422, 'Нужны поле и значение')
  const copy = structuredClone(page)
  const block = copy.widgets.find((w) => w.id === blockId)
  if (!block) throw new Problem(409, 'Блок больше не существует')
  const props = block.content.props
  const value = stringValue(raw.value, 700, 'Некорректный текст')
  if (raw.field === 'buttonLabel' && props.action) props.action.label = value
  else if (
    (raw.field === 'title' || raw.field === 'body' || raw.field === 'schedule') &&
    typeof props[raw.field] === 'string'
  )
    props[raw.field] = value
  else throw new Problem(422, 'Поле недоступно для этого блока')
  checkPage(copy)
  return copy
}
export async function enqueue(
  actor: Actor,
  id: string,
  revision: number,
  blockId: string,
  prompt: string,
) {
  requireRole(actor, 'owner', 'editor')
  requestId(id)
  prompt = stringValue(prompt, 2000, 'Задача должна содержать до 2000 символов')
  const row = (
    await database().query('SELECT page FROM forma.drafts WHERE revision=$1', [revision])
  ).rows[0]
  if (!row?.page.widgets.some((b: { id: string }) => b.id === blockId))
    throw new Problem(404, 'Блок или ревизия отсутствуют')
  await database().query(
    'INSERT INTO forma.jobs(id,revision,block_id,prompt,actor) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [id, revision, blockId, prompt, actor.id],
  )
  const job = (await database().query('SELECT * FROM forma.jobs WHERE id=$1', [id])).rows[0]
  if (
    job.prompt !== prompt ||
    job.actor !== actor.id ||
    job.block_id !== blockId ||
    job.revision !== revision
  )
    throw new Problem(409, 'Ключ задачи уже использован')
  return job
}
export async function decide(actor: Actor, id: string, accept: boolean) {
  requireRole(actor, 'owner')
  return transaction(async (db) => {
    const job = (await db.query('SELECT * FROM forma.jobs WHERE id=$1 FOR UPDATE', [requestId(id)]))
      .rows[0]
    if (!job) throw new Problem(404, 'Задача не найдена')
    const status = accept ? 'applied' : 'rejected'
    if (job.status === status) return { status, revision: job.applied_revision }
    if (job.status !== 'proposed')
      throw new Problem(409, 'Предложение уже обработано или ещё не готово')
    let revision = null
    if (accept) {
      const row = (
        await db.query('SELECT page FROM forma.drafts WHERE revision=$1', [job.revision])
      ).rows[0]
      await db.query('SELECT pg_advisory_xact_lock(7640832)')
      const latest = await draft(db)
      const before = row.page.widgets.find(
        (b: Page['widgets'][number]) => b.id === job.block_id,
      )?.content
      const current = latest.page.widgets.find((b) => b.id === job.block_id)?.content
      const field = job.result.field
      const value = (content: typeof current) =>
        field === 'buttonLabel' ? content?.props.action : content?.props[field]
      if (
        !current ||
        !before ||
        current.type !== before.type ||
        current.version !== before.version ||
        JSON.stringify(value(before)) !== JSON.stringify(value(current))
      )
        throw new Problem(409, 'Черновик изменился в выбранном свойстве')
      revision = (
        await appendDraft(
          db,
          latest.revision,
          applyEdit(latest.page, job.block_id, job.result),
          actor.id,
        )
      ).revision
    }
    await db.query(
      'UPDATE forma.jobs SET status=$2,decided_by=$3,applied_revision=$4 WHERE id=$1',
      [id, status, actor.id, revision],
    )
    return { status, revision }
  })
}
export type Generate = (prompt: string, block: Page['widgets'][number]) => Promise<unknown>
export async function runJob(generate: Generate) {
  const claim = await database()
    .query(`UPDATE forma.jobs SET status='working',attempt=attempt+1,lease_until=now()+interval '2 minutes'
    WHERE id=(SELECT id FROM forma.jobs WHERE status='queued' OR (status='working' AND lease_until < now()) ORDER BY created LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)
  const job = claim.rows[0]
  if (!job) return false
  try {
    if (job.attempt > 3) throw Error('Исчерпан лимит попыток')
    const page: Page = (
      await database().query('SELECT page FROM forma.drafts WHERE revision=$1', [job.revision])
    ).rows[0].page
    const block = page.widgets.find((b) => b.id === job.block_id)!
    const result = await generate(job.prompt, block)
    applyEdit(page, block.id, result)
    const { field, value } = result as { field: string; value: string }
    await database().query(
      "UPDATE forma.jobs SET status='proposed',result=$3 WHERE id=$1 AND attempt=$2 AND status='working'",
      [job.id, job.attempt, { field, value }],
    )
  } catch {
    await database().query(
      "UPDATE forma.jobs SET status='failed',error='Модель не вернула допустимую правку' WHERE id=$1 AND attempt=$2",
      [job.id, job.attempt],
    )
  }
  return true
}
