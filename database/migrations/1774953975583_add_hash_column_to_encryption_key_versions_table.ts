import { BaseSchema } from '@adonisjs/lucid/schema'
import { hashKeySecret } from '../../helpers/command_helper.js'

export default class extends BaseSchema {
  protected tableName = 'encryption_key_versions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('hash').nullable() // string is enough for sha256 which outputs 64 characters.
    })

    this.defer(async (db) => {
      const encryptionVersions = await db.from(this.tableName).select('id', 'version')

      for (const encryptionVersion of encryptionVersions) {
        const envKey = `APP_KEY_V${encryptionVersion.version}`
        const secret = process.env[envKey]

        if (!secret) {
          throw new Error(
            `Migration Failed: Missing ${envKey} in environment. Required to generate hashes.`
          )
        }

        const hash = hashKeySecret(secret)

        await db.from(this.tableName).where('id', encryptionVersion.id).update({ hash })
      }

      await db.schema.alterTable(this.tableName, (table) => {
        table.string('hash').notNullable().alter()
      })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('hash')
    })
  }
}
