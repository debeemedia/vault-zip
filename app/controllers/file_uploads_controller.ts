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
import app from '@adonisjs/core/services/app'
import { allowedExtensions, allowedPattern } from '../../helpers/file_upload_helper.js'

const stringRules = [rules.trim(), rules.escape()]

const maxFileSizeMB = app.inTest ? 50 : 500 // in "mb"

export default class FileUploadsController {
  public async store({ request, response }: HttpContext) {
    const {
      title,
      email,
      file_name: originalFileName,
    } = await request.validate({
      schema: schema.create({
        title: schema.string([...stringRules, rules.maxLength(100)]),
        email: schema.string(stringRules),
        file_name: schema.string([...stringRules, rules.regex(allowedPattern)]),
        /**
         * @todo For later: add the `file_size` column to the table to track the total storage used by the user/seller (for plan limits)
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
        'file_size.range': 'File size must not exceed 500mb.',
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
        iv: iv.toString('hex'),
        original_file_name: originalFileName,
      },
    })

    return response.created({ message: 'File upload initialised.', fileUploadId: fileUpload.id })
  }

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

    const iv = Buffer.from(fileUpload.file_data.iv, 'hex')

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
            auth_tag: authTag.toString('hex'),
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
}
