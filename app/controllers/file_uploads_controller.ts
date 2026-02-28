import env from '#start/env'
import { cuid } from '@adonisjs/core/helpers'
import type { HttpContext } from '@adonisjs/core/http'
import { rules, schema } from '@adonisjs/validator'
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import FileUpload, { FileUploadStatuses } from '#models/file_upload'
import User from '#models/user'
import encryption from '@adonisjs/core/services/encryption'
import crypto from 'node:crypto'
import vine, { SimpleMessagesProvider } from '@vinejs/vine'
import {
  allowedExtensions,
  allowedPattern,
  deriveAESKeyFromLicenceKey,
  FileMetadata,
  maxFileSizeMB,
} from '../../helpers/file_upload_helper.js'
import drive from '@adonisjs/drive/services/main'
import { PassThrough } from 'node:stream'

const stringRules = [rules.trim(), rules.escape()]

export default class FileUploadsController {
  /**
   * List uploaded (encrypted) files for a user.
   *
   * `GET /file_uploads`
   */
  public async index({ request, response }: HttpContext) {
    const validationResult = await validateDownloadRequest(request)

    if (typeof validationResult === 'string') {
      return response.unprocessableEntity({ error: validationResult })
    }

    const { user } = validationResult

    await user.load('fileUploads', (fileUploadsQuery) => {
      fileUploadsQuery
        .select(['id', 'title', 'file_data'])
        .where({ status: FileUploadStatuses.Completed })
        .orderBy('updated_at', 'desc')
    })

    const fileUploads =
      user.fileUploads?.map((upload) => ({
        id: upload.id,
        title: upload.title,
        original_file_name: upload.file_data.original_file_name,
        file_size: `${(upload.file_data.file_size / (1024 * 1024)).toFixed(2)} MB`,
      })) ?? []

    return response.ok({ data: fileUploads })
  }

  /**
   * Download an encrypted file for a user.
   * NB: File decryption is client-side.
   *
   * `GET /file_uploads/:id`
   */
  public async show({ request, response, params }: HttpContext) {
    const validationResult = await validateDownloadRequest(request)

    if (typeof validationResult === 'string') {
      return response.unprocessableEntity({ error: validationResult })
    }

    const { user } = validationResult

    const fileUpload = await FileUpload.query()
      .where({ id: params.id })
      .whereHas('user', (userQuery) => {
        userQuery.select('id').where({ id: user.id })
      })
      .firstOrFail()

    const location = fileUpload.file_data.location

    const encryptedStream = await drive.use('s3').getStream(location!)

    const rawFileKey = this.#decryptFileKey(fileUpload)

    /**
     * IMPORTANT: The following steps should be noted by the client for unwrapping the file key needed for decrypting the file:
     */
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
     * Package everything needed for decrypting the encrypted file key and the encrypted file itself i.e. the salt, ivs and auth tags, as metadata to be bundled along with the encrypted file to the client.
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

    response.header('Content-Type', 'application/octet-stream')
    response.header(
      'Content-Disposition',
      `attachment; filename=${fileUpload.file_data.original_file_name}.vault`
    )

    const combinedStream = new PassThrough()

    // Handle streaming errors
    combinedStream.on('error', (error) => {
      console.error('Stream Error:', error)
    })
    encryptedStream.on('error', (error) => {
      combinedStream.destroy(error)
    })

    let isFinished = false
    encryptedStream.on('end', () => {
      isFinished = true
    })
    // Handle user download cancellation
    request.request.on('close', () => {
      if (!isFinished) {
        console.log('Download cancelled by user or network error.')
      }

      if (!combinedStream.destroyed) {
        combinedStream.destroy()
      }
      if (!encryptedStream.destroyed) {
        encryptedStream.destroy()
      }
    })

    /**
     * Connect the PassThrough stream to the response before writing any data. This handles "backpressure", allowing data to flow immediately to the client without buffering in the server's memory.
     */
    response.stream(combinedStream)

    /**
     * IMPORTANT: The following steps should be noted by the client for unpacking the encrypted bundle to be sent:
     */

    // 1. Write 4-byte length indicator first
    combinedStream.write(lengthPrefix)

    // 2. Write the JSON metadata buffer second
    combinedStream.write(headerBuffer)

    // 3. Pipe the encrypted file data from S3 last. This automatically closes the stream.
    encryptedStream.pipe(combinedStream)
  }

