import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { testCluster } from './test-cluster.ts'
import { database, disconnect, transaction } from './db.ts'
import { migrate } from './migrate.ts'
import { draft, save, prepare, switchRelease, published } from './content.ts'
import { decide, enqueue, runJob } from './agents.ts'
import { teamTask, runTeam } from './team.ts'
import { ask, lead } from './channels.ts'
import { advanceRelease } from '../../services/worker/release.ts'
import type { Actor } from './types.ts'
const owner: Actor = { id: '1', role: 'owner' },
  editor: Actor = { id: '2', role: 'editor' }
test('drafts, agent decisions, release recovery, access and channels on PostgreSQL', async (t) => {
  // Missing articles must not fall through to a developer's external embedding provider.
  delete process.env.SEMANTIC_URL
  const pair = generateKeyPairSync('ed25519')
  process.env.APPROVAL_PRIVATE_KEY = pair.privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .toString('base64')
  process.env.APPROVAL_PUBLIC_KEY = pair.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
  const cluster = await testCluster()
  process.env.DATABASE_URL = cluster.url
  t.after(async () => {
    await disconnect()
    await cluster.close()
  })
  await migrate()
  await migrate()
  const initial = await draft()
  const first = await prepare(owner, initial.revision)
  const page = structuredClone(initial.page)
  page.title = 'Черновик 2'
  await save(editor, 1, page)
  await assert.rejects(save(editor, 1, page), /Черновик изменился/)
  await assert.rejects(published(), /ожидает/)
  await assert.rejects(switchRelease(editor, randomUUID(), first.id, 0), /прав/)
  const key = randomUUID()
  await switchRelease(owner, key, first.id, 0)
  assert.equal((await switchRelease(owner, key, first.id, 0)).target, first.id)
  await advanceRelease(async () => true)
  assert.equal((await published()).snapshot.page.title, initial.page.title)
  const second = await prepare(editor, 2),
    contactId = randomUUID()
  await switchRelease(owner, randomUUID(), second.id, 1)
  await advanceRelease(async (id) => {
    assert.equal(id, second.id)
    await lead(contactId, 'контакт', 'вопрос')
    return false
  })
  assert.equal((await published()).id, first.id)
  await lead(contactId, 'контакт', 'вопрос')
  assert.equal((await database().query('SELECT * FROM forma.leads')).rowCount, 1)
  assert.equal((await database().query('SELECT * FROM forma.roles')).rowCount, 4)
  const id = randomUUID(),
    block = page.widgets[0].id
  await enqueue(editor, id, 2, block, 'Поменять кнопку')
  await runJob(async () => ({ field: 'buttonLabel', value: 'Выбрать кофе' }))
  await decide(owner, id, true)
  await decide(owner, id, true)
  const after = await draft()
  assert.equal(after.revision, 3)
  assert.equal(after.page.widgets[0].content.props.action?.label, 'Выбрать кофе')
  const stale = randomUUID()
  await enqueue(editor, stale, 3, block, 'Изменить заголовок')
  await runJob(async () => ({ field: 'title', value: 'Патч' }))
  after.page.widgets[0].content.props.title = 'Ручная правка'
  await save(editor, 3, after.page)
  await assert.rejects(decide(owner, stale, true), /Черновик изменился/)
  await decide(owner, stale, false)
  const independent = randomUUID()
  await enqueue(editor, independent, 4, block, 'Новое название')
  await runJob(async () => ({ field: 'title', value: 'Название от агента' }))
  const manual = (await draft()).page
  manual.title = 'Новое название страницы'
  await save(editor, 4, manual)
  await decide(owner, independent, true)
  assert.equal((await draft()).page.title, 'Новое название страницы')
  assert.equal((await draft()).page.widgets[0].content.props.title, 'Название от агента')
  const task = randomUUID()
  await teamTask(owner, task, 'analytics', 'Подвести итоги')
  await runTeam(async (_instruction, context) => {
    assert.ok('facts' in context)
    return 'За неделю поступила одна заявка'
  })
  const child = await teamTask(owner, randomUUID(), 'marketing', 'Предложить проверку', task)
  assert.equal(child.depth, 1)
  const article = randomUUID()
  await database().query(
    "INSERT INTO forma.articles(id,title,body,audience,valid_until) VALUES($1,'Доставка','До двери','public',now()+interval '1 day')",
    [article],
  )
  const question = randomUUID()
  assert.equal((await ask('web', question, 'Доставка')).source, 'Доставка')
  await database().query("UPDATE forma.articles SET audience='internal' WHERE id=$1", [article])
  assert.equal((await ask('web', question, 'Доставка')).source, null)
  assert.equal((await database().query('SELECT * FROM forma.tickets')).rowCount, 1)
  for (const table of ['drafts', 'jobs', 'leads', 'releases', 'articles']) {
    await assert.rejects(
      transaction(async (db) => {
        await db.query('SET LOCAL ROLE forma_web')
        await db.query('SELECT * FROM forma.' + table)
      }),
      /permission denied/,
    )
  }
  await transaction(async (db) => {
    await db.query('SET LOCAL ROLE forma_web')
    assert.equal((await db.query('SELECT * FROM forma.live')).rowCount, 1)
  })
})
