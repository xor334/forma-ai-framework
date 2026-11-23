import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { catalog } from './modules.mjs'

export function planChanges(files, modules, all = false) {
  const checks = {
    critical: true,
    unit: false,
    browser: false,
    compose: false,
    mobile: false,
    template: false,
  }
  const changed = new Set(),
    check = new Set(),
    build = new Set(),
    propagate = new Set()
  const removed = new Set()
  function full() {
    for (const name of Object.keys(checks)) checks[name] = true
    for (const id of modules.keys()) check.add(id)
  }
  if (all) {
    full()
    for (const id of modules.keys()) build.add(id)
  }
  for (const path of files) {
    const match = /^business\/modules\/([^/]+)\/(.+)$/.exec(path)
    if (match) {
      const [, id, file] = match
      changed.add(id)
      if (!modules.has(id)) {
        removed.add(id)
        propagate.add(id)
        continue
      }
      if (/^(README\.md|docs\/.*\.md)$/.test(file)) continue
      check.add(id)
      if (file.startsWith('tests/')) continue
      build.add(id)
      if (/^(module\.json$|contracts\/|migrations\/)/.test(file)) propagate.add(id)
      continue
    }
    if (/^(docs\/.*\.md|[^/]+\.md|business\/(modules\/)?README\.md)$/.test(path)) continue
    if (path.startsWith('apps/mobile/')) {
      checks.mobile = true
    } else if (path.startsWith('apps/web/') || path.startsWith('apps/studio/')) {
      checks.unit = checks.browser = checks.compose = true
      // A change to the published API may also break the mobile consumer.
      if (path.startsWith('apps/web/app/api/')) checks.mobile = true
    } else if (
      /^(scripts\/(ai-change|init-project|fork)(\.test)?\.mjs|scripts\/modules(\.test)?\.mjs|scripts\/mcp-stdio\.sh)$/.test(
        path,
      )
    ) {
      checks.unit = true
    } else if (path.startsWith('business/extensions/') || path === 'business/extensions.json') {
      checks.unit = true
      if (!path.endsWith('.test.mjs') && !path.endsWith('.md'))
        checks.browser = checks.compose = true
    } else if (path.startsWith('packages/runtime/') || path.startsWith('services/worker/')) {
      checks.unit = true
      if (!path.endsWith('.test.ts')) checks.browser = checks.compose = true
    } else if (path.startsWith('templates/module/')) {
      checks.unit = true
      if (!path.startsWith('templates/module/tests/')) checks.template = true
    } else if (path.startsWith('tests/compose-') || path === 'tests/model-fixture.mjs') {
      checks.compose = true
    } else if (path === 'tests/pilot.ts') {
      checks.browser = true
    } else {
      // Unknown/shared build inputs can affect every consumer in a fork.
      full()
    }
  }
  // Visiting each provider once also bounds traversal for mutually dependent services.
  for (const provider of propagate) {
    for (const module of modules.values()) {
      if (module.requires.some((input) => input.module === provider)) {
        check.add(module.id)
        propagate.add(module.id)
      }
    }
  }
  const sorted = (items) => [...items].sort()
  return {
    checks,
    changedModules: sorted(changed),
    testModules: sorted(check),
    buildCandidates: sorted(build),
    removedModules: sorted(removed),
  }
}

export function changedFiles(base) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16_000_000 })
  const commit = git(['rev-parse', '--verify', '--end-of-options', base + '^{commit}']).trim()
  const tracked = git(['diff', '--name-only', '--no-renames', '-z', commit, '--'])
  const added = git(['ls-files', '--others', '--exclude-standard', '-z'])
  return [...new Set((tracked + added).split('\0').filter(Boolean))]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 1) throw Error('Используйте check:plan [-- BASE | -- --all]')
    const all = args[0] === '--all'
    const modules = await catalog(process.cwd())
    const plan = planChanges(all ? [] : changedFiles(args[0] || 'HEAD'), modules, all)
    console.log(JSON.stringify(plan, null, 2))
    if (process.env.GITHUB_OUTPUT) {
      for (const [name, value] of Object.entries(plan.checks))
        appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n')
      for (const name of ['testModules', 'buildCandidates'])
        appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + JSON.stringify(plan[name]) + '\n')
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        '### Forma · план проверок\n\n```json\n' + JSON.stringify(plan, null, 2) + '\n```\n',
      )
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
