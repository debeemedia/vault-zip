import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableNames = ['users', 'file_uploads']

  async up() {
    for (const tableName of this.tableNames) {
      this.schema.alterTable(tableName, (table) => {
        table.integer('encryption_key_version_id').nullable().index()

        table
          .foreign('encryption_key_version_id')
          .references('id')
          .inTable('encryption_key_versions')
          .onUpdate('CASCADE')
          .onDelete('RESTRICT')
      })
    }

    this.defer(async (trx) => {
      const v1 = await trx.from('encryption_key_versions').where('version', '1').firstOrFail()

      for (const tableName of this.tableNames) {
        await trx.rawQuery(`
          UPDATE ${tableName} SET encryption_key_version_id = '${v1.id}' WHERE encryption_key_version_id IS NULL;
          `)
      }
    })

    this.defer(async (trx) => {
      for (const tableName of this.tableNames) {
        await trx.rawQuery(`
          ALTER TABLE ${tableName} ALTER COLUMN encryption_key_version_id SET NOT NULL
          `)
      }
    })
  }

  async down() {
    for (const tableName of this.tableNames) {
      this.schema.alterTable(tableName, (table) => {
        table.dropColumn('encryption_key_version_id')
      })
    }
  }
}