  /**
   * Initialise a file upload for a user.
   *
   * `POST /file_uploads`
   */
  public async store({ request, response }: HttpContext) {
    const {
      title,
      email,
      file_name: originalFileName,
      file_size: fileSize,
    } = await request.validate({
      schema: schema.create({
        title: schema.string([...stringRules, rules.maxLength(100)]),
        email: schema.string(stringRules),
        file_name: schema.string([...stringRules, rules.regex(allowedPattern)]),
        /**
         * @todo Future Consideration: Use this property to track the total storage used by the user for plan limits
         */
        file_size: schema.number([rules.range(0, maxFileSizeMB * 1024 * 1024)]),
      }),
      messages: {
        'title.required': 'Title is required.',
        'title.maxLength': 'Title must not exceed 100 characters.',
        'email.required': 'Email is required.',
        'file_name.required': 'Original file name is required.',
        'file_name.regex': `Invalid file type. Only ${allowedExtensions.join(', ')} are allowed.`,
        'file_size.required': 'File size is required',
        'file_size.range': `File size must not exceed ${maxFileSizeMB}mb.`,
      },
    })

    /**
     * @todo Implement login and auth later.
     * For now, this project's focus is not auth flow.
     */

    const user = await User.query().select('id').where({ email }).first()

    if (!user) {
      return response.unprocessableEntity({ error: 'User does not exist.' })
    }

    const rawFileKey = crypto.randomBytes(32)

    const encryptedFileKey = encryption.encrypt(
      rawFileKey.toString('base64'),
      undefined,
      FileUploadsController.#ENCRYPTION_PURPOSE
    )

    const iv = crypto.randomBytes(12)

    const fileUpload = await FileUpload.create({
      title,
      user_id: user.id,
      status: FileUploadStatuses.Pending,
      file_data: {
        encrypted_file_key: encryptedFileKey,
        iv: iv.toString('base64'),
        original_file_name: originalFileName,
        // File size saved in bytes
        file_size: fileSize,
      },
    })

    return response.created({ message: 'File upload initialised.', fileUploadId: fileUpload.id })
  }

