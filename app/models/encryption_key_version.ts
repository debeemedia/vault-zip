import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import FileUpload from './file_upload.js'
import User from './user.js'

export default class EncryptionKeyVersion extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare version: string

  @column()
  declare is_active: boolean

  @column()
  declare hash: string

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  @hasMany(() => User, { foreignKey: 'encryption_key_version_id' })
  declare users: HasMany<typeof User>

  @hasMany(() => FileUpload, { foreignKey: 'encryption_key_version_id' })
  declare fileUploads: HasMany<typeof FileUpload>
}
