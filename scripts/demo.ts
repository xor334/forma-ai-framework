import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { testCluster, unusedPort } from '../packages/runtime/test-cluster.ts'
import { provision } from './provision.ts'
import { disconnect } from '../packages/runtime/db.ts'

const root = process.cwd(),
  cluster = await testCluster(),
  children: ChildProcess[] = []
const files = await mkdtemp(join(tmpdir(), 'forma-demo-media-'))
const studio = await unusedPort(),
  web = await unusedPort(),
  origin = 'http://127.0.0.1:'
const pass = randomBytes(18).toString('base64url'),
  signing = generateKeyPairSync('ed25519')
const roleEnv = (role: string) => {
  const url = new URL(cluster.url)
  url.username = 'app_' + role
  url.password = process.env['DB_' + role.toUpperCase() + '_PASSWORD']!
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: url.href,
    FORMA_ROOT: root,
  }
  if (role === 'studio')
    Object.assign(env, {
      PAYLOAD_SECRET: secret,
      STUDIO_ORIGIN: origin + studio,
      APPROVAL_PRIVATE_KEY: signing.privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
    })
  if (role === 'release')
    Object.assign(env, {
      PUBLIC_PROBE_ORIGIN: origin + web,
      APPROVAL_PUBLIC_KEY: signing.publicKey
        .export({ format: 'der', type: 'spki' })
        .toString('base64'),
    })
  if (role === 'studio' || role === 'web') env.FORMA_LOCAL_MEDIA = files
  if (role === 'worker')
    for (const k of ['MODEL_ENDPOINT', 'MODEL_NAME', 'MODEL_KEY']) env[k] = process.env[k]
  return env
}
const secret = randomBytes(32).toString('hex')
let finish!: () => void
const finished = new Promise<void>((r) => {
  finish = r
})
process.once('SIGINT', finish)
process.once('SIGTERM', finish)
function child(args: string[], role: string) {
  const processHandle = spawn(process.execPath, args, { env: roleEnv(role), stdio: 'inherit' })
  processHandle.once('exit', finish)
  children.push(processHandle)
}
try {
  process.env.DATABASE_URL = cluster.url
  for (const role of ['web', 'studio', 'worker', 'release', 'telegram', 'search'])
    process.env['DB_' + role.toUpperCase() + '_PASSWORD'] = randomBytes(24).toString('hex')
  await provision()
  await disconnect()
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-studio.ts'], {
    env: roleEnv('studio'),
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/owner.ts', 'owner@forma.test'], {
    env: roleEnv('studio'),
    input: pass,
  })
  child(
    [
      'node_modules/next/dist/bin/next',
      'dev',
      'apps/web',
      '--webpack',
      '-H',
      '127.0.0.1',
      '-p',
      String(web),
    ],
    'web',
  )
  child(
    [
      'node_modules/next/dist/bin/next',
      'dev',
      'apps/studio',
      '--webpack',
      '-H',
      '127.0.0.1',
      '-p',
      String(studio),
    ],
    'studio',
  )
  child(['--import', 'tsx', 'services/worker/main.ts', 'release'], 'release')
  child(['--import', 'tsx', 'services/worker/main.ts'], 'worker')
  console.log(
    'Сайт ' +
      origin +
      web +
      '\nСтудия ' +
      origin +
      studio +
      '\nДемонстрационный владелец owner@forma.test\nОдноразовый пароль ' +
      pass +
      '\nCtrl+C завершает демонстрацию и удаляет её временную БД.',
  )
  await finished
} finally {
  await Promise.all(
    children.map(async (p) => {
      if (p.exitCode !== null || p.signalCode) return
      const stopped = once(p, 'exit')
      p.kill('SIGTERM')
      await stopped
    }),
  )
  await disconnect()
  await cluster.close()
  await rm(files, { recursive: true, force: true })
}
