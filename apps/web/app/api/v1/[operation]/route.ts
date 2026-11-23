import { createHash } from 'node:crypto'
import { database } from '../../../../../../packages/runtime/db.ts'
import { failure, input, reply } from '../../../../../../packages/runtime/http.ts'
import { published } from '../../../../../../packages/runtime/content.ts'
import { lead, ask } from '../../../../../../packages/runtime/channels.ts'
import { Problem, requestId } from '../../../../../../packages/runtime/types.ts'
import { pageForSchema } from '../../../../../../packages/widget-contract/layout.mjs'
import { nativeViewModel } from '../../../../../../packages/widget-contract/renderers.mjs'
type Context = { params: Promise<{ operation: string }> }
export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: Context) {
  try {
    const { operation } = await params
    if (operation === 'reply') {
      const key = requestId(new URL(request.url).searchParams.get('id'))
      const row = (await database().query('SELECT forma.web_reply($1) AS answer', [key])).rows[0]
      return reply({ answer: row.answer })
    }
    if (operation === 'capabilities')
      return reply({
        api: 1,
        pageSchemas: [1, 2],
        clientGenerations: [1, 2, 3],
        actions: ['section', 'email'],
      })
    if (operation !== 'page') throw new Problem(404, 'Нет маршрута')
    const { id, snapshot } = await published()
    const query = new URL(request.url).searchParams
    const schema = Number(query.get('schema') || 1)
    if (![1, 2].includes(schema)) throw new Problem(406, 'Версия схемы недоступна')
    const page = pageForSchema(snapshot.page, schema)
    const platform = query.get('platform'),
      generation = Number(query.get('generation') || 1)
    if (!platform) return reply({ releaseId: id, page })
    if (!['ios', 'android'].includes(platform) || ![1, 2, 3].includes(generation))
      throw new Problem(406, 'Клиент не поддерживается')
    const { size } = Object.fromEntries(query)
    if (size && !['phone', 'tablet', 'wide'].includes(size))
      throw new Problem(400, 'Неизвестный размер')
    return reply({
      releaseId: id,
      model: nativeViewModel(page, platform, { generation, size: size || 'phone' }),
    })
  } catch (e) {
    return failure(e)
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { operation } = await params
    const host = request.headers.get('x-forma-client') || 'local'
    const key = createHash('sha256').update(host).digest('hex')
    if (!(await database().query('SELECT forma.allow_request($1) AS ok', [key])).rows[0].ok)
      throw new Problem(429, 'Слишком много запросов')
    const data = await input(request, 12000)
    if (operation === 'leads') return reply(await lead(data.id, data.contact, data.message), 201)
    if (operation === 'chat') return reply(await ask('web', requestId(data.id), data.question))
    throw new Problem(404, 'Нет маршрута')
  } catch (e) {
    return failure(e)
  }
}
