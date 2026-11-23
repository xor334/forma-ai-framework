import { spawnSync } from 'node:child_process'
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Ajv from 'ajv'
import schema from '../packages/module-contract/module.schema.json' with { type: 'json' }

const validate = new Ajv({ allErrors: true }).compile(schema)
const template = fileURLToPath(new URL('../templates/module/', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

export function checkManifest(manifest, id) {
  if (!validate(manifest)) {
    const issues = validate.errors.map((error) => (error.instancePath || '/') + ' ' + error.message)
    throw Error(id + ': ' + issues.join(', '))
  }
  if (manifest.id !== id) throw Error('ID модуля расходится с именем каталога: ' + id)
}

export async function catalog(project) {
  const directory = join(project, 'business/modules')
  const modules = new Map()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw Error('Символическая ссылка в каталоге модулей: ' + entry.name)
    if (!entry.isDirectory()) continue
    const folder = join(directory, entry.name)
    for (const path of ['module.json', 'Dockerfile', 'tests/contract.test.mjs']) {
      if (!(await lstat(join(folder, path))).isFile()) throw Error('Ожидался файл ' + path)
    }
    const manifest = JSON.parse(await readFile(join(folder, 'module.json'), 'utf8'))
    checkManifest(manifest, entry.name)
    modules.set(entry.name, manifest)
  }
  for (const module of modules.values()) {
    for (const input of module.requires) {
      if (
        input.module === module.id ||
        !modules.get(input.module)?.provides.includes(input.contract)
      )
        throw Error(module.id + ': недоступная зависимость ' + input.module + '/' + input.contract)
    }
  }
  return modules
}

export async function createModule(project, id, description) {
  const manifest = JSON.parse(await readFile(join(template, 'module.json'), 'utf8'))
  Object.assign(manifest, { id, description: description?.trim() })
  checkManifest(manifest, id)
  const parent = join(project, 'business/modules')
  await mkdir(parent, { recursive: true })
  const target = join(parent, id)
  await mkdir(target)
  try {
    await cp(template, target, { recursive: true })
    await writeFile(join(target, 'module.json'), JSON.stringify(manifest, null, 2) + '\n')
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
  return target
}

export function testModule(project, modules, id) {
  if (!modules.has(id)) throw Error('Модуль отсутствует: ' + id)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--test', 'tests/**/*.test.mjs'], {
    env,
    cwd: join(project, 'business/modules', id),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error('Проверки модуля завершились ошибкой: ' + id)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, ...args] = process.argv.slice(2)
    if (action === 'new' && args.length === 2) {
      console.log(await createModule(root, ...args))
    } else if (action === 'check' && !args.length) {
      console.log('Манифесты и зависимости проверены. Модулей: ' + (await catalog(root)).size)
    } else if (action === 'test' && args.length) {
      const modules = await catalog(root)
      for (const id of args) testModule(root, modules, id)
    } else
      throw Error('Используйте module:new -- id "Описание", module:check или module:test -- id')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
