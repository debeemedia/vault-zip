import FileUpload, { FileUploadStatuses } from '#models/file_upload'
import AdmZip from 'adm-zip'
import crypto from 'crypto'
import ConfigService from '#services/config_service'
import { Readable } from 'stream'
import { TestContext } from '@japa/runner/core'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { PassThrough } from 'node:stream'
import User from '#models/user'
import drive from '@adonisjs/drive/services/main'
import { generateMetadataBuffer } from './file_upload_helper.js'
import EncryptionKeyVersion from '#models/encryption_key_version'
import EncryptionService from '#services/encryption_service'

export const targetUserFileTitlePrefix = 'Target User'
export const anotherUserFileTitlePrefix = 'Another User'

/**
 * Upload files for a user
 */
export async function uploadFiles({
  assert,
  user,
  isNotTargetUser,
  saveLocally,
}: {
  assert: TestContext['assert']
  user: User
  isNotTargetUser?: boolean
  /** Save the encrypted file locally to test the decrypt command */
  saveLocally?: boolean
}) {
  const targetUserFileTitlePrefix = 'Target User'
  const anotherUserFileTitlePrefix = 'Another User'

  const titlePrefix = isNotTargetUser ? anotherUserFileTitlePrefix : targetUserFileTitlePrefix
  const titles = [`${titlePrefix} 1st File`, `${titlePrefix} 2nd File`]

  const fileNames = titles.map((title) => `${title.replace(/\s+/g, '_')}.zip`)

  const textFileNames = ['test1.txt', 'test2.txt']

  const originalFileBuffers: Buffer[] = []
  const encryptedFileOutputPaths: string[] = []

  // On creation of file upload, use the active key version for encryption
  const activeVersion = await EncryptionKeyVersion.query()
    // Ensure to select the `version`, for the model hooks
    .select(['id', 'version'])
    .where('is_active', true)
    .firstOrFail()

  const encryption = EncryptionService.getEncryption(activeVersion.version)

  for (let i = 0; i < 2; i++) {
    const zipFile = new AdmZip()
    zipFile.addFile(textFileNames[i], crypto.randomBytes(1024 * 1024 * 1))

    const buffer = zipFile.toBuffer()
    originalFileBuffers.push(buffer)

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

    const fileUpload = await FileUpload.create({
      encryption_key_version_id: activeVersion.id,
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

    if (saveLocally) {
      const { headerBuffer, lengthPrefix } = await generateMetadataBuffer({
        fileUpload,
        rawFileKey,
        user,
      })

      const outputPath = ConfigService.getDownloadPath(`${fileNames[i]}.vault`)

      const encryptedStreamFromS3 = await drive.use('s3').getStream(fileNames[i])

      const combinedStream = new PassThrough()

      const writeStream = fs.createWriteStream(outputPath)

      combinedStream.write(lengthPrefix)
      combinedStream.write(headerBuffer)

      encryptedStreamFromS3.pipe(combinedStream)

      await pipeline(combinedStream, writeStream)

      encryptedFileOutputPaths.push(outputPath)
    }
  }

  await user.load('fileUploads', (fileUploadsQuery) => {
    fileUploadsQuery.orderBy('updated_at', 'desc') // Files will be returned in descending order of update
  })
  assert.lengthOf(user.fileUploads, 2)

  if (saveLocally) {
    return { originalFileBuffers, encryptedFileOutputPaths }
  }
}
