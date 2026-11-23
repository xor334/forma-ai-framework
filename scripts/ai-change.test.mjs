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
