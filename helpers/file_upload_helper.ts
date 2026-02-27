import app from '@adonisjs/core/services/app'
import crypto from 'crypto'

export const allowedExtensions = ['zip', 'doc', 'docx', 'pdf']

export const allowedPattern = new RegExp(`\\.(${allowedExtensions.join('|')})$`, 'i')

export const maxFileSizeMB = app.inTest ? 50 : 500 // in "mb"

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
