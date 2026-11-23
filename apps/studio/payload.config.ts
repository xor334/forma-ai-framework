import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { resolve } from 'node:path'

const secret = process.env.PAYLOAD_SECRET
if (!secret || secret.length < 32) throw Error('PAYLOAD_SECRET должен содержать минимум 32 символа')
export default buildConfig({
  secret,
  telemetry: false,
  admin: { disable: true },
  graphQL: { disable: true },
  typescript: { autoGenerate: false },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL },
    schemaName: 'studio',
    push: false,
    disableCreateDatabase: true,
    migrationDir: resolve(process.env.FORMA_ROOT || '.', 'apps/studio/migrations'),
  }),
  collections: [
    {
      slug: 'users',
      auth: { tokenExpiration: 3600, maxLoginAttempts: 8, lockTime: 900000 },
      admin: { useAsTitle: 'email' },
      access: {
        create: () => false,
        delete: () => false,
        read: ({ req }) => Boolean(req.user),
        update: () => false,
      },
      fields: [
        {
          name: 'role',
          type: 'select',
          required: true,
          options: ['owner', 'editor', 'operator'],
          defaultValue: 'editor',
        },
      ],
    },
  ],
})
