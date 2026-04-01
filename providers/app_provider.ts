import type { ApplicationService } from '@adonisjs/core/types'
import { BaseModel, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import { hashKeySecret } from '../helpers/command_helper.js'

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {}

  /**
   * The container bindings have booted
   */
  async boot() {
    // Forces Lucid to map database snake_case columns to model properties and ensures `.serialize()` outputs snake_case keys.
    // Note: Foreign keys must still be explicitly defined in snake_case on the model.
    BaseModel.namingStrategy = new SnakeCaseNamingStrategy()
  }

  /**
   * The application has been booted
   */
  async start() {
    /**
     * Ensure that the APP_KEY used for encryptions matches the active version in the database, to prevent failure during decryption.
     *
     * Note: This check is placed here in the `start` rather than the `boot` lifecycle method because the db connection is already resolved and ready here.
     */
    const db = (await import('@adonisjs/lucid/services/db')).default

    const tableName = 'encryption_key_versions'

    if (
      (await db.connection().schema.hasTable(tableName)) &&
      (await db.from(tableName).select('id').first()) &&
      (await db.connection().schema.hasColumn(tableName, 'hash'))
    ) {
      // If the table is empty, we assume it's a fresh install/migration phase.
      // We only throw if there is data, but none is active, or if the hash is wrong.
      const activeKey = await db
        .from(tableName)
        .select(['id', 'hash', 'version'])
        .where({ is_active: true })
        .first()

      if (!activeKey) {
        throw new Error(`[CRITICAL SECURITY ERROR]: No active encryption key found in database.`)
      }

      if (hashKeySecret(process.env.APP_KEY || '') !== activeKey.hash) {
        throw new Error(
          `[CRITICAL SECURITY ERROR]: The APP_KEY in your environment does not match the active database version "${activeKey.version}"`
        )
      }
    }
  }

  /**
   * The process has been started
   */
  async ready() {}

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {}
}
