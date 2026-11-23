import { authenticate } from '../../../auth.ts'
import { database } from '../../../../../packages/runtime/db.ts'
import { failure } from '../../../../../packages/runtime/http.ts'
import { Problem, requireRole } from '../../../../../packages/runtime/types.ts'
import { renderWeb } from '../../../../../packages/widget-contract/renderers.mjs'
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireRole(await authenticate(req), 'owner', 'editor')
    const { id } = await ctx.params
    const row = (await database().query('SELECT snapshot FROM forma.releases WHERE id=$1', [id]))
      .rows[0]
    if (!row) throw new Problem(404, 'Выпуск не найден')
    return new Response(
      renderWeb(row.snapshot.page).replaceAll('src="/media/', 'src="/preview/' + id + '/media/'),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'",
        },
      },
    )
  } catch (error) {
    return failure(error)
  }
}
