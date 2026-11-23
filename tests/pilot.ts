import assert from 'node:assert/strict'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { chromium, webkit } from '@playwright/test'
import { testCluster, unusedPort } from '../packages/runtime/test-cluster.ts'
import { provision } from '../scripts/provision.ts'
import { disconnect } from '../packages/runtime/db.ts'
async function run() {
  const pair = generateKeyPairSync('ed25519')
  process.env.APPROVAL_PRIVATE_KEY = pair.privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .toString('base64')
  process.env.APPROVAL_PUBLIC_KEY = pair.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
  const cluster = await testCluster(),
    children: ChildProcess[] = []
  const studioPort = await unusedPort(),
    webPort = await unusedPort(),
    origin = 'http://127.0.0.1:' + studioPort,
    web = 'http://127.0.0.1:' + webPort
  const env = {
    ...process.env,
    DATABASE_URL: cluster.url,
    STUDIO_ORIGIN: origin,
    PAYLOAD_SECRET: randomBytes(32).toString('hex'),
    NEXT_TELEMETRY_DISABLED: '1',
    PUBLIC_PROBE_ORIGIN: web,
  }
  const pass = randomBytes(24).toString('hex'),
    email = 'owner@example.test'
  process.env.DATABASE_URL = cluster.url
  function role(name: string) {
    const url = new URL(cluster.url)
    url.username = 'app_' + name
    url.password = process.env['DB_' + name.toUpperCase() + '_PASSWORD']!
    return { ...env, DATABASE_URL: url.href }
  }
  function start(args: string[], settings: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, args, {
      env: settings,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.resume()
    child.stderr?.on('data', (x) => process.stderr.write(x))
    children.push(child)
  }
  try {
    for (const name of ['web', 'studio', 'worker', 'release', 'telegram', 'search'])
      process.env['DB_' + name.toUpperCase() + '_PASSWORD'] = randomBytes(24).toString('hex')
    await provision()
    await disconnect()
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-studio.ts'], {
      env: role('studio'),
      stdio: 'pipe',
    })
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/owner.ts', email], {
      env: role('studio'),
      input: pass,
    })
    start(
      [
        'node_modules/next/dist/bin/next',
        'start',
        'apps/web',
        '-H',
        '127.0.0.1',
        '-p',
        String(webPort),
      ],
      role('web'),
    )
    start(
      [
        'node_modules/next/dist/bin/next',
        'start',
        'apps/studio',
        '-H',
        '127.0.0.1',
        '-p',
        String(studioPort),
      ],
      role('studio'),
    )
    start(['--import', 'tsx', 'services/worker/main.ts', 'release'], role('release'))
    async function waitFor(test: () => Promise<boolean>, label: string) {
      for (let n = 0; n < 65; n++) {
        try {
          if (await test()) return
        } catch {}
        await pause(300)
      }
      throw Error('Тайм-аут: ' + label)
    }
    await waitFor(async () => (await fetch(origin)).ok, 'студия')
    assert.equal((await fetch(origin + '/api/studio/state')).status, 401)
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true })
      try {
        const page = await browser.newPage()
        page.setDefaultTimeout(10000)
        page.on('response', (r) => {
          if (r.status() >= 400 && r.url().includes('/api/'))
            console.error('HTTP', r.status(), new URL(r.url()).pathname)
        })
        page.on('pageerror', (e) => console.error(e.message))
        await page.goto(origin)
        await page.getByLabel('Электронная почта').fill(email)
        await page.getByLabel('Пароль', { exact: true }).fill(pass)
        await page.getByRole('button', { name: 'Войти', exact: true }).click()
        await page.getByRole('heading', { name: 'Блоки', exact: true }).waitFor()
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            'ширина ' + width,
          )
          if (width === 390)
            await page.getByRole('button', { name: 'Свойства', exact: true }).click()
          const height = page.getByLabel('Минимальная высота, px')
          const original = await height.inputValue()
          await height.fill(String(width / 2))
          await page.getByRole('button', { name: 'Отменить', exact: true }).click()
          assert.equal(await height.inputValue(), original)
        }
        await page.getByRole('button', { name: 'Добавить блок' }).click()
        const title = 'Блок ' + engine.name()
        await page.getByLabel('Заголовок', { exact: true }).fill(title)
        await page.getByRole('button', { name: 'Выше', exact: true }).click()
        await page.getByLabel('Ширина, %').fill('65')
        await page.getByLabel('Минимальная высота, px').fill('150')
        await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
        await page.getByText('Сохранено', { exact: true }).waitFor()
        await page.getByRole('button', { name: 'Выпуски', exact: true }).click()
        await page.getByRole('button', { name: 'Подготовить предпросмотр' }).click()
        await page
          .frameLocator('iframe')
          .getByRole('heading', { name: title, exact: true })
          .waitFor()
        await page.getByRole('button', { name: 'Выпустить этот снимок' }).click()
        await waitFor(
          async () => (await (await fetch(web)).text()).includes(title),
          'публикация ' + engine.name(),
        )
        const model = await (await fetch(web + '/api/v1/page?platform=ios&generation=1')).json()
        assert.ok(model.model.widgets.length >= 4)
        const lead = await fetch(web + '/api/v1/leads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: randomUUID(), contact: 'Тест', message: title }),
        })
        assert.equal(lead.status, 201)
        await page.getByRole('button', { name: 'Обращения', exact: true }).click()
        await page.getByText(title, { exact: true }).waitFor()
        const cookies = await page.context().cookies()
        await page.getByRole('button', { name: 'Выйти', exact: true }).click()
        await page.getByRole('button', { name: 'Войти', exact: true }).waitFor()
        assert.equal(
          (
            await fetch(origin + '/api/studio/state', {
              headers: { cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') },
            })
          ).status,
          401,
        )
        console.log(engine.name() + ' · вход, три ширины, правка, предпросмотр, выпуск и заявка')
      } finally {
        await browser.close()
      }
    }
  } finally {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode) return
        const closed = once(child, 'exit')
        child.kill('SIGTERM')
        await closed
      }),
    )
    await disconnect()
    await cluster.close()
  }
}
await run()
