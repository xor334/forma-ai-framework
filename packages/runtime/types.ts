export type Size = 'phone' | 'tablet' | 'wide'
export type Step = {
  span?: number
  widthPercent?: number
  minHeightPx?: number
  align?: 'start' | 'center' | 'end'
}
export type Block = {
  id: string
  required: boolean
  targets: string[]
  content: {
    type: string
    version: number
    props: {
      title: string
      body?: string
      schedule?: string
      action?: { label: string; kind: string; target: string }
      [key: string]: unknown
    }
  }
  fallback?: Block['content']
  layout: { phone: Step; tablet?: Step; wide?: Step }
}
export type Page = {
  schemaVersion: number
  pageId: string
  title: string
  locale: string
  widgets: Block[]
}
export type Draft = { revision: number; page: Page }
export type Actor = { id: string; role: 'owner' | 'editor' | 'operator' }
export type EditField = 'title' | 'body' | 'schedule' | 'buttonLabel'
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export function requireRole(actor: Actor, ...roles: Actor['role'][]) {
  if (!roles.includes(actor.role)) throw new Problem(403, 'Недостаточно прав')
}
export function stringValue(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Problem(400, label)
  return value.trim()
}
export function requestId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new Problem(400, 'Нужен UUID операции')
  return value
}
