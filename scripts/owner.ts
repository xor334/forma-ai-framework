import { readFileSync } from 'node:fs'
import { cms } from '../apps/studio/auth.ts'
import { transaction, disconnect } from '../packages/runtime/db.ts'

const email = process.argv[2]
const role = process.argv[3] || 'owner'
if (!email || !['owner', 'editor', 'operator'].includes(role))
  throw Error('Передайте email и роль owner/editor/operator')
const password = readFileSync(0, 'utf8').trimEnd()
if (password.length < 14 || password.length > 512)
  throw Error('Введите пароль от 14 символов через stdin')
const payload = await cms()
try {
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7640835)')
    if (
      role === 'owner' &&
      (await payload.count({ collection: 'users', where: { role: { equals: 'owner' } } })).totalDocs
    )
      throw Error('Первый владелец уже создан')
    await payload.create({
      collection: 'users',
      data: { email, password, role },
      overrideAccess: true,
    })
  })
  console.log('Учётная запись создана')
} finally {
  await payload.destroy()
  await disconnect()
}
