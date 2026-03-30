import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import { cuid } from '@adonisjs/core/helpers'
import User from '#models/user'
import { rm } from 'fs/promises'
import drive from '@adonisjs/drive/services/main'
import Download from '../../commands/download.js'
import ConfigService from '#services/config_service'
import {
  anotherUserFileTitlePrefix,
  targetUserFileTitlePrefix,
  uploadFiles,
} from '../../helpers/test_helper.js'

test.group('Download', (group) => {
  group.each.setup(async () => {
    ace.ui.switchMode('raw')
    await db.beginGlobalTransaction()

    return async () => {
      ace.ui.switchMode('normal')
      await db.rollbackGlobalTransaction()
    }
  })

  test('should download a file: {$self}')
    .with([
      'main_assertion',
      'narrow_terminal_width',
      'licence_key_not_local',
      'override_key_provided',
      'no_file_uploaded',
    ] as const)
    .run(async ({ assert }, condition) => {
      const isNarrowTerminalWidth = condition === 'narrow_terminal_width'
      const isLicenceKeyNotSavedLocally = condition === 'licence_key_not_local'
      const isOverrideKeyProvided = condition === 'override_key_provided'
      const isNoFileUploaded = condition === 'no_file_uploaded'

      if (process.stdout) {
        process.stdout.columns = isNarrowTerminalWidth ? 80 : 120
      }

      // Register the user first
      const email = 'test@example.com'
      // Also register another user to assert that that user's files are not returned for the target user
      const users = await User.createMany(
        [email, 'another@example.com'].map((email) => ({
          email,
          licence_key: cuid(),
        }))
      )

      assert.lengthOf(users, 2)

      users.map(async (u) => {
        assert.exists(u.encryption_key_version_id)
      })

      const user = users.find((u) => u.email === email)
      assert.exists(user)

      // Refresh to trigger the afterFind hook and get the decrypted licence key
      await user!.refresh()

      await ConfigService.saveLicenceKey(isLicenceKeyNotSavedLocally ? '' : user!.licence_key)

      // Upload some files for the users
      if (!isNoFileUploaded) {
        for (const u of users) {
          await uploadFiles({ assert, user: u, isNotTargetUser: u.email !== email })
        }
      }

      const command = await ace.create(Download, [
        `--email=${email}`,
        isOverrideKeyProvided ? '--override-key' : '',
      ])

      // Trap the prompt before executing the command
      if (isLicenceKeyNotSavedLocally) {
        command.prompt
          .trap('Enter your licence key (not found in config).')
          .replyWith(user!.licence_key)
      }

      if (isOverrideKeyProvided) {
        command.prompt.trap('Enter the override licence key').replyWith(user!.licence_key)
      }

      if (!isNoFileUploaded) {
        command.prompt.trap('Select the file to download').chooseOption(0)
      }

      await command.exec()

      command.assertSucceeded()

      command.assertLog('[ blue(info) ] Getting your files...', 'stdout')

      if (isNoFileUploaded) {
        return command.assertLog('[ blue(info) ] You have not uploaded any file.', 'stdout')
      }

      if (isNarrowTerminalWidth) {
        command.assertLog(
          '[ yellow(warn) ] Terminal width is narrow. The table below might look messy.',
          'stdout'
        )
      }

      // Assert that the target user's files are returned
      const fileTableData = user!.fileUploads.map((upload) => [
        upload.id,
        upload.title,
        upload.file_data.original_file_name,
        `${(upload.file_data.file_size / (1024 * 1024)).toFixed(2)} MB`,
      ])

      command.assertTableRows([
        ['ID', 'Title', 'Original File Name', 'File Size Approx'],
        ...fileTableData,
      ])

      // Assert that the logs pertaining to file data are for the target user's files
      const fileLogs = command.ui.logger
        .getLogs()
        .filter(
          (log) =>
            log.message.includes('MB') /** e.g. under File Size Approx: 1.00 MB */ &&
            log.stream === 'stdout'
        )

      assert.lengthOf(fileLogs, user!.fileUploads.length)

      assert.isTrue(fileLogs.every((log) => log.message.includes(targetUserFileTitlePrefix)))

      assert.isFalse(fileLogs.some((log) => log.message.includes(anotherUserFileTitlePrefix)))

      command.assertLog('[ blue(info) ] Downloading encrypted bundle...', 'stdout')

      // We selected the latest file for download
      const responseFileName = `${user!.fileUploads[0].file_data.original_file_name}.vault`

      const outputPath = ConfigService.getDownloadPath(responseFileName)

      command.assertLog(
        `[ green(success) ] Download complete. Encrypted bundle saved to ${outputPath}`,
        'stdout'
      )

      // Cleanup
      await rm(outputPath, { force: true })

      for (const u of users) {
        await u.load('fileUploads')

        for (const upload of u.fileUploads) {
          await drive.use('s3').delete(upload.file_data.location!)
        }
      }
    })
    .tags(['download'])

  test('should fail to download if: {$self}')
    .with([
      'email_not_provided',
      'email_not_exist',
      'licence_key_not_provided',
      'incorrect_licence_key',
    ] as const)
    .run(async ({ assert }, condition) => {
      const email = 'test@example.com'

      const user = await User.create({ email, licence_key: cuid() })

      // Upload some files for the user
      await uploadFiles({ assert, user })

      const command = await ace.create(Download, [
        condition === 'email_not_provided'
          ? ''
          : `--email=${condition === 'email_not_exist' ? 'invalid' : email}`,
        '--override-key',
      ])

      // Trap the prompt before executing the command
      if (condition !== 'email_not_provided') {
        command.prompt
          .trap('Enter the override licence key')
          .replyWith(
            condition === 'licence_key_not_provided'
              ? ''
              : condition === 'incorrect_licence_key'
                ? cuid()
                : user.licence_key
          )
      }

      await command.exec()

      command.assertFailed()

      let message = ''

      switch (condition) {
        case 'email_not_provided':
          message = 'Provide your email.'
          break

        case 'email_not_exist':
          message = 'The email does not exist.'
          break

        case 'licence_key_not_provided':
          message = 'Licence key is required.'
          break

        case 'incorrect_licence_key':
          message = 'Provide your email with the corresponding licence key.'
          break

        default:
          throw new Error('Invalid condition')
      }

      command.assertLog(`[ red(error) ] ${message}`, 'stderr')

      // Cleanup
      for (const upload of user.fileUploads) {
        await drive.use('s3').delete(upload.file_data.location!)
      }
    })
    .tags(['download'])
})
