import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { catalog, createModule, testModule } from './modules.mjs'
import { planChanges } from './check-plan.mjs'

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'forma-modules-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
async function update(folder, changes) {
  const file = join(folder, 'module.json')
  const data = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...data, ...changes }))
}

test('a fork can scaffold, validate and run a module without touching the pilot', async (t) => {
  const dir = await workspace(t)
  const folder = await createModule(dir, 'stock', 'Остатки')
  await assert.rejects(createModule(dir, '../invalid', 'Название'))
  await assert.rejects(createModule(dir, 'stock', 'Новое название'), { code: 'EEXIST' })
  const modules = await catalog(dir)
  assert.deepEqual(modules.get('stock').network, [])
  testModule(dir, modules, 'stock')
  await update(folder, {
    network: [{ direction: 'out', peer: '*', protocol: 'tcp', port: 443, purpose: 'test' }],
  })
  await assert.rejects(catalog(dir), /network/)
})

test('public contracts check transitive consumers without selecting them for release', async (t) => {
  const dir = await workspace(t)
  for (const [id, changes] of [
    ['stock', { provides: ['sql:stock@1'] }],
    [
      'sales',
      { requires: [{ module: 'stock', contract: 'sql:stock@1' }], provides: ['event:accepted@1'] },
    ],
    ['report', { requires: [{ module: 'sales', contract: 'event:accepted@1' }] }],
    ['independent', {}],
  ])
    await update(await createModule(dir, id, id), changes)
  const modules = await catalog(dir)
  const plan = (path) => planChanges([path], modules)
  const contract = plan('business/modules/stock/contracts/stock.sql')
  assert.deepEqual(contract.testModules, ['report', 'sales', 'stock'])
  assert.deepEqual(contract.buildCandidates, ['stock'])
  assert.deepEqual(plan('business/modules/stock/src/main.mjs').testModules, ['stock'])
  assert.deepEqual(plan('business/modules/sales/tests/contract.test.mjs').buildCandidates, [])
  assert.deepEqual(plan('README.md').checks, {
    critical: true,
    unit: false,
    browser: false,
    compose: false,
    mobile: false,
    template: false,
  })
  assert.deepEqual(plan('unknown-input').testModules, [...modules.keys()].sort())
  assert.deepEqual(plan('apps/mobile/App.js').checks, {
    critical: true,
    unit: false,
    browser: false,
    compose: false,
    mobile: true,
    template: false,
  })
  assert.ok(plan('apps/web/app/api/v1/new/route.ts').checks.mobile)
  await update(join(dir, 'business/modules/stock'), { provides: ['sql:stock@2'] })
  await assert.rejects(catalog(dir), /недоступная зависимость/)
})

test('MCP stdio launcher passes an immutable image to Docker without granting a network or mounts', async (t) => {
  const dir = await workspace(t)
  await mkdir(join(dir, 'bin'))
  await writeFile(join(dir, 'bin/docker'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 })
  const env = { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH }
  const run = (image) =>
    execFileSync('sh', ['scripts/mcp-stdio.sh', image], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const image = 'sha256:' + 'a'.repeat(64)
  const args = run(image).trim().split('\n')
  assert.equal(args.at(-1), image)
  for (const option of ['--network=none', '--read-only', '--pull=never', '--cap-drop=ALL'])
    assert.ok(args.includes(option))
  assert.throws(() => run('example:latest'))
})
