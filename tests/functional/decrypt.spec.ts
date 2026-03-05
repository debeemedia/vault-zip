import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import { cuid } from '@adonisjs/core/helpers'
import User from '#models/user'
import { rm } from 'fs/promises'
import drive from '@adonisjs/drive/services/main'
import ConfigService from '#services/config_service'
import { readFileSync } from 'node:fs'
import Decrypt from '../../commands/decrypt.js'
import { basename } from 'node:path'
import { uploadFiles } from '../../helpers/test_helper.js'
import fs from 'node:fs'

test.group('Decrypt', (group) => {
  group.each.setup(async () => {
    ace.ui.switchMode('raw')
    await db.beginGlobalTransaction()

    return async () => {
      ace.ui.switchMode('normal')
      await db.rollbackGlobalTransaction()
    }
  })

  test('should decrypt a file: {$self}')
    .with(['main_assertion', 'licence_key_not_local', 'override_key_provided'] as const)
    .run(async ({ assert }, condition) => {
      const isLicenceKeyNotSavedLocally = condition === 'licence_key_not_local'
      const isOverrideKeyProvided = condition === 'override_key_provided'

      // Register the user first
      const email = 'test@example.com'
      const user = await User.create({
        email,
        licence_key: cuid(),
      })

      await ConfigService.saveLicenceKey(isLicenceKeyNotSavedLocally ? '' : user!.licence_key)

      // Upload some files for the user and download encrypted files locally
      const uploadResult = await uploadFiles({ assert, user, saveLocally: true })

      assert.isDefined(uploadResult)

      // To resolve type error
      if (!uploadResult) {
        return
      }

      const { originalFileBuffers, encryptedFileOutputPaths } = uploadResult

      assert.exists(originalFileBuffers)
      assert.lengthOf(originalFileBuffers!, 2)

      assert.exists(encryptedFileOutputPaths)
      assert.lengthOf(encryptedFileOutputPaths!, 2)

      const command = await ace.create(Decrypt, [
        encryptedFileOutputPaths[0],
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

      await command.exec()

      command.assertSucceeded()

      command.assertLog(
        `[ blue(info) ] Decrypting "${basename(encryptedFileOutputPaths[0])}"...`,
        'stdout'
      )

      const decryptedFileOutputPath = encryptedFileOutputPaths[0].replace(/\.vault$/, '')

      command.assertLog(
        `[ green(success) ] File has been successfully decrypted to: "${decryptedFileOutputPath}"`,
        'stdout'
      )

      const decryptedFileBuffer = readFileSync(decryptedFileOutputPath)

      // Assert that the decrypted file buffer and the original file buffer are the same
      assert.deepEqual(decryptedFileBuffer, originalFileBuffers[0])

      assert.isTrue(decryptedFileBuffer.equals(originalFileBuffers[0]))

      // Cleanup
      for (const path of [...encryptedFileOutputPaths, decryptedFileOutputPath]) {
        await rm(path, { force: true })
      }

      await user.load('fileUploads')

      for (const upload of user.fileUploads) {
        await drive.use('s3').delete(upload.file_data.location!)
      }
    })
    .tags(['decrypt'])

  test('should fail to decrypt if: {$self}')
    .with([
      'licence_key_not_provided',
      'incorrect_licence_key',
      'encrypted_file_tampered_with',
      'bundle_extname_not_.vault',
      'bundle_header_out_of_bounds',
      'bundle_metadata_malformed',
    ] as const)
    .run(async ({ assert }, condition) => {
      const email = 'test@example.com'

      const user = await User.create({ email, licence_key: cuid() })

      const uploadResult = await uploadFiles({ assert, user, saveLocally: true })

      assert.isDefined(uploadResult)

      // To resolve type error
      if (!uploadResult) {
        return
      }

      const { encryptedFileOutputPaths } = uploadResult

      if (condition === 'encrypted_file_tampered_with') {
        fs.appendFileSync(encryptedFileOutputPaths[0], 'Tampered')
      }

      let nonVaultPath = encryptedFileOutputPaths[0].replace(/\.vault$/, '.pdf')

      if (condition === 'bundle_extname_not_.vault') {
        fs.copyFileSync(encryptedFileOutputPaths[0], nonVaultPath)
      }

      if (condition === 'bundle_header_out_of_bounds') {
        const fd = fs.openSync(encryptedFileOutputPaths[0], 'r+')

        const buffer = Buffer.alloc(4)
        buffer.writeUInt32BE(20000)

        // Write an unrealistic number into the first 4 bytes so that the CLI tries to read more than the metadata size
        fs.writeSync(fd, buffer, 0, 4, 0)

        fs.closeSync(fd)
      }

      if (condition === 'bundle_metadata_malformed') {
        const fd = fs.openSync(encryptedFileOutputPaths[0], 'r+')

        const garbage = Buffer.from('NOT_JSON_LOGIC')

        // Overwrite the actual metadata with garbage
        fs.writeSync(fd, garbage, 0, garbage.length, 4)

        fs.closeSync(fd)
      }

      const command = await ace.create(Decrypt, [
        condition === 'bundle_extname_not_.vault' ? nonVaultPath : encryptedFileOutputPaths[0],
        '--override-key',
      ])

      // Trap the prompt before executing the command
      command.prompt
        .trap('Enter the override licence key')
        .replyWith(
          condition === 'licence_key_not_provided'
            ? ''
            : condition === 'incorrect_licence_key'
              ? cuid()
              : user.licence_key
        )

      await command.exec()

      command.assertFailed()

      let message = ''

      switch (condition) {
        case 'licence_key_not_provided':
          message = 'Licence key is required.'
          break

        case 'incorrect_licence_key':
        case 'encrypted_file_tampered_with':
          message = 'Decryption failed. The file was modified or the licence key is incorrect.'
          break

        case 'bundle_extname_not_.vault':
          message = 'Provide a ".vault" file.'
          break

        case 'bundle_header_out_of_bounds':
          message = 'Invalid vault file: Header size is out of bounds.'
          break

        case 'bundle_metadata_malformed':
          message = 'Invalid vault file: Metadata is not a valid JSON object.'
          break

        default:
          throw new Error('Invalid condition')
      }

      command.assertLog(`[ red(error) ] ${message}`, 'stderr')

      // Assert that any corrupted file was cleaned up
      const decryptedFileOutputPath = encryptedFileOutputPaths[0].replace(/\.vault$/, '')

      assert.isFalse(fs.existsSync(decryptedFileOutputPath))

      // Cleanup
      for (const path of [...encryptedFileOutputPaths, nonVaultPath]) {
        await rm(path, { force: true })
      }

      await user.load('fileUploads')
      for (const upload of user.fileUploads) {
        await drive.use('s3').delete(upload.file_data.location!)
      }
    })
    .tags(['decrypt'])
})