  /**
   * Upload and encrypt a file for a user.
   *
   * `POST /file_uploads/:file_upload_id`
   */
  public async upload({ request, response, params }: HttpContext) {
    const email = request.header('email')

    const { email: validatedEmail } = await vine.validate({
      data: { email },
      schema: vine.object({
        email: vine
          .string()
          .trim()
          .escape()
          .exists({ column: 'email', table: 'users', caseInsensitive: true }),
      }),
      messagesProvider: new SimpleMessagesProvider({
        'email.required': 'Email is required.',
        'email.exists': 'User does not exist.',
        'database.required': 'The {{ field }} is required.',
        'database.exists': 'The {{ field }} does not exist.',
      }),
    })

    const user = await User.findByOrFail({ email: validatedEmail })

    const fileUpload = await FileUpload.query()
      .where({ id: params.file_upload_id, user_id: user.id })
      .first()

    if (!fileUpload) {
      return response.notFound({ error: 'Upload not found. Please re-initialize.' })
    }

    if (fileUpload.status === FileUploadStatuses.Completed) {
      return response.badRequest({ error: 'This file has already been uploaded.' })
    }

    const iv = Buffer.from(fileUpload.file_data.iv, 'base64')

    const rawFileKey = this.#decryptFileKey(fileUpload)

    request.multipart.onFile(
      'file',
      { size: `${maxFileSizeMB}mb`, extnames: allowedExtensions },
      async (part, reporter) => {
        /**
         * IMPORTANT: Listen for errors on part to prevent
         * "ERR_UNHANDLED_ERROR"
         */
        part.on('error', () => {
          // Nothing to do here. Adonis will populate the request.file() errors
        })

        if (!part.file.isValid) {
          return
        }

        const cipher = crypto.createCipheriv('aes-256-gcm', rawFileKey, iv)

        part.pause()
        part.on('data', reporter)

        const encryptedStream = part.pipe(cipher)

        const client = new S3Client({
          region: env.get('AWS_REGION'),
          endpoint: env.get('S3_ENDPOINT'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: env.get('AWS_ACCESS_KEY_ID'),
            secretAccessKey: env.get('AWS_SECRET_ACCESS_KEY'),
          },
        })

        const key = `${Date.now()}_${part.file.clientName}_${cuid()}`

        const upload = new Upload({
          client,
          params: {
            Bucket: env.get('S3_BUCKET'),
            Key: key,
            Body: encryptedStream,
          },
        })

        // For debugging
        // upload.on('httpUploadProgress', (progress) => {
        //   console.log('progress...', progress)
        // })

        await upload.done()

        const authTag = cipher.getAuthTag()

        fileUpload.merge({
          file_data: {
            ...fileUpload.file_data,
            auth_tag: authTag.toString('base64'),
            location: key,
          },
        })

        /**
         * We adopt the approach above (bypassing Adonis Drive and talking directly to AWS) to avoid "MissingContentLength" error for the stream
         */
        // await drive.use('s3').putStream(`${Date.now()}_${part.file.clientName}_${cuid()}`, part, {
        //   contentLength: part.file.size,
        //   contentType: part.headers['content-type'] || 'application/octet-stream',
        // })
      }
    )

    await request.multipart.process()

    const file = request.file('file')

    if (!file) {
      return response.unprocessableEntity({ error: 'File is required.' })
    }

    const errors = file.errors.map((error) => {
      const messages = {
        extname: `${file.clientName} is not a zip`,
        size: `${file.clientName} is too large. `,
        fatal: `The remote storage rejected the file: ${error.message}`,
      }

      return messages[error.type] || error.message
    })

    if (!file.isValid) {
      return response.badRequest({ errors })
    }

    fileUpload.status = FileUploadStatuses.Completed

    await fileUpload.save()

    return response.created({
      message: 'File upload successful.',
    })
  }

  static #ENCRYPTION_PURPOSE = 'File Upload'

  #decryptFileKey(fileUpload: FileUpload) {
    const decryptedBase64FileKey = encryption.decrypt<string>(
      fileUpload.file_data.encrypted_file_key,
      FileUploadsController.#ENCRYPTION_PURPOSE
    )

    if (!decryptedBase64FileKey) {
      throw new Error('Unable to decrypt file key')
    }

    const rawFileKey = Buffer.from(decryptedBase64FileKey, 'base64')

    if (!rawFileKey || !Buffer.isBuffer(rawFileKey)) {
      throw new Error('File key is not a valid buffer')
    }

    return rawFileKey
  }
}

async function validateDownloadRequest(request: HttpContext['request']) {
  const email = request.header('email')
  const licenceKey = request.header('licence_key')

  const { email: validatedEmail, licence_key: validatedLicenceKey } = await vine.validate({
    data: { email, licence_key: licenceKey },
    schema: vine.object({
      email: vine
        .string()
        .trim()
        .escape()
        .exists({ column: 'email', table: 'users', caseInsensitive: true }),
      licence_key: vine.string().trim().escape(),
    }),

    messagesProvider: new SimpleMessagesProvider({
      'email.required': 'Email is required.',
      'email.exists': 'Email does not exist.',
      'licence_key.required': 'Licence Key is required.',
      'database.required': 'The {{ field }} is required.',
      'database.exists': 'The {{ field }} does not exist.',
    }),
  })

  const user = await User.query()
    .select(['id', 'licence_key'])
    .where({ email: validatedEmail })
    .first()

  if (!user || user.licence_key !== validatedLicenceKey) {
    return 'Provide your email with the corresponding licence key.'
  }

  return { user }
}
