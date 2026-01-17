import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import encryption from '@adonisjs/core/services/encryption'

export default class User extends BaseModel {
  static ENCRYPTION_PURPOSE = 'Licensing'

  @column({ isPrimary: true })
  declare id: string

  @column()
  declare email: string

  @column({
    columnName: 'licence_key',
    prepare: (value: string) => encryption.encrypt(value, undefined, User.ENCRYPTION_PURPOSE),
    consume: (value: string) => encryption.decrypt(value, User.ENCRYPTION_PURPOSE),
  })
  declare licence_key: string

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime
}
