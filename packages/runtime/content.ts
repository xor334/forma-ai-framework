import settings from '../../business/extensions.json' with { type: 'json' }
import { compileExtensions } from '../../business/extensions/index.mjs'
import { mediaKeys, readMedia } from './media.ts'
import { signDecision } from './approval.ts'
import { manifestId, manifestOf } from './manifest.ts'
import type { PoolClient } from 'pg'
import { database, transaction } from './db.ts'
import { makeRelease } from '../widget-contract/contract.mjs'
import { Actor, Draft, Page, Problem, requireRole, requestId } from './types.ts'

export async function draft(db: Pick<PoolClient, 'query'> = database()): Promise<Draft> {
  const result = await db.query(
    'SELECT revision,page FROM forma.drafts ORDER BY revision DESC LIMIT 1',
  )
  if (!result.rowCount) throw new Problem(503, 'Нужно выполнить миграцию')
  return result.rows[0]
}
export function checkPage(page: Page) {
  try {
    return makeRelease(page)
  } catch (error) {
    throw new Problem(422, (error as Error).message)
  }
}
export async function appendDraft(db: PoolClient, base: number, page: Page, author: string) {
  checkPage(page)
  await db.query('SELECT pg_advisory_xact_lock(7640832)')
  const last = await draft(db)
  if (last.revision !== base)
    throw new Problem(409, 'Черновик изменился. Сверьте правку с новой ревизией.')
  if (last.page.pageId !== page.pageId) throw new Problem(422, 'ID страницы должен сохраняться')
  const revision = base + 1
  await db.query('INSERT INTO forma.drafts(revision,page,author) VALUES ($1,$2,$3)', [
    revision,
    page,
    author,
  ])
  return { revision, page }
}
export function save(actor: Actor, base: number, page: Page) {
  requireRole(actor, 'owner', 'editor')
  return transaction((db) => appendDraft(db, base, page, actor.id))
}
export async function prepare(actor: Actor, base: number) {
  requireRole(actor, 'owner', 'editor')
  const result = await database().query('SELECT page FROM forma.drafts WHERE revision=$1', [base])
  if (!result.rowCount) throw new Problem(404, 'Ревизия не найдена')
  const snapshot = checkPage(compileExtensions(result.rows[0].page, settings))
  const media = mediaKeys(snapshot.page)
  for (const hash of media) await readMedia(hash)
  const manifest = manifestOf(snapshot)
  const id = manifestId(manifest)
  await database().query(
    'INSERT INTO forma.releases(id,snapshot,manifest) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [id, snapshot, manifest],
  )
  return { id, snapshot, manifest }
}
export async function switchRelease(actor: Actor, key: string, target: string, epoch: number) {
  requireRole(actor, 'owner')
  requestId(key)
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7640833)')
    const prior = await db.query('SELECT * FROM forma.switches WHERE id=$1', [key])
    if (prior.rowCount) {
      const row = prior.rows[0]
      if (row.target !== target || row.actor !== actor.id || row.base_epoch !== epoch)
        throw new Problem(409, 'Ключ уже использован')
      return row
    }
    const site = (await db.query('SELECT * FROM forma.site')).rows[0]
    if (site.epoch !== epoch) throw new Problem(409, 'Активный выпуск изменился')
    if (!(await db.query('SELECT FROM forma.releases WHERE id=$1', [target])).rowCount)
      throw new Problem(404, 'Снимок не найден')
    if (
      (await db.query("SELECT FROM forma.switches WHERE status IN ('queued','checking')")).rowCount
    )
      throw new Problem(409, 'Уже идёт выпуск')
    const signature = signDecision({ id: key, target, epoch, actor: actor.id })
    return (
      await db.query(
        "INSERT INTO forma.switches(id,target,old_id,base_epoch,actor,status,signature) VALUES($1,$2,$3,$4,$5,'queued',$6) RETURNING *",
        [key, target, site.active, epoch, actor.id, signature],
      )
    ).rows[0]
  })
}
export async function published() {
  const result = await database().query('SELECT id,snapshot FROM forma.live')
  if (!result.rowCount) throw new Problem(503, 'Страница ожидает первого выпуска')
  return result.rows[0] as { id: string; snapshot: { id: string; page: Page } }
}
