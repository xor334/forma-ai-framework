import test from 'node:test'
import assert from 'node:assert/strict'
import page from '../../examples/coffee/page.json' with { type: 'json' }
import { pageForSchema, layoutAt } from './layout.mjs'
import { makeRelease, validatePage } from './contract.mjs'
import { renderWeb, nativeViewModel } from './renderers.mjs'
test('percentage layouts survive publication and adapt to installed v1 clients', () => {
  const v2 = pageForSchema(page, 2)
  assert.deepEqual(pageForSchema(v2, 1), page)
  v2.widgets[0].layout.phone = { widthPercent: 62.5, minHeightPx: 196 }
  validatePage(v2)
  const release = makeRelease(v2)
  assert.match(renderWeb(release.page), /62.5%/)
  assert.match(renderWeb(release.page), /196px/)
  assert.equal(layoutAt(v2.widgets[0].layout, 'wide').minHeightPx, 196)
  assert.equal(nativeViewModel(v2, 'ios').widgets[0].layout.widthPercent, 62.5)
  const compat = pageForSchema(v2, 1)
  makeRelease(compat)
  assert.equal(compat.widgets[0].layout.phone.span, 8)
  for (const bad of [-1, 101, 0, Infinity, '50']) {
    v2.widgets[0].layout.phone.widthPercent = bad
    assert.throws(() => validatePage(v2))
  }
  assert.equal(page.schemaVersion, 1)
})
