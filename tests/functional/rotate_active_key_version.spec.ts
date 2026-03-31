import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import EncryptionKeyVersion from '#models/encryption_key_version'
import env from '#start/env'
import RotateActiveKeyVersion from '../../commands/rotate_active_key_version.js'
import { hashKeySecret } from '../../helpers/command_helper.js'

test.group('Rotate Active Key Version', (group) => {
  const existingAppKey = process.env['APP_KEY']
  const existingAppKeyV1 = process.env['APP_KEY_V1']
  const newVersion = 20

  group.each.setup(async () => {
    ace.ui.switchMode('raw')
    await db.beginGlobalTransaction()

    return async () => {
      // Reset the envs to previous state
      delete process.env[`APP_KEY_V${newVersion}`]

      if (existingAppKey) {
        process.env['APP_KEY'] = existingAppKey
      } else {
        delete process.env['APP_KEY']
      }

      if (existingAppKeyV1) {
        process.env['APP_KEY_V1'] = existingAppKeyV1
      } else {
        delete process.env['APP_KEY_V1']
      }

      ace.ui.switchMode('normal')
      await db.rollbackGlobalTransaction()
    }
  })

  test('should rotate active key version: {$self}')
    .with([
      'main_assertion',
      'version_not_provided',
      'version_not_valid',
      'version_not_in_local_env',
      'operation_cancelled',
      'version_already_exists',
      'version_exists_but_secret_changed',
      'confirmation_version_mismatch',
    ] as const)
    .run(async ({ assert }, condition) => {
      const newKeyValue = 'e1c4G0dLMXXy-LTRSiAyokG-vlngl5WL'

      if (
        condition === 'version_already_exists' ||
        condition === 'version_exists_but_secret_changed'
      ) {
        await EncryptionKeyVersion.create({
          version: String(newVersion),
          is_active: false,
          hash: hashKeySecret(
            condition === 'version_exists_but_secret_changed' ? 'secret' : newKeyValue
          ),
        })
      }

      const keyVersions = await EncryptionKeyVersion.query().orderBy('created_at', 'asc')

      if (
        condition === 'version_already_exists' ||
        condition === 'version_exists_but_secret_changed'
      ) {
        assert.lengthOf(keyVersions, 2)
        assert.isTrue(keyVersions[0].is_active)
        assert.isFalse(keyVersions[1].is_active)
      } else {
        assert.lengthOf(keyVersions, 1)
        assert.isTrue(keyVersions[0].is_active)
      }

      const appKey = env.get('APP_KEY')
      const appKeyV1 = env.get('APP_KEY_V1')
      assert.exists(appKey)
      assert.exists(appKeyV1)

      const oldKeyValue = 'anystringanystringanystring-LTRSiAyokG-vlngl5WL'
      process.env[`APP_KEY`] = oldKeyValue
      process.env[`APP_KEY_V1`] = oldKeyValue
      assert.equal(appKey, appKeyV1)

      if (condition !== 'version_not_in_local_env') {
        process.env[`APP_KEY_V${newVersion}`] = newKeyValue
        process.env[`APP_KEY`] = newKeyValue
      }

      const command = await ace.create(RotateActiveKeyVersion, [
        condition === 'version_not_provided'
          ? ''
          : `--version=${condition === 'version_not_valid' ? 0 : newVersion}`,
      ])

      // Trap the prompt before executing the command
      if (
        condition === 'main_assertion' ||
        condition === 'operation_cancelled' ||
        condition === 'version_already_exists' ||
        condition === 'confirmation_version_mismatch'
      ) {
        command.prompt
          .trap(
            'Are you sure you want to activate this key version? The current active version will be deactivated.'
          )
          .replyWith(true)

        command.prompt
          .trap(
            'WARNING: Once this command finishes, ALL subsequent CLI commands (including this one) will CRASH until you update your APP_KEY in the env. Proceed?'
          )
          .replyWith(condition !== 'operation_cancelled')

        if (condition !== 'operation_cancelled') {
          command.prompt
            .trap(`Type the version number "${newVersion}" to confirm the rotation.`)
            .replyWith(condition === 'confirmation_version_mismatch' ? '500' : newVersion)
        }
      }

      await command.exec()

      //  console.log(JSON.stringify(command.ui.logger.getLogs()))

      if (condition === 'version_not_provided') {
        command.assertLog('[ red(error) ] Provide the version.', 'stderr')
      }
      if (condition === 'version_not_valid') {
        command.assertLog(
          '[ red(error) ] Version must be a positive whole number greater than zero.',
          'stderr'
        )
      }
      if (condition === 'version_not_in_local_env') {
        command.assertLog(
          `[ red(error) ] Environment variable "APP_KEY_V${newVersion}" is missing!`,
          'stderr'
        )
      }
      if (condition === 'version_exists_but_secret_changed') {
        command.assertLog(
          `[ red(error) ] Security Alert: The secret for APP_KEY_V${newVersion} does not match the original hash stored in the database. Version secrets cannot be changed once established.`,
          'stderr'
        )
      }
      if (condition === 'confirmation_version_mismatch') {
        command.assertLog(`[ red(error) ] Version mismatch. Rotation aborted.`, 'stderr')
      }

      if (
        condition === 'main_assertion' ||
        condition === 'operation_cancelled' ||
        condition === 'version_already_exists'
      ) {
        command.assertSucceeded()
      } else {
        command.assertFailed()
      }

      if (condition === 'operation_cancelled') {
        command.assertLog('[ blue(info) ] Operation cancelled.', 'stdout')
      }

      if (condition === 'main_assertion' || condition === 'version_already_exists') {
        command.assertLog(
          '[ yellow(warn) ] CRITICAL OPERATION: You are about to change the active encryption key.',
          'stdout'
        )

        command.assertLog(`[ blue(info) ] New Active Version: V${newVersion}`, 'stdout')

        command.assertLog(
          `[ blue(info) ] Required APP_KEY: ${newKeyValue.substring(0, 4)}...${newKeyValue.substring(newKeyValue.length - 4)}`,
          'stdout'
        )

        command.assertLog('[ blue(info) ] Updating active key version...', 'stdout')

        command.assertLog(
          `[ green(success) ] Rotation successful in DB. Ensure your env is updated: set APP_KEY to match APP_KEY_V${newVersion} to prevent subsequent boot failure.`,
          'stdout'
        )
      }

      // If the provided version already exists, the command succeeds and the version is set to active, while the previously active version is deactivated.

      const updatedKeyVersions = await EncryptionKeyVersion.query()
      assert.lengthOf(
        updatedKeyVersions,
        condition === 'main_assertion' ||
          condition === 'version_already_exists' ||
          condition === 'version_exists_but_secret_changed'
          ? 2
          : 1
      )

      if (condition !== 'main_assertion') {
        return
      }

      const newActiveKeyVersion = updatedKeyVersions.find((version) => version.is_active)
      assert.exists(newActiveKeyVersion)

      assert.equal(newActiveKeyVersion!.version, newVersion)

      assert.isFalse(
        updatedKeyVersions.find((version) => version.id !== newActiveKeyVersion!.id)!.is_active
      )
    })
    .tags(['key_versions', 'rotate_active_key_version'])
})
