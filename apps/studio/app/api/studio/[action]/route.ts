import { teamTask } from '../../../../../../packages/runtime/team.ts'
import { upload } from '../../../../../../packages/runtime/media.ts'
import { authenticate, cms, logout } from '../../../../auth.ts'
import { database } from '../../../../../../packages/runtime/db.ts'
import { draft, save, prepare, switchRelease } from '../../../../../../packages/runtime/content.ts'
import { applyEdit, decide, enqueue } from '../../../../../../packages/runtime/agents.ts'
import { failure, input, reply } from '../../../../../../packages/runtime/http.ts'
import {
  Problem,
  requestId,
  requireRole,
  stringValue,
} from '../../../../../../packages/runtime/types.ts'

type Context = { params: Promise<{ action: string }> }
export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await authenticate(request)
    const action = (await params).action
    const db = database()
    if (action === 'inbox') {
      requireRole(actor, 'owner', 'operator')
      return reply({
        leads: (await db.query('SELECT * FROM forma.leads ORDER BY created DESC LIMIT 100')).rows,
        tickets: (await db.query('SELECT * FROM forma.tickets ORDER BY created DESC LIMIT 100'))
          .rows,
      })
    }
    if (action !== 'state') throw new Problem(404, 'Нет маршрута')
    if (actor.role === 'operator') return reply({ actor })
    const [current, site, releases, jobs, roles, switches, articles, team] = await Promise.all([
      draft(),
      db.query('SELECT * FROM forma.site'),
      db.query('SELECT id,created FROM forma.releases ORDER BY created DESC LIMIT 20'),
      db.query(
        'SELECT j.*,d.page FROM forma.jobs j JOIN forma.drafts d USING(revision) ORDER BY j.created DESC LIMIT 20',
      ),
      db.query('SELECT name FROM forma.roles ORDER BY activated'),
      db.query('SELECT id,status,target FROM forma.switches ORDER BY created DESC LIMIT 10'),
      db.query('SELECT * FROM forma.articles ORDER BY title LIMIT 100'),
      db.query('SELECT * FROM forma.team_tasks ORDER BY created DESC LIMIT 40'),
    ])
    return reply({
      actor,
      ...current,
      site: site.rows[0],
      releases: releases.rows,
      jobs: jobs.rows.map(({ page, ...job }) => {
        const block = page.widgets.find((b: { id: string }) => b.id === job.block_id)
        const after = job.result
          ? applyEdit(page, job.block_id, job.result).widgets.find((b) => b.id === job.block_id)
          : null
        return { ...job, before: block?.content.props, after: after?.content.props }
      }),
      roles: roles.rows,
      switches: switches.rows,
      articles: articles.rows,
      team: team.rows,
    })
  } catch (error) {
    return failure(error)
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const origin = process.env.STUDIO_ORIGIN || new URL(request.url).origin
    if (request.headers.get('origin') !== origin)
      throw new Problem(403, 'Источник запроса не разрешён')
    const action = (await params).action
    if (action === 'upload') {
      requireRole(await authenticate(request), 'owner', 'editor')
      return reply({ hash: await upload(request) })
    }
    const body = await input(request)
    const secure = origin.startsWith('https://') ? '; Secure' : ''
    if (action === 'login') {
      const payload = await cms()
      if (typeof body.password !== 'string' || !body.password.length || body.password.length > 512)
        throw new Problem(401, 'Не удалось войти')
      let token
      try {
        ;({ token } = await payload.login({
          collection: 'users',
          data: { email: stringValue(body.email, 254, 'Нужен email'), password: body.password },
        }))
      } catch {
        throw new Problem(401, 'Не удалось войти')
      }
      const res = reply({ ok: true })
      res.headers.set(
        'Set-Cookie',
        'forma-session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600' + secure,
      )
      return res
    }
    if (action === 'logout') {
      await logout(request)
      const res = reply({ ok: true })
      res.headers.set(
        'Set-Cookie',
        'forma-session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' + secure,
      )
      return res
    }
    const actor = await authenticate(request)
    if (action === 'team')
      return reply(await teamTask(actor, body.id, body.role, body.brief, body.parent))
    if (action === 'respond') {
      requireRole(actor, 'owner', 'operator')
      const result = await database().query(
        'UPDATE forma.tickets SET response=$3,reviewer=$4 WHERE channel=$1 AND event_id=$2 AND (response IS NULL OR response=$3) RETURNING event_id',
        [body.channel, body.id, stringValue(body.text, 3000, 'Нужен текст ответа'), actor.id],
      )
      if (!result.rowCount) throw new Problem(409, 'Обращение отсутствует или уже обработано')
      return reply({ ok: true })
    }
    if (action === 'save') return reply(await save(actor, body.revision, body.page))
    if (action === 'preview') return reply(await prepare(actor, body.revision))
    if (action === 'publish')
      return reply(await switchRelease(actor, body.id, body.target, body.epoch))
    if (action === 'task')
      return reply(await enqueue(actor, body.id, body.revision, body.blockId, body.prompt))
    if (action === 'decision' && typeof body.accept === 'boolean')
      return reply(await decide(actor, body.id, body.accept))
    if (action === 'article') {
      requireRole(actor, 'owner')
      const id = requestId(body.id)
      const title = stringValue(body.title, 160, 'Нужно название'),
        content = stringValue(body.body, 4000, 'Нужен текст')
      if (
        !['public', 'internal'].includes(body.audience) ||
        !Number.isFinite(Date.parse(body.validUntil))
      )
        throw new Problem(400, 'Проверьте видимость и срок')
      const result = await database().query(
        `INSERT INTO forma.articles(id,title,body,audience,valid_until)
        SELECT $1,$2,$3,$4,$5 WHERE $6::integer=0 OR EXISTS(SELECT FROM forma.articles WHERE id=$1)
        ON CONFLICT(id) DO UPDATE SET title=$2,body=$3,audience=$4,valid_until=$5,revision=forma.articles.revision+1 WHERE forma.articles.revision=$6 RETURNING id`,
        [id, title, content, body.audience, body.validUntil, body.revision],
      )
      if (!result.rowCount) throw new Problem(409, 'Статья была изменена')
      return reply({ id })
    }
    throw new Problem(404, 'Нет маршрута')
  } catch (error) {
    return failure(error)
  }
}
