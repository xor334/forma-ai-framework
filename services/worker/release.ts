import { manifestId, manifestOf } from '../../packages/runtime/manifest.ts'
import { verified } from '../../packages/runtime/approval.ts'
import { transaction } from '../../packages/runtime/db.ts'
import { verifyRelease } from '../../packages/widget-contract/contract.mjs'
import { renderWeb } from '../../packages/widget-contract/renderers.mjs'

// Persist the switch before probing so public readers observe it. A restart resumes checking.
export async function advanceRelease(probe: (id: string) => Promise<boolean>) {
  const pending = await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7640833)')
    const op = (
      await db.query("SELECT * FROM forma.switches WHERE status IN ('queued','checking')")
    ).rows[0]
    if (!op || op.status === 'checking') return op
    const candidate = (
      await db.query('SELECT snapshot,manifest FROM forma.releases WHERE id=$1', [op.target])
    ).rows[0]
    try {
      if (
        !op.signature ||
        !verified(
          { id: op.id, target: op.target, epoch: op.base_epoch, actor: op.actor },
          op.signature,
        )
      )
        throw Error('Подпись недействительна')
      const { page } = verifyRelease(candidate.snapshot)
      renderWeb(page)
      if (
        manifestId(candidate.manifest) !== op.target ||
        manifestId(manifestOf(candidate.snapshot)) !== op.target
      )
        throw Error('Состав выпуска изменился')
    } catch {
      await db.query("UPDATE forma.switches SET status='failed' WHERE id=$1", [op.id])
      return null
    }
    await db.query('UPDATE forma.site SET active=$1,epoch=epoch+1', [op.target])
    await db.query("UPDATE forma.switches SET status='checking' WHERE id=$1", [op.id])
    return op
  })
  if (!pending) return false
  let healthy = false
  try {
    healthy = await probe(pending.target)
  } catch {
    /* A failed probe reverts this switch. */
  }
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7640833)')
    const state = await db.query("SELECT FROM forma.switches WHERE id=$1 AND status='checking'", [
      pending.id,
    ])
    if (!state.rowCount) return
    if (healthy) {
      await db.query('UPDATE forma.site SET previous=$1', [pending.old_id])
      await db.query(
        "INSERT INTO forma.roles(name) VALUES ('marketing'),('analytics'),('support') ON CONFLICT DO NOTHING",
      )
    } else {
      await db.query('UPDATE forma.site SET active=$1,epoch=epoch+1', [pending.old_id])
    }
    await db.query('UPDATE forma.switches SET status=$2 WHERE id=$1', [
      pending.id,
      healthy ? 'live' : 'failed',
    ])
  })
  return true
}
export async function publicProbe(id: string) {
  const origin = process.env.PUBLIC_PROBE_ORIGIN
  if (!origin) throw Error('Задайте PUBLIC_PROBE_ORIGIN')
  const [api, web] = await Promise.all(
    ['/api/v1/page', '/'].map((path) =>
      fetch(new URL(path, origin), {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      }),
    ),
  )
  return (
    api.ok &&
    web.ok &&
    (await api.json()).releaseId === id &&
    (await web.text()).includes('data-release="' + id + '"')
  )
}
