import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import { hashKeySecret } from '../helpers/command_helper.js'
import EncryptionKeyVersion from '#models/encryption_key_version'

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
    const providedVersion = this.version?.trim()
    if (!providedVersion) {
      this.logger.error('Provide the version.')
      return (this.exitCode = 1)
    }

    if (!/^[1-9]\d*$/.test(providedVersion)) {
      this.logger.error('Version must be a positive whole number greater than zero.') // For now
      return (this.exitCode = 1)
    }

    const envKey = `APP_KEY_V${providedVersion}`

    const secret = process.env[envKey]
    if (!secret) {
      this.logger.error(`Environment variable "${envKey}" is missing!`)

      return (this.exitCode = 1)
    }

    const existingVersion = await EncryptionKeyVersion.query()
      .select(['id', 'hash'])
      .where('version', providedVersion)
      .first()

    const hash = hashKeySecret(secret)

    if (existingVersion && hash !== existingVersion.hash) {
      this.logger.error(
        `Security Alert: The secret for ${envKey} does not match the original hash stored in the database. Version secrets cannot be changed once established.`
      )
      return (this.exitCode = 1)
    }

    // Be absolutely sure of what you're doing
    this.logger.warning('CRITICAL OPERATION: You are about to change the active encryption key.')

    this.logger.info(`New Active Version: V${providedVersion}`)

    this.logger.info(
      `Required APP_KEY: ${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`
    )

    const confirm1 = await this.prompt.confirm(
      'Are you sure you want to activate this key version? The current active version will be deactivated.'
    )

    const cancelOperation = () => {
      this.logger.info('Operation cancelled.')

      this.exitCode = 0
    }

    if (!confirm1) {
      return cancelOperation()
    }

    const confirm2 = await this.prompt.confirm(
      'WARNING: Once this command finishes, ALL subsequent CLI commands (including this one) will CRASH until you update your APP_KEY in the env. Proceed?'
    )

    if (!confirm2) {
      return cancelOperation()
    }

    const typedVersion = await this.prompt.ask(
      `Type the version number "${providedVersion}" to confirm the rotation.`
    )
    if (String(typedVersion)?.trim() !== String(providedVersion)) {
      this.logger.error('Version mismatch. Rotation aborted.')

      return (this.exitCode = 1)
    }

    this.logger.info('Updating active key version...')

    try {
      await db.transaction(async (trx) => {
        await trx.rawQuery(`
          UPDATE encryption_key_versions SET is_active = false WHERE is_active = true;
          `)

        const query = existingVersion
          ? `
          UPDATE encryption_key_versions
          SET is_active = true, updated_at = NOW()
          WHERE version = :version
        `
          : `
        INSERT INTO encryption_key_versions (version, is_active, hash, created_at, updated_at)
        VALUES (:version, true, :hash, NOW(), NOW())
        `

        await trx.rawQuery(query, { version: providedVersion, hash })
      })

      this.logger.success(
        `Rotation successful in DB. Ensure your env is updated: set APP_KEY to match ${envKey} to prevent subsequent boot failure.`
      )

      /**
       * Note: Because this application works primarily with commands, if the APP_KEY is not updated to mirror the new active key, running any command will immediately trigger the check in the App Provider and cause a crash until the key is updated.
       * In a normal app, this check would likely not kick in because the app is already running, except if the check is applied before every HTTP request (as in a middleware) or if the application is restarted after every successful rotation of the active key.
       */
    } catch (error) {
      this.logger.error(`Rotation failed: ${error.message}`)
      this.exitCode = 1
    }
  }
}
