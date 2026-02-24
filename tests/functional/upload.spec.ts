import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import { cuid } from '@adonisjs/core/helpers'
import User from '#models/user'
import { join } from 'path'
import { mkdir, rm } from 'fs/promises'
import Upload from '../../commands/upload.js'
import drive from '@adonisjs/drive/services/main'
import { FileUploadStatuses } from '#models/file_upload'
import { faker } from '@faker-js/faker'
import app from '@adonisjs/core/services/app'
import {
  allowedExtensions,
  allowedPattern,
  maxFileSizeMB,
} from '../../helpers/file_upload_helper.js'
import AdmZip from 'adm-zip'
import { randomBytes } from 'crypto'
import fs from 'fs'

const testDir = app.makePath('tmp', 'tests')

async function constructFilePath(isExtNameUnsupported: boolean = false) {
  await mkdir(testDir, { recursive: true })

  return join(testDir, `${Date.now()}${isExtNameUnsupported ? '.mp4' : '.zip'}`)
}

let testFilePath = await constructFilePath()

test.group('Upload', (group) => {
  group.each.setup(async () => {
    ace.ui.switchMode('raw')
    await db.beginGlobalTransaction()

    return async () => {
      ace.ui.switchMode('normal')
      await db.rollbackGlobalTransaction()
      await rm(testFilePath, { force: true })
    }
  })

  test('should upload a file')
    .run(async ({ assert }) => {
      const email = 'test@example.com'

      const user = await User.create({ email, licence_key: cuid() })

      const title = 'My Important File'

      const textFileContent = faker.lorem.sentence()
      const textFileName = 'test.txt'

      const zipFile = new AdmZip()
      zipFile.addFile(textFileName, Buffer.from(textFileContent))

      await zipFile.writeZipPromise(testFilePath)

      // Assert that it is a valid zip
      const zipEntries = zipFile.getEntries()

      assert.lengthOf(zipEntries, 1)
      assert.equal(zipEntries[0].entryName, textFileName)

      assert.containSubset(zipEntries[0].getData().toString('utf-8'), textFileContent)

      // Assert the magic number
      const buffer = zipFile.toBuffer()
      assert.equal(buffer[0], 0x50)
      assert.equal(buffer[1], 0x4b)
      assert.equal(buffer[2], 0x03)
      assert.equal(buffer[3], 0x04)

      const command = await ace.create(Upload, [
        testFilePath,
        `--email=${email}`,
        `--title=${title}`,
      ])

      await command.exec()

      command.assertSucceeded()

      command.assertLog('[ green(success) ] File upload successful.')

      await user.load('fileUploads')

      assert.lengthOf(user.fileUploads, 1)

      const upload = user.fileUploads[0].serialize()

      assert.containSubset(upload, {
        title,
        user_id: user.id,
        status: FileUploadStatuses.Completed,
      })

      assert.properties(upload, ['id', 'file_data', 'created_at', 'updated_at'])

      assert.notEqual(upload.created_at, upload.updated_at)

      assert.properties(upload.file_data, [
        'iv',
        'auth_tag',
        'location',
        'encrypted_file_key',
        'original_file_name',
        'file_size',
      ])

      assert.equal(join(testDir, upload.file_data.original_file_name), testFilePath)

      assert.equal(fs.statSync(testFilePath).size, upload.file_data.file_size)

      const disk = drive.use('s3')

      // Assert that the encrypted file is in remote storage
      assert.isTrue(await disk.exists(upload.file_data.location))

      // Assert that the file is not valid zip (because it is encrypted)
      assert.isFalse(allowedPattern.test(upload.file_data.location))
      assert.isTrue(allowedPattern.test(upload.file_data.original_file_name))

      try {
        const buffer = await disk.get(upload.file_data.location)

        const zip = new AdmZip(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
        zip.getEntries()
      } catch (error) {
        assert.include(error.message, 'unsupported zip format')
      }

      // Cleanup
      await disk.delete(upload.file_data.location)
    })
    .tags(['upload'])

  test('should fail to upload a file if: {$self}')
    .with([
      'email_not_provided',
      'email_not_exists',
      'title_not_provided',
      'title_exceeds_maxlength',
      'file_path_not_provided',
      'file_not_found',
      'file_type_not_supported',
      'file_size_exceeds_max_size',
    ] as const)
    .run(async ({}, condition) => {
      const email = 'test@example.com'

      await User.create({ email, licence_key: cuid() })

      const title = 'My Important File'

      testFilePath =
        condition === 'file_type_not_supported'
          ? await constructFilePath(true)
          : await constructFilePath()

      const zipFile = new AdmZip()
      zipFile.addFile(
        'file.txt',
        condition === 'file_size_exceeds_max_size'
          ? randomBytes(1024 * 1024 * (maxFileSizeMB + 10))
          : Buffer.alloc(1024, '0')
      )

      if (condition !== 'file_not_found') {
        await zipFile.writeZipPromise(testFilePath)
      }

      const command = await ace.create(Upload, [
        condition === 'file_path_not_provided' ? ' ' : testFilePath,
        condition === 'email_not_provided'
          ? ''
          : condition === 'email_not_exists'
            ? '--email=non_existent@email'
            : `--email=${email}`,
        condition === 'title_not_provided'
          ? ''
          : condition === 'title_exceeds_maxlength'
            ? `--title=${faker.lorem.paragraphs(2)}`
            : `--title=${title}`,
      ])

      await command.exec()

      command.assertFailed()

      let message = ''

      switch (condition) {
        case 'email_not_provided':
          message = 'Provide your email.'
          break

        case 'email_not_exists':
          message = 'User does not exist.'
          break

        case 'file_path_not_provided':
          message = 'Provide the path to the file.'
          break

        case 'file_not_found':
          message = `File not found at ${testFilePath}.`
          break

        case 'file_type_not_supported':
          message = `Invalid file type. Only ${allowedExtensions.join(', ')} are allowed.`
          break

        case 'file_size_exceeds_max_size':
          message = `File size must not exceed ${maxFileSizeMB}mb.`
          break

        case 'title_not_provided':
          message = 'Provide a title for the file.'
          break

        case 'title_exceeds_maxlength':
          message = 'Title must not exceed 100 characters.'
          break

        default:
          throw new Error('Invalid condition')
      }

      command.assertLog(`[ red(error) ] ${message}`)
    })
    .tags(['upload'])
    .timeout(30000)

  test('should upload a large file that is under the max file size limit')
    .run(async ({ assert }) => {
      const email = 'test@example.com'

      const user = await User.create({ email, licence_key: cuid() })

      const title = 'My Important File'

      const zipFile = new AdmZip()
      zipFile.addFile('file.txt', randomBytes(1024 * 1024 * (maxFileSizeMB - 5)))

      await zipFile.writeZipPromise(testFilePath)

      const command = await ace.create(Upload, [
        testFilePath,
        `--email=${email}`,
        `--title=${title}`,
      ])

      await command.exec()

      command.assertSucceeded()

      command.assertLog('[ green(success) ] File upload successful.')

      await user.load('fileUploads')

      const upload = user.fileUploads[0].serialize()

      const disk = drive.use('s3')

      assert.isTrue(await disk.exists(upload.file_data.location))

      // Cleanup
      await disk.delete(upload.file_data.location)
    })
    .tags(['upload'])
    .timeout(30000)
})
