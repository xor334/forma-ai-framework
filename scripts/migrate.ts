import { migrate } from '../packages/runtime/migrate.ts'
import { disconnect } from '../packages/runtime/db.ts'
try {
  await migrate()
} finally {
  await disconnect()
}
