import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { setTimeout as pause } from 'node:timers/promises'

const root = process.cwd(),
  tmp = await mkdtemp(join(tmpdir(), 'forma-compose-')),
  token = randomBytes(4).toString('hex')
const image = process.env.FORMA_PILOT_IMAGE || 'forma-pilot:' + token
const pass = randomBytes(18).toString('base64url'),
  email = 'pilot@forma.test'
const run = (cmd, args, cwd = root, opts = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts })
async function port() {
  const s = createServer()
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const n = s.address().port
  await new Promise((r) => s.close(r))
  return n
}
async function ready(operation, name) {
  let last
  for (let n = 0; n < 100; n++) {
    try {
      const result = await operation()
      if (result) return result
    } catch (e) {
      last = e
    }
    await pause(700)
  }
  throw Error('Тайм-аут проверки ' + name + (last ? ' · ' + last.message : ''))
}
const projects = []
async function configure(label, restoreFrom) {
  const cwd = join(tmp, label)
  await mkdir(cwd)
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
  for (const file of files) {
    const to = join(cwd, file)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(join(root, file), to)
  }
  run('git', ['init', '-qb', 'main'], cwd)
  run('git', ['add', '--all'], cwd)
  run(
    'git',
    [
      '-c',
      'user.name=Pilot',
      '-c',
      'user.email=pilot@example.test',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'Local acceptance fixture',
    ],
    cwd,
  )
  run(process.execPath, ['infra/setup.mjs', 'web.pilot.test', 'studio.pilot.test'], cwd)
  if (restoreFrom) {
    for (const file of ['.env', 'infra/local/s3.json'])
      await copyFile(join(restoreFrom.cwd, file), join(cwd, file))
  }
  const webPort = await port(),
    studioPort = await port(),
    web = 'http://127.0.0.1:' + webPort,
    studio = 'http://127.0.0.1:' + studioPort
  const env = {
    ...process.env,
    COMPOSE_PROFILES: 'semantic',
    MODEL_ENDPOINT: 'http://provider:3900/chat',
    MODEL_NAME: 'test',
    EMBEDDING_ENDPOINT: 'http://provider:3900/embed',
    EMBEDDING_MODEL: 'local-fixture',
    SEMANTIC_URL: 'http://search:3110',
    COMPOSE_PROJECT_NAME: 'forma' + token + label,
    FORMA_IMAGE: image,
  }
  await writeFile(
    join(cwd, 'infra/test-caddy'),
    ':8080 {\n reverse_proxy web:3100\n}\n:8081 {\n reverse_proxy studio:3101\n}\n',
  )
  await writeFile(
    join(cwd, 'infra/test.yaml'),
    `services:
  provider:
    image: ${image}
    pull_policy: never
    command: [node, /mock-provider.mjs]
    volumes: ["../tests/model-fixture.mjs:/mock-provider.mjs:ro"]
  proxy:
    ports: !override ["127.0.0.1:${webPort}:8080","127.0.0.1:${studioPort}:8081"]
    volumes: ["./test-caddy:/etc/caddy/Caddyfile:ro"]
  studio:
    environment: {STUDIO_ORIGIN: "${studio}"}
  release:
    environment: {PUBLIC_PROBE_ORIGIN: "http://proxy:8080"}
`,
  )
  const compose = (args, opts) =>
    run(
      'docker',
      [
        'compose',
        '--env-file',
        '.env',
        '-f',
        'infra/compose.yaml',
        '-f',
        'infra/test.yaml',
        ...args,
      ],
      cwd,
      { env, ...opts },
    )
  const project = { cwd, env, web, studio, compose }
  projects.push(project)
  return project
}
async function session(project) {
  const url = project.studio + '/api/studio/'
  const r = await fetch(url + 'login', {
    method: 'POST',
    headers: { origin: project.studio, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  })
  assert.equal(r.status, 200, 'login')
  const cookie = r.headers.get('set-cookie').split(';')[0]
  return async (action, data, raw = false) => {
    const options = { headers: { cookie, origin: project.studio } }
    if (data) {
      options.method = 'POST'
      options.headers['Content-Type'] = raw ? 'image/png' : 'application/json'
      options.body = raw ? data : JSON.stringify(data)
    }
    const res = await fetch(url + action, options),
      result = await res.json()
    assert.ok(res.ok, action + ' HTTP ' + res.status + ' ' + JSON.stringify(result))
    return result
  }
}
const pixels = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iE9sAAAAASUVORK5CYII=',
  'base64',
)
try {
  const a = await configure('source')
  if (!process.env.FORMA_PILOT_IMAGE) a.compose(['build', 'web'], { stdio: 'inherit' })
  a.compose(['up', '-d', '--no-build'], { stdio: 'inherit' })
  a.compose(['exec', '-T', 'studio', 'node', '--import', 'tsx', 'scripts/owner.ts', email], {
    input: pass,
  })
  await ready(async () => (await fetch(a.studio)).ok, 'первая студия')
  const studio = await session(a),
    state = await studio('state'),
    media = await studio('upload', pixels, true)
  const hidden = await fetch(a.web + '/media/' + media.hash)
  assert.equal(hidden.status, 503)
  const demo = state.page
  demo.widgets.push({
    id: 'pilot-photo',
    required: false,
    targets: ['web', 'ios', 'android'],
    content: {
      type: 'forma.image',
      version: 1,
      props: { title: 'Проверка медиа', alt: 'Тест', mediaHash: media.hash },
    },
    layout: { phone: { span: 12 } },
  })
  let draft = await studio('save', { revision: state.revision, page: demo })
  const candidate = await studio('preview', { revision: draft.revision })
  draft.page.title = 'Более поздний черновик'
  await studio('save', { revision: draft.revision, page: draft.page })
  await studio('publish', { id: randomUUID(), epoch: state.site.epoch, target: candidate.id })
  await ready(async () => (await studio('state')).switches[0]?.status === 'live', 'первый выпуск')
  const payload = await (await fetch(a.web + '/api/v1/page')).json()
  assert.equal(payload.releaseId, candidate.id)
  assert.notEqual(payload.page.title, draft.page.title)
  const served = await fetch(a.web + '/media/' + media.hash)
  assert.equal(served.status, 200)
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), pixels)
  const key = randomUUID()
  assert.equal(
    (
      await fetch(a.web + '/api/v1/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key, contact: 'Контроль', message: 'Проверка восстановления' }),
      })
    ).status,
    201,
  )
  const taskId = randomUUID(),
    taskBase = await studio('state')
  await studio('task', {
    id: taskId,
    revision: taskBase.revision,
    blockId: demo.widgets[0].id,
    prompt: 'Обновить заголовок',
  })
  await ready(
    async () => (await studio('state')).jobs.find((j) => j.id === taskId)?.status === 'proposed',
    'предложение модели',
  )
  await studio('decision', { id: taskId, accept: true })
  const accepted = await studio('state')
  assert.equal(accepted.page.widgets[0].content.props.title, 'Заголовок от модели')
  const article = {
    id: randomUUID(),
    title: 'Самовывоз',
    body: 'Забрать покупку можно у стойки.',
    audience: 'public',
    validUntil: '2099-01-01',
    revision: 0,
  }
  await studio('article', article)
  const query = { id: randomUUID(), question: 'Есть доставка?' }
  async function ask() {
    return (
      await fetch(a.web + '/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      })
    ).json()
  }
  await ready(async () => (await ask()).source === article.title, 'семантический поиск')
  await studio('article', { ...article, audience: 'internal', revision: 1 })
  assert.equal((await ask()).source, null, 'отзыв доступа к источнику')
  const backup = join(tmp, 'archive')
  run('bash', ['infra/backup.sh', backup], a.cwd, { env: a.env, stdio: 'inherit' })
  run('git', ['bundle', 'verify', join(backup, 'source.bundle')], a.cwd)
  const b = await configure('restored', a)
  run('bash', ['infra/restore.sh', backup], b.cwd, { env: b.env, stdio: 'inherit' })
  b.compose(['up', '-d', '--no-build'], { stdio: 'inherit' })
  await ready(async () => (await fetch(b.studio)).ok, 'восстановленная студия')
  const restored = await session(b)
  assert.equal((await restored('state')).site.active, candidate.id)
  assert.equal((await restored('state')).jobs.find((j) => j.id === taskId)?.status, 'applied')
  assert.ok((await restored('inbox')).leads.some((l) => l.id === key))
  const img = await fetch(b.web + '/media/' + media.hash)
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), pixels)
  console.log(
    'Compose · чистая установка, S3, точный выпуск, резервная копия и восстановление сайта, медиа и заявки',
  )
} catch (error) {
  for (const p of projects) {
    try {
      p.compose(['logs', '--tail', '15', 'provision', 'studio-migrate', 'release', 'objects'], {
        stdio: 'inherit',
      })
    } catch {}
  }
  throw error
} finally {
  for (const p of projects.reverse()) {
    try {
      p.compose(['down', '--volumes', '--remove-orphans'], { stdio: 'inherit' })
    } catch {
      console.error('Проверьте временный проект ' + p.env.COMPOSE_PROJECT_NAME)
    }
  }
  if (!process.env.FORMA_PILOT_IMAGE) {
    try {
      run('docker', ['image', 'rm', image])
    } catch {}
  }
  await rm(tmp, { recursive: true, force: true })
}
