import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Work with Git blobs so untracked files, local credentials and unstaged edits stay on the host.
const git = (cwd, args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2_000_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
export async function propose(root, instruction, paths, generate) {
  if (
    !instruction?.trim() ||
    !paths.length ||
    paths.length > 12 ||
    new Set(paths).size !== paths.length
  )
    throw Error('Передайте задачу и от 1 до 12 разных файлов')
  const sha = git(root, ['rev-parse', '--verify', 'HEAD']).trim()
  const files = []
  for (const path of paths) {
    if (
      !/^(apps|packages|business\/extensions|services)\/(?:[\w-]+\/)*[\w.-]+\.(?:tsx?|jsx?|mjs|css|md|json)$/.test(
        path,
      ) ||
      path.includes('..') ||
      path.includes('/node_modules/')
    )
      throw Error('Недоступный путь: ' + path)
    const record = git(root, ['ls-tree', sha, '--', path])
    if (record && !/^100(644|755) blob /.test(record)) throw Error('Требуется обычный файл')
    const content = record ? git(root, ['show', sha + ':' + path]) : null
    files.push({ path, content, executable: record.startsWith('100755') })
  }
  if (Buffer.byteLength(JSON.stringify(files)) + Buffer.byteLength(instruction) > 80000)
    throw Error('Сократите контекст задачи')
  const proposed = await generate({
    base: sha,
    instruction,
    files: files.map(({ path, content }) => ({ path, content })),
  })
  if (
    !Array.isArray(proposed.files) ||
    !proposed.files.length ||
    proposed.files.length > paths.length
  )
    throw Error('Модель вернула пустой или некорректный набор изменений')
  const seen = new Set()
  for (const f of proposed.files) {
    if (
      !paths.includes(f.path) ||
      seen.has(f.path) ||
      typeof f.content !== 'string' ||
      Buffer.byteLength(f.content) > 100000
    )
      throw Error('Изменение выходит за согласованный набор файлов')
    seen.add(f.path)
  }
  const dir = await mkdtemp(join(tmpdir(), 'forma-patch-'))
  try {
    git(dir, ['init', '--quiet'])
    for (const f of files) {
      await mkdir(dirname(join(dir, f.path)), { recursive: true })
      if (f.content !== null) {
        await writeFile(join(dir, f.path), f.content, { mode: f.executable ? 0o755 : 0o644 })
        git(dir, ['add', '--', f.path])
      }
    }
    for (const f of proposed.files) {
      await writeFile(join(dir, f.path), f.content)
      git(dir, ['add', '-N', '--', f.path])
    }
    const patch = git(dir, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--full-index',
      '--',
      ...paths,
    ])
    if (!patch) throw Error('Изменений нет')
    return 'Forma AI · предложение изменения\nbase-commit: ' + sha + '\n\n' + patch
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
async function model(context) {
  const { MODEL_ENDPOINT, MODEL_NAME, MODEL_KEY } = process.env
  if (!MODEL_ENDPOINT || !MODEL_NAME) throw Error('Задайте MODEL_ENDPOINT и MODEL_NAME')
  const headers = { 'Content-Type': 'application/json' }
  if (MODEL_KEY) headers.Authorization = 'Bearer ' + MODEL_KEY
  const res = await fetch(MODEL_ENDPOINT, {
    method: 'POST',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      model: MODEL_NAME,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Подготовь изменение проекта. Верни объект files с массивом {path,content}. Каждый content — полный новый текст разрешённого файла. Следуй требованиям задачи. Не добавляй другие пути.',
        },
        { role: 'user', content: JSON.stringify(context) },
      ],
    }),
  })
  if (!res.ok) throw Error('Шлюз модели вернул HTTP ' + res.status)
  return JSON.parse((await res.json()).choices[0].message.content)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      await propose(process.cwd(), process.argv[2], process.argv.slice(3), model),
    )
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
