import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import ListKeyVersions from '../../commands/list_key_versions.js'
import EncryptionKeyVersion from '#models/encryption_key_version'
import { hashKeySecret } from '../../helpers/command_helper.js'

test.group('List Key Versions', (group) => {
  group.each.setup(async () => {
    ace.ui.switchMode('raw')
    await db.beginGlobalTransaction()

    return async () => {
      ace.ui.switchMode('normal')
      await db.rollbackGlobalTransaction()
    }
  })

  test('should list key versions: {$self}')
    .with(['main_assertion', 'narrow_terminal_width', 'no_key_version_found'] as const)
    .run(async ({ assert }, condition) => {
      const isNarrowTerminalWidth = condition === 'narrow_terminal_width'
      const isNoKeyVersionFound = condition === 'no_key_version_found'

      if (process.stdout) {
        process.stdout.columns = isNarrowTerminalWidth ? 80 : 120
      }

      const keyVersions = await EncryptionKeyVersion.query()
      assert.lengthOf(keyVersions, 1)
      assert.isTrue(keyVersions[0].is_active)

      if (isNoKeyVersionFound) {
        await keyVersions[0].delete()
      } else {
        // Let's create another inactive encryption key in the db, that is also missing in the env
        await EncryptionKeyVersion.create({
          version: '2',
          is_active: false,
          hash: hashKeySecret('secret'),
        })
      }

      const updatedKeyVersions = await EncryptionKeyVersion.query()

      if (!isNoKeyVersionFound) {
        assert.lengthOf(updatedKeyVersions, 2)
      }

      const command = await ace.create(ListKeyVersions, [])

      await command.exec()

      //  console.log(JSON.stringify(command.ui.logger.getLogs()))

      command.assertSucceeded()

      if (isNoKeyVersionFound) {
        return command.assertLog('[ blue(info) ] No key versions found in the database.', 'stdout')
      }

      if (isNarrowTerminalWidth) {
        command.assertLog(
          '[ yellow(warn) ] Terminal width is narrow. The table below might look messy.',
          'stdout'
        )
      }

      command.assertLog('[ blue(info) ] Encryption Key Versions:', 'stdout')

      const tableData = updatedKeyVersions.map((version) => [
        version.version,

        version.is_active ? command.colors.green('ACTIVE') : command.colors.gray('Inactive'),

        version.id === keyVersions[0].id ? 'Present' : command.colors.red('MISSING'),

        version.created_at.toFormat('yyyy-MM-dd HH:mm'),

        version.updated_at.toFormat('yyyy-MM-dd HH:mm'),
      ])

      command.assertTableRows([
        ['Version', 'Status', 'Present in Env?', 'Created At', 'Updated At'],
        ...tableData,
      ])
    })
    .tags(['key_versions', 'list_key_versions'])
})
