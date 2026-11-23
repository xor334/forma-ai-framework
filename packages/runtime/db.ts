import pg, { type PoolClient } from 'pg'
let pool: pg.Pool | undefined
export function database() {
  if (!process.env.DATABASE_URL) throw Error('Задайте DATABASE_URL')
  return (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 }))
}
export async function transaction<T>(run: (db: PoolClient) => Promise<T>) {
  const db = await database().connect()
  try {
    await db.query('BEGIN')
    const result = await run(db)
    await db.query('COMMIT')
    return result
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    db.release()
  }
}
export async function disconnect() {
  await pool?.end()
  pool = undefined
}
