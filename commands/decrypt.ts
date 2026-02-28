import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import fs from 'fs'
import { resolveLicenceKey } from '../helpers/command_helper.js'
import path from 'node:path'
import { deriveAESKeyFromLicenceKey, FileMetadata } from '../helpers/file_upload_helper.js'
import crypto from 'crypto'

export default class Decrypt extends BaseCommand {
  static commandName = 'vault-zip:decrypt'
  static description = 'Decrypt an encrypted `.vault` file'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @args.string({
    argumentName: 'file-path',
    description: 'Path to the encrypted file, e.g. my_file.pdf.vault',
  })
  declare filePath?: string

  @flags.boolean({ description: 'Manually enter a different licence key.' })
  declare overrideKey?: boolean

  async run() {
    const licenceKey = await resolveLicenceKey({
      logger: this.logger,
      overrideKey: this.overrideKey,
      prompt: this.prompt,
    })

    if (!licenceKey) {
      return (this.exitCode = 1)
    }

    if (!this.filePath?.trim()) {
      this.logger.error('Provide the path to the encrypted file.')
      return (this.exitCode = 1)
    }

    if (!fs.existsSync(this.filePath)) {
      this.logger.error(`File not found at "${this.filePath}".`)
      return (this.exitCode = 1)
    }

    const fileName = path.basename(this.filePath)

    if (!fileName.endsWith('.vault')) {
      this.logger.error('Provide a ".vault" file.')
      return (this.exitCode = 1)
    }

    try {
      this.logger.info(`Decrypting "${fileName}"...`)

      const encryptedFileBuffer = fs.readFileSync(this.filePath)

      /**
       * Reversal of the encrypted bundle packaging done on the server:
       */
      // 1. Read the first 4 bytes to get the header size
      const headerSize = encryptedFileBuffer.readUInt32BE(0)

      // Validate the file: by checking the metadata JSON size. JSON bigger than 10KB is suspicious
      if (headerSize < 100 || headerSize > 10000) {
        this.logger.error('Invalid vault file: Header size is out of bounds.')

        return (this.exitCode = 1)
      }

      // 2. Extract the metadata JSON based on that size
      const metadataRaw = encryptedFileBuffer.subarray(4, 4 + headerSize)

      // Validate the file signature: by checking for the opening and closing braces of the metadata JSON.
      // In ASCII, "{" is 123 and "}" is 125
      if (metadataRaw[0] !== 123 || metadataRaw[metadataRaw.length - 1] !== 125) {
        this.logger.error('Invalid vault file: Metadata is not a valid JSON object.')

        return (this.exitCode = 1)
      }

      const metadata = JSON.parse(metadataRaw.toString()) as FileMetadata

      // 3. Everything after (4 + headerSize) is the encrypted file data
      const encryptedFileData = encryptedFileBuffer.subarray(4 + headerSize)

      /**
       * Client-side decryption. Reversal of the encryption done on the server:
       */
      // 1. Derive the AES key from the licence key
      const derivedAESLicenceKey = await deriveAESKeyFromLicenceKey({
        licenceKey,
        salt: Buffer.from(metadata.keySalt, 'base64'),
      })

      // 2. Unwrap the wrappedKey
      const keyDecipher = crypto.createDecipheriv(
        'aes-256-gcm',
        derivedAESLicenceKey,
        Buffer.from(metadata.keyIV, 'base64')
      )

      keyDecipher.setAuthTag(Buffer.from(metadata.keyAuthTag, 'base64'))

      const rawFileKey = Buffer.concat([
        keyDecipher.update(Buffer.from(metadata.wrappedKey, 'base64')),
        keyDecipher.final(),
      ])

      // 3. Use the unwrapped key to decrypt the file
      const fileDecipher = crypto.createDecipheriv(
        'aes-256-gcm',
        rawFileKey,
        Buffer.from(metadata.fileIV, 'base64')
      )

      fileDecipher.setAuthTag(Buffer.from(metadata.fileAuthTag, 'base64'))

      const decryptedFile = Buffer.concat([
        fileDecipher.update(encryptedFileData),
        fileDecipher.final(),
      ])

      const outputPath = this.filePath.replace(/\.vault$/, '')

      fs.writeFileSync(outputPath, decryptedFile)

      this.logger.success(`File has been successfully decrypted to: "${outputPath}"`)
    } catch (error) {
      console.log(error)
      if (
        error.message?.includes('Unsupported state') ||
        error.message?.includes('unable to authenticate data')
      ) {
        this.logger.error(
          `Decryption failed. The file was modified or the licence key is incorrect.`
        )
      } else {
        this.logger.error(`Decryption failed: ${error.message}.`)
      }
      this.exitCode = 1
    }
  }
}
