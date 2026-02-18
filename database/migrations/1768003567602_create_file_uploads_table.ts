import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'file_uploads'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary().index()
      table.string('title').notNullable().index()
      table.jsonb('file_data')
      table.bigInteger('user_id').notNullable().index()
      table.enum('status', ['Pending', 'Completed']).notNullable().index()

      table.timestamp('created_at').notNullable().index()
      table.timestamp('updated_at').notNullable().index()

      table
        .foreign('user_id')
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
