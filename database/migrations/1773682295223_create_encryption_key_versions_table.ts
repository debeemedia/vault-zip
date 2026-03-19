import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'encryption_key_versions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('version').index().notNullable().unique()
      table
        .boolean('is_active')
        .defaultTo('false')
        .notNullable()
        .comment('Set to true when the version is in current use for new encryptions.')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })

    this.defer(async (trx) => {
      await trx.rawQuery(`
        INSERT INTO ${this.tableName} (version, is_active, created_at, updated_at)
        VALUES ('1', true, NOW(), NOW())
        `)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
