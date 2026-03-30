import EncryptionKeyVersion from '#models/encryption_key_version'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class ListKeyVersions extends BaseCommand {
  static commandName = 'vault-zip:list-key-versions'
  static description = 'View all encryption key versions, their status, and if present in env.'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  async run() {
    const versions = await EncryptionKeyVersion.query()
      .select(['id', 'version', 'is_active', 'created_at', 'updated_at'])
      // Active status should always come first
      .orderByRaw('is_active DESC, version DESC')

    if (!versions.length) {
      this.logger.info('No key versions found in the database.')

      return (this.exitCode = 0)
    }

    if (process?.stdout?.columns < 100) {
      this.logger.warning('Terminal width is narrow. The table below might look messy.')
    }

    const table = this.ui.table()

    table.head(['Version', 'Status', 'Present in Env?', 'Created At', 'Updated At'])

    versions.forEach((version) => {
      const envKey = `APP_KEY_V${version.version}`

      const keyExists = !!process.env[envKey]

      table.row([
        version.version,

        version.is_active ? this.colors.green('ACTIVE') : this.colors.gray('Inactive'),

        keyExists ? 'Present' : this.colors.red('MISSING'),

        version.created_at.toFormat('yyyy-MM-dd HH:mm'),

        version.updated_at.toFormat('yyyy-MM-dd HH:mm'),
      ])
    })

    this.logger.info('Encryption Key Versions:')

    table.render()
  }
}
