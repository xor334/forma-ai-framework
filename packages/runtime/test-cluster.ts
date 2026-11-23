import EmbeddedPostgres from 'embedded-postgres'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
export async function unusedPort() {
  const s = createServer()
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    s.listen(0, '127.0.0.1', resolve)
  })
  const { port } = s.address() as { port: number }
  await new Promise<void>((r) => s.close(() => r()))
  return port
}
export async function testCluster() {
  const dir = await mkdtemp(join(tmpdir(), 'forma-test-')),
    port = await unusedPort(),
    password = randomBytes(24).toString('hex')
  const cluster = new EmbeddedPostgres({
    autoRehydrateSymlinks: true,
    databaseDir: dir,
    port,
    user: 'postgres',
    password,
    persistent: false,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  })
  try {
    await cluster.initialise()
    await cluster.start()
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    throw e
  }
  return {
    url: 'postgres://postgres:' + password + '@127.0.0.1:' + port + '/postgres',
    close: async () => {
      await cluster.stop()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
