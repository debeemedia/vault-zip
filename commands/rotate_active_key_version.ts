import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'

export default class RotateActiveKeyVersion extends BaseCommand {
  static commandName = 'vault-zip:rotate-active-key-version'
  static description =
    'Update active key version for encryption. If the provided version already exists, it will be made active.'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.string()
  declare version: string

  async run() {
    if (!this.version?.trim()) {
      this.logger.error('Provide the version.')
      return (this.exitCode = 1)
    }

    if (!/^[1-9]\d*$/.test(this.version)) {
      this.logger.error('Version must be a positive whole number greather than zero.') // For now
      return (this.exitCode = 1)
    }

    const envKey = `APP_KEY_V${this.version}`

    if (!process.env[envKey]) {
      this.logger.error(`Environment variable "${envKey}" is missing!`)
      return (this.exitCode = 1)
    }

    const shouldRotate = await this.prompt.confirm(
      'Are you sure you want to activate this key version? The current active version will be deactivated.'
    )

    if (shouldRotate) {
      this.logger.info('Updating active key version...')
    } else {
      this.logger.info('Operation cancelled.')

      return
    }

    try {
      await db.transaction(async (trx) => {
        await trx.rawQuery(`
          UPDATE encryption_key_versions SET is_active = false WHERE is_active = true;
          `)

        const existingVersion = await trx
          .from('encryption_key_versions')
          .where('version', this.version)
          .first()

        const query = existingVersion
          ? `
          UPDATE encryption_key_versions
          SET is_active = true, updated_at = NOW()
          WHERE version = :version
        `
          : `
        INSERT INTO encryption_key_versions (version, is_active, created_at, updated_at)
        VALUES (:version, true, NOW(), NOW())
        `

        await trx.rawQuery(query, { version: this.version })
      })

      this.logger.success('Key version updated successfully')
    } catch (error) {
      this.logger.error(`Rotation failed: ${error.message}`)
      this.exitCode = 1
    }
  }
}
