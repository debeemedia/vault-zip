import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import { cuid } from '@adonisjs/core/helpers'
import Register from '../../commands/register.js'
import User from '#models/user'
import app from '@adonisjs/core/services/app'
import { basename } from 'path'

test.group('Register', (group) => {
  group.each.setup(async () => {
    ace.ui.switchMode('raw')
    await db.beginGlobalTransaction()

    return async () => {
      ace.ui.switchMode('normal')
      await db.rollbackGlobalTransaction()
    }
  })

  test('should register or not register a user: {$self}')
    .with(['main_assertion', 'email_not_provided', 'email_already_exists'] as const)
    .run(async ({ assert }, condition) => {
      const email = 'test@example.com'

      const command = await ace.create(Register, [
        condition === 'email_not_provided' ? '' : `--email=${email}`,
      ])

      if (condition === 'email_already_exists') {
        await User.create({ email, licence_key: cuid() })
      }

      await command.exec()

      if (condition !== 'main_assertion') {
        command.assertFailed()

        return command.assertLog(
          condition === 'email_already_exists'
            ? `[ red(error) ] Email already exists.`
            : `[ red(error) ] Email is required.`
        )
      }

      command.assertSucceeded()

      const user = await User.findBy({ email })

      assert.exists(user)
      assert.isNotEmpty(user!.licence_key)

      command.assertLog(
        `[ blue(info) ] Licence key saved locally to ./${basename(app.makePath('.vault-config.test.json'))}`
      )

      command.assertLog(`[ blue(info) ] Registration successful.`)

      // Assert that the licence key returned (decrypted) is different from what is stored (encrypted)
      const rawUser = await db.from('users').where({ email }).first()

      assert.equal(rawUser.id, user!.id)
      assert.equal(rawUser.email, user!.email)
      assert.notEqual(rawUser.licence_key, user!.licence_key)
    })
    .tags(['register'])
})
