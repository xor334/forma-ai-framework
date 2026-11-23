import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaKeys } from './media.ts'
import type { Page } from './types.ts'
const stamp = join(process.env.FORMA_ROOT || process.cwd(), '.forma-image')
export function artifact() {
  if (process.env.FORMA_ARTIFACT?.includes('@sha256:')) return process.env.FORMA_ARTIFACT
  return existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : 'local'
}
export function manifestOf(snapshot: { id: string; page: Page }) {
  return {
    api: 1,
    schema: snapshot.page.schemaVersion,
    content: snapshot.id,
    media: mediaKeys(snapshot.page),
    commit: process.env.FORMA_COMMIT || 'local',
    artifact: artifact(),
  }
}
export function manifestId(m: ReturnType<typeof manifestOf>) {
  // JSONB preserves arrays but may reorder object keys.
  const fields = [m.api, m.schema, m.content, m.media, m.commit, m.artifact]
  return 'sha256:' + createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}
