import { setTimeout as pause } from 'node:timers/promises'
import { runJob, type Generate } from '../../packages/runtime/agents.ts'
import { runTeam } from '../../packages/runtime/team.ts'
import { advanceRelease, publicProbe } from './release.ts'
import { complete } from './gateway.ts'
const generate: Generate = async (prompt, block) =>
  JSON.parse(
    await complete(
      'Предложи изменение только данного блока. Верни JSON с field (title, body, schedule или buttonLabel) и value. Используй существующие поля.',
      { request: prompt, block: block.content },
      true,
    ),
  )
const release = process.argv[2] === 'release'
while (true) {
  try {
    if (release) {
      if (!(await advanceRelease(publicProbe))) await pause(1000)
    } else if (process.env.MODEL_ENDPOINT && process.env.MODEL_NAME) {
      const block = await runJob(generate),
        team = await runTeam(complete)
      if (!block && !team) await pause(1200)
    } else await pause(3000)
  } catch {
    console.error('Временная ошибка исполнителя')
    await pause(3000)
  }
}
