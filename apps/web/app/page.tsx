import { published } from '../../../packages/runtime/content.ts'
import { css, webSections } from '../../../packages/widget-contract/renderers.mjs'
import Forms from './forms'
export const dynamic = 'force-dynamic'
export default async function Site() {
  let release
  try {
    release = await published()
  } catch {
    return (
      <main>
        <h1>Страница готовится к публикации</h1>
      </main>
    )
  }
  const { page } = release.snapshot
  return (
    <>
      <title>{page.title}</title>
      <style>{css}</style>
      <main
        className={'page-v' + page.schemaVersion}
        data-release={release.id}
        dangerouslySetInnerHTML={{ __html: webSections(page) }}
      />
      <Forms />
    </>
  )
}
