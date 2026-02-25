import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import ace from '@adonisjs/core/services/ace'
import { cuid } from '@adonisjs/core/helpers'
import User from '#models/user'
import { rm } from 'fs/promises'
import drive from '@adonisjs/drive/services/main'
import FileUpload, { FileUploadStatuses } from '#models/file_upload'
import AdmZip from 'adm-zip'
import encryption from '@adonisjs/core/services/encryption'
import crypto from 'crypto'
import Download from '../../commands/download.js'
import ConfigService from '#services/config_service'
import { Readable } from 'stream'

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
    .with(['main_assertion', 'narrow_terminal_width'] as const)
    .run(async ({ assert }, condition) => {
      const isNarrowTerminalWidth = condition === 'narrow_terminal_width'

      if (process.stdout) {
        process.stdout.columns = isNarrowTerminalWidth ? 80 : 120
      }

      // Register the user first
      const email = 'test@example.com'

      const user = await User.create({ email, licence_key: cuid() })

      await ConfigService.saveLicenceKey(user.licence_key)

      // Upload some files for the user
      const titles = ['1st file', '2nd file']

      const fileNames = titles.map((title) => `${title.replace(/\s+/g, '_')}.zip`)

      const textFileNames = ['test1.txt', 'test2.txt']

      for (let i = 0; i < 2; i++) {
        const zipFile = new AdmZip()
        zipFile.addFile(textFileNames[i], crypto.randomBytes(1024 * 1024 * 1))

        const buffer = zipFile.toBuffer()
        const fileSize = buffer.length

        const stream = Readable.from(buffer)

        const rawFileKey = crypto.randomBytes(32)

        const encryptedFileKey = encryption.encrypt(
          rawFileKey.toString('base64'),
          undefined,
          'File Upload'
        )

        const iv = crypto.randomBytes(12)

        const cipher = crypto.createCipheriv('aes-256-gcm', rawFileKey, iv)

        const encryptedStream = stream.pipe(cipher)

        const disk = drive.use('s3')

        await disk.putStream(fileNames[i], encryptedStream, {
          contentType: 'application/zip',
          contentLength: fileSize,
        })

        const authTag = cipher.getAuthTag()

        assert.isTrue(await disk.exists(fileNames[i]))

        await FileUpload.create({
          title: titles[i],
          status: FileUploadStatuses.Completed,
          user_id: user.id,
          file_data: {
            iv: iv.toString('base64'),
            encrypted_file_key: encryptedFileKey,
            file_size: fileSize,
            original_file_name: fileNames[i],
            auth_tag: authTag.toString('base64'),
            location: fileNames[i],
          },
        })
      }

      await user.load('fileUploads', (fileUploadsQuery) => {
        fileUploadsQuery.orderBy('updated_at', 'desc') // Files are returned in descending order of update
      })
      assert.lengthOf(user.fileUploads, 2)

      const command = await ace.create(Download, [`--email=${email}`])

      // Trap the prompt before executing the command
      command.prompt.trap('Select the file to download').chooseOption(0)

      await command.exec()

      command.assertSucceeded()

      command.assertLog('[ blue(info) ] Getting your files...', 'stdout')

      if (isNarrowTerminalWidth) {
        command.assertLog(
          '[ yellow(warn) ] Terminal width is narrow. The table below might look messy.',
          'stdout'
        )
      }

      const fileTableData = user.fileUploads.map((upload) => [
        upload.id,
        upload.title,
        upload.file_data.original_file_name,
        `${(upload.file_data.file_size / (1024 * 1024)).toFixed(2)} MB`,
      ])

      command.assertTableRows([
        ['ID', 'Title', 'Original File Name', 'File Size Approx'],
        ...fileTableData,
      ])

      command.assertLog('[ blue(info) ] Downloading encrypted bundle...', 'stdout')

      // We selected the latset file for download
      const responseFileName = `${user.fileUploads[0].file_data.original_file_name}.vault`

      const outputPath = ConfigService.getDownloadPath(responseFileName)

      command.assertLog(
        `[ green(success) ] Download complete. Encrypted bundle saved to ${outputPath}`,
        'stdout'
      )

      // Cleanup
      await rm(outputPath, { force: true })

      for (const upload of user.fileUploads) {
        await drive.use('s3').delete(upload.file_data.location!)
      }
    })
    .tags(['download'])

  // todo: test validation; other cases
})
