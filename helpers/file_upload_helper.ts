import FileUpload from '#models/file_upload'
import User from '#models/user'
import app from '@adonisjs/core/services/app'
import crypto from 'crypto'

export const allowedExtensions = ['zip', 'doc', 'docx', 'pdf']

export const allowedPattern = new RegExp(`\\.(${allowedExtensions.join('|')})$`, 'i')

export const maxFileSizeMB = app.inTest ? 150 : 500 // in "mb"

export type FileMetadata = {
  keySalt: string
  keyIV: string
  keyAuthTag: string
  wrappedKey: string
  fileIV: string
  fileAuthTag: string
}

export async function deriveAESKeyFromLicenceKey({
  licenceKey,
  salt,
}: {
  licenceKey: string
  salt: Buffer
}) {
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(licenceKey, salt, 32, (error, derivedKey) => {
      if (error) {
        reject(error)
      } else {
        resolve(derivedKey)
      }
    })
  })
}

/**
 * IMPORTANT: The following steps should be noted by the client for unwrapping the file key needed for decrypting the file...
 */
export async function generateMetadataBuffer({
  user,
  rawFileKey,
  fileUpload,
}: {
  user: User
  rawFileKey: Buffer
  fileUpload: FileUpload
}) {
  // 1. Derive the AES key from the licence key
  const salt = crypto.randomBytes(16)

  const derivedAESLicenceKey = await deriveAESKeyFromLicenceKey({
    licenceKey: user.licence_key,
    salt,
  })

  // 2. Wrap the rawFileKey (for decrypting the file) with the derivedAESLicenceKey
  const iv = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedAESLicenceKey, iv)

  const encryptedFileKey = Buffer.concat([cipher.update(rawFileKey), cipher.final()])

  const authTag = cipher.getAuthTag()

  /**
   * Package everything needed for decrypting the encrypted file key and the encrypted file itself i.e. the salt, ivs and auth tags, as metadata.
   */
  const metadataRaw = {
    keySalt: salt.toString('base64'),
    keyIV: iv.toString('base64'),
    keyAuthTag: authTag.toString('base64'),
    wrappedKey: encryptedFileKey.toString('base64'),
    fileIV: fileUpload.file_data.iv,
    fileAuthTag: fileUpload.file_data.auth_tag!,
  } satisfies FileMetadata

  const metadata = JSON.stringify(metadataRaw)

  const headerBuffer = Buffer.from(metadata)

  /**
   * IMPORTANT: We allocate 4 bytes to define the length of the metadata buffer.
   * The client must read the first 4 bytes of the bundle to be sent as the instruction of where the metadata buffer ends. After the metadata is the encrypted file itself.
   */
  const lengthPrefix = Buffer.alloc(4)

  lengthPrefix.writeUInt32BE(headerBuffer.length)

  return { lengthPrefix, headerBuffer }
}
