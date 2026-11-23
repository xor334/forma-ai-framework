import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
const [web, studio] = process.argv.slice(2)
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]+$/
if (!web || !studio || web === studio || ![web, studio].every((x) => hostname.test(x)))
  throw Error('Укажите два разных DNS-имени для сайта и студии')
const root = resolve(import.meta.dirname, '..'),
  local = resolve(root, 'infra/local'),
  envFile = resolve(root, '.env')
for (const file of [envFile, local]) {
  try {
    await access(file)
    throw Error('Установка уже настроена: ' + file)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
}
const secret = () => randomBytes(32).toString('hex')
const keys = {
  WEB_HOST: web,
  STUDIO_HOST: studio,
  PAYLOAD_SECRET: secret(),
  POSTGRES_PASSWORD: secret(),
  FORMA_COMMIT: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
}
for (const service of ['WEB', 'STUDIO', 'RELEASE', 'WORKER', 'TELEGRAM', 'SEARCH'])
  keys['DB_' + service + '_PASSWORD'] = secret()
const pair = generateKeyPairSync('ed25519')
keys.APPROVAL_PRIVATE_KEY = pair.privateKey
  .export({ type: 'pkcs8', format: 'der' })
  .toString('base64')
keys.APPROVAL_PUBLIC_KEY = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const identities = []
for (const [name, actions] of Object.entries({
  admin: ['Admin', 'Read', 'Write', 'List'],
  reader: ['Read:forma-media'],
  writer: ['Read:forma-media', 'Write:forma-media'],
})) {
  const key = secret()
  keys['S3_' + name.toUpperCase() + '_PASSWORD'] = key
  identities.push({ name, credentials: [{ accessKey: name, secretKey: key }], actions })
}
await mkdir(local, { recursive: true, mode: 0o700 })
await writeFile(resolve(local, 's3.json'), JSON.stringify({ identities }), {
  mode: 0o600,
  flag: 'wx',
})
await writeFile(
  envFile,
  Object.entries(keys)
    .map(([k, v]) => k + '=' + v)
    .join('\n') + '\n',
  { mode: 0o600, flag: 'wx' },
)
console.log('Созданы локальные настройки установки')
