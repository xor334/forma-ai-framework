import { once } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createService } from '../src/main.mjs'

test('проверка готовности модуля', async (t) => {
  const service = createService()
  service.listen(0, '127.0.0.1')
  await once(service, 'listening')
  t.after(() => new Promise((resolve) => service.close(resolve)))
  const response = await fetch('http://127.0.0.1:' + service.address().port + '/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
})
