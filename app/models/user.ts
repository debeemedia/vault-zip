import { DateTime } from 'luxon'
import {
  afterFetch,
  afterFind,
  BaseModel,
  beforeSave,
  belongsTo,
  column,
  hasMany,
} from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import FileUpload from './file_upload.js'
import EncryptionService from '#services/encryption_service'
import EncryptionKeyVersion from './encryption_key_version.js'
import logger from '@adonisjs/core/services/logger'

export default class User extends BaseModel {
  static ENCRYPTION_PURPOSE = 'Licensing'

  static DECRYPTION_ERROR_MESSAGE = 'UNABLE_TO_DECRYPT'

  @column({ isPrimary: true })
  declare id: string

  @column()
  declare email: string

  @column()
  declare licence_key: string

  @column()
  declare encryption_key_version_id: number

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @hasMany(() => FileUpload, { foreignKey: 'user_id' })
  declare fileUploads: HasMany<typeof FileUpload>

  @belongsTo(() => EncryptionKeyVersion, { foreignKey: 'encryption_key_version_id' })
  declare encryptionKeyVersion: BelongsTo<typeof EncryptionKeyVersion>

  public static async getEncryption(user: User) {
    // Only run if we've selected an encryption_key_version_id to use.
    if (!user.encryption_key_version_id) {
      return null
    }

    const version = await EncryptionKeyVersion.query()
      .select(['id', 'version'])
      .where('id', user.encryption_key_version_id)
      .firstOrFail()

    return {
      encryption: EncryptionService.getEncryption(version.version),
      encryptionVersion: version.version,
    }
  }

  // This hook runs before both creation and update.
  @beforeSave()
  public static async encryptLicenceKey(user: User) {
    if (!user.encryption_key_version_id) {
      // On creation, use the active key version for encryption
      const activeVersion = await EncryptionKeyVersion.query()
        .select(['id', 'version'])
        .where('is_active', true)
        .firstOrFail()

      user.encryption_key_version_id = activeVersion.id
    }

    if (user.$dirty.licence_key) {
      const encryptionResult = await this.getEncryption(user)

      if (!encryptionResult) {
        throw new Error(
          `Failed to encrypt licence_key for ${user.email}: Encryption service unavailable for version ${user.encryption_key_version_id}`
        )
      }

      user.licence_key = encryptionResult.encryption.encrypt(
        user.licence_key,
        undefined,
        User.ENCRYPTION_PURPOSE
      )
    }
  }

  @afterFind()
  public static async decryptSingleLicenceKey(user: User) {
    // Only run if we've selected a licence_key to decrypt.
    if (!user.licence_key) {
      return
    }

    // For decryption, use the key version that was used during encryption
    const encryptionResult = await this.getEncryption(user)

    if (!encryptionResult) {
      return
    }

    const { encryption, encryptionVersion } = encryptionResult

    let licenceKey: string | null

    licenceKey = encryption.decrypt(user.licence_key, User.ENCRYPTION_PURPOSE)

    /**
     * Decryption can return null if key used for encryption changes.
     * Handle gracefully.
     */
    if (!licenceKey) {
      logger.error(
        { userId: user.id, keyVersion: encryptionVersion },
        `[Decryption Failure] Unable to decrypt user's licence key.`
      )

      user.licence_key = User.DECRYPTION_ERROR_MESSAGE

      return
    }

    user.licence_key = licenceKey
  }

  @afterFetch()
  public static async decryptManyLicenceKeys(users: User[]) {
    for (const user of users) {
      await this.decryptSingleLicenceKey(user)
    }
  }
}
