import { published } from '../../../../../packages/runtime/content.ts'
import { mediaResponse } from '../../../../../packages/runtime/media.ts'
import { failure } from '../../../../../packages/runtime/http.ts'
export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  try {
    return await mediaResponse((await published()).snapshot.page, (await ctx.params).key)
  } catch (e) {
    return failure(e)
  }
}
