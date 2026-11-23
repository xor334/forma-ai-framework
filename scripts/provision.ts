import { migrate } from '../packages/runtime/migrate.ts'
import { transaction, disconnect } from '../packages/runtime/db.ts'
export async function provision() {
  await migrate()
  await transaction(async (db) => {
    for (const name of ['web', 'studio', 'worker', 'release', 'telegram', 'search']) {
      const password = process.env['DB_' + name.toUpperCase() + '_PASSWORD']
      if (!password || !/^[a-zA-Z0-9]{32,128}$/.test(password))
        throw Error('Настройте пароль роли ' + name)
      const role = 'app_' + name
      const exists = (await db.query('SELECT FROM pg_roles WHERE rolname=$1', [role])).rowCount
      // Both identifiers come from the fixed list, passwords are URL-safe generated hex.
      if (!exists) await db.query('CREATE ROLE ' + role + ' LOGIN')
      await db.query('ALTER ROLE ' + role + " PASSWORD '" + password + "'")
      await db.query('GRANT forma_' + name + ' TO ' + role)
    }
  })
}
if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    await provision()
  } finally {
    await disconnect()
  }
}
