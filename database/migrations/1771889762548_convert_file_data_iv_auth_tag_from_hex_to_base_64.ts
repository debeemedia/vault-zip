import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'file_uploads'

  async up() {
    this.defer(async (trx) => {
      const files = await trx.from(this.tableName)

      for (const file of files) {
        const data = file.file_data

        if (!data?.iv || !data?.auth_tag) {
          continue
        }

        const ivBuffer = Buffer.from(data.iv, 'hex')
        const authTagBuffer = Buffer.from(data.auth_tag, 'hex')

        let changed = false

        if (ivBuffer?.length === 12) {
          data.iv = ivBuffer.toString('base64')
          changed = true
        }

        if (authTagBuffer?.length === 16) {
          data.auth_tag = authTagBuffer.toString('base64')
          changed = true
        }

        if (changed) {
          await trx.from(this.tableName).where('id', file.id).update({ file_data: data })
        }
      }
    })
  }

  // No reversal
  async down() {}
}
