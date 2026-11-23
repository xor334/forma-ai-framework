import { cms } from '../apps/studio/auth.ts'
const payload = await cms()
try {
  await payload.db.migrate()
} finally {
  await payload.destroy()
}
