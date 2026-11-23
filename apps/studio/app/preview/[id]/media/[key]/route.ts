import { authenticate } from '../../../../../auth.ts'
import { database } from '../../../../../../../packages/runtime/db.ts'
import { mediaResponse } from '../../../../../../../packages/runtime/media.ts'
import { failure } from '../../../../../../../packages/runtime/http.ts'
import { requireRole, Problem } from '../../../../../../../packages/runtime/types.ts'
export async function GET(request: Request, ctx: { params: Promise<{ key: string; id: string }> }) {
  try {
    requireRole(await authenticate(request), 'editor', 'owner')
    const { id, key } = await ctx.params
    const row = (await database().query('SELECT snapshot FROM forma.releases WHERE id=$1', [id]))
      .rows[0]
    if (!row) throw new Problem(404, 'Выпуск недоступен')
    return await mediaResponse(row.snapshot.page, key)
  } catch (e) {
    return failure(e)
  }
}
