import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { propose } from './ai-change.mjs'
test('agent returns an applicable diff limited to the selected Git blobs', async () => {
  const file = 'business/extensions/loyalty/loyalty.mjs'
  const patch = await propose(process.cwd(), 'Добавить пояснение', [file], async ({ files }) => ({
    files: [{ path: file, content: files[0].content + '\n// Правило кофейни\n' }],
  }))
  execFileSync('git', ['apply', '--check', '-'], { input: patch })
  await assert.rejects(
    propose(process.cwd(), 'Правка', [file], async () => ({
      files: [{ path: 'outside', content: 'x' }],
    })),
    /согласованный/,
  )
  await assert.rejects(
    propose(process.cwd(), 'Прочитать настройки', ['.env'], () => {}),
    /путь/,
  )
})

test('business proposals stay inside one component and cannot select the core', async () => {
  for (const paths of [
    ['apps/studio/auth.ts'],
    ['packages/runtime/content.ts'],
    ['business/extensions/index.mjs'],
    ['business/modules/one/src/a.mjs', 'business/modules/two/src/b.mjs'],
  ]) {
    let called = false
    await assert.rejects(
      propose(process.cwd(), 'Правка', paths, () => {
        called = true
      }),
      /путь|одного модуля/,
    )
    assert.equal(called, false)
  }
})
