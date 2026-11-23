import { readFile, readdir } from 'node:fs/promises'
import { transaction } from './db.ts'
import { makeRelease } from '../widget-contract/contract.mjs'
export async function migrate() {
  const directory = new URL('../../infra/migrations/', import.meta.url)
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7640831)')
    await db.query('CREATE TABLE IF NOT EXISTS public.forma_migrations(name text PRIMARY KEY)')
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith('.sql')) continue
      const seen = await db.query('SELECT FROM public.forma_migrations WHERE name=$1', [name])
      if (seen.rowCount) continue
      await db.query(await readFile(new URL(name, directory), 'utf8'))
      await db.query('INSERT INTO public.forma_migrations VALUES($1)', [name])
    }
    const demo = JSON.parse(
      await readFile(new URL('../../examples/coffee/page.json', import.meta.url), 'utf8'),
    )
    makeRelease(demo)
    await db.query(
      "INSERT INTO forma.drafts(revision,page,author) VALUES(1,$1,'setup') ON CONFLICT DO NOTHING",
      [demo],
    )
  })
}
