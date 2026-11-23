import { database, transaction } from './db.ts'
import { Actor, Problem, requestId, requireRole, stringValue } from './types.ts'
const directions: Record<string, string> = {
  marketing: 'Предложи одну проверяемую гипотезу и метрику. Укажи какие данные нужны для проверки.',
  analytics:
    'Объясни показатели за указанный период. Назови число наблюдений и ограничения. Не вычисляй конверсию без знаменателя.',
  support:
    'Подготовь ответ на согласование человеку. Используй только предоставленные статьи с названием источника, при недостатке данных предложи эскалацию.',
  developer:
    'Дай план изменения проекта с проверяемым условием готовности. Изменения кода владелец может подготовить командой ai:propose.',
}
export async function teamTask(
  actor: Actor,
  id: string,
  role: string,
  brief: string,
  parent?: string,
) {
  requireRole(actor, 'owner', 'editor')
  requestId(id)
  brief = stringValue(brief, 2000, 'Сформулируйте задачу до 2000 символов')
  if (!Object.hasOwn(directions, role)) throw new Problem(400, 'Неизвестная роль')
  return transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7640837)')
    const prior = (await db.query('SELECT * FROM forma.team_tasks WHERE id=$1', [id])).rows[0]
    if (prior) {
      if (
        prior.brief !== brief ||
        prior.role !== role ||
        prior.parent !== (parent ?? null) ||
        prior.actor !== actor.id
      )
        throw new Problem(409, 'Ключ занят')
      return prior
    }
    if (!(await db.query('SELECT FROM forma.roles WHERE name=$1', [role])).rowCount)
      throw new Problem(409, 'Роль ещё не активирована')
    const previous = parent
      ? (await db.query('SELECT * FROM forma.team_tasks WHERE id=$1', [requestId(parent)])).rows[0]
      : null
    if (
      parent &&
      (!previous ||
        previous.state !== 'ready' ||
        previous.depth >= 3 ||
        previous.deadline <= new Date())
    )
      throw new Problem(409, 'Передача недоступна')
    return (
      await db.query(
        "INSERT INTO forma.team_tasks(id,role,brief,actor,parent,depth,deadline) VALUES($1,$2,$3,$4,$5,$6,coalesce($7,now()+interval '1 hour')) RETURNING *",
        [
          id,
          role,
          brief,
          actor.id,
          parent ?? null,
          previous ? previous.depth + 1 : 0,
          previous?.deadline ?? null,
        ],
      )
    ).rows[0]
  })
}
export async function runTeam(generate: (instruction: string, context: object) => Promise<string>) {
  const db = database()
  await db.query(
    "UPDATE forma.team_tasks SET state='stopped' WHERE state IN ('queued','working') AND deadline<=now()",
  )
  const row = (
    await db.query(`UPDATE forma.team_tasks SET state='working',lease_until=now()+interval '2 minutes',attempt=attempt+1
    WHERE id=(SELECT id FROM forma.team_tasks WHERE state='queued' OR (state='working' AND lease_until<now()) ORDER BY created LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)
  ).rows[0]
  if (!row) return false
  try {
    if (row.attempt > 2) throw Error()
    const prior = row.parent
      ? (await db.query('SELECT role,result FROM forma.team_tasks WHERE id=$1', [row.parent]))
          .rows[0]
      : null
    const facts =
      row.role === 'support'
        ? (await db.query('SELECT title,body FROM forma.public_knowledge ORDER BY title LIMIT 4'))
            .rows
        : (await db.query('SELECT * FROM forma.weekly_totals')).rows
    const result = stringValue(
      await generate(directions[row.role], { task: row.brief, prior, facts }),
      8000,
      'Некорректный ответ',
    )
    await db.query(
      "UPDATE forma.team_tasks SET state='ready',result=$3 WHERE id=$1 AND attempt=$2 AND state='working' AND deadline>now()",
      [row.id, row.attempt, result],
    )
  } catch {
    await db.query("UPDATE forma.team_tasks SET state='stopped' WHERE id=$1 AND attempt=$2", [
      row.id,
      row.attempt,
    ])
  }
  return true
}
