import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import User from './user.js'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

type FileData = {
  original_file_name: string
  file_size: number
  iv: string
  encrypted_file_key: string
  auth_tag?: string
  location?: string
}

export default class FileUpload extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare title: string

  @column()
  declare user_id: string

  @column()
  declare status: FileUploadStatus

  @column()
  declare file_data: FileData

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  @belongsTo(() => User, { foreignKey: 'user_id' })
  declare user: BelongsTo<typeof User>
}

export enum FileUploadStatuses {
  Pending = 'Pending',
  Completed = 'Completed',
}

type FileUploadStatus = `${FileUploadStatuses}`
