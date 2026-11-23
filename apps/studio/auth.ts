import { getPayload, createLocalReq, logoutOperation } from 'payload'
import { Actor, Problem } from '../../packages/runtime/types.ts'
export async function cms() {
  return getPayload({ config: (await import('./payload.config.ts')).default })
}
async function authenticatedUser(request: Request) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('forma-session='))
    ?.slice('forma-session='.length)
  if (!token) throw new Problem(401, 'Войдите в студию')
  const { user } = await (
    await cms()
  ).auth({ headers: new Headers({ authorization: 'JWT ' + token }) })
  if (!user || !['owner', 'editor', 'operator'].includes(user.role))
    throw new Problem(401, 'Сессия завершена')
  return user
}
export async function logout(request: Request) {
  const [payload, user] = await Promise.all([cms(), authenticatedUser(request)])
  const req = await createLocalReq({ user }, payload)
  await logoutOperation({ collection: payload.collections.users, req })
}
export async function authenticate(request: Request): Promise<Actor> {
  const user = await authenticatedUser(request)
  return { id: String(user.id), role: user.role }
}
