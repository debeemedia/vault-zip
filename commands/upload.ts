import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import fs from 'fs'
import path from 'path'

export default class Upload extends BaseCommand {
  static commandName = 'vault-zip:upload'
  static description = 'Upload a file'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @args.string({
    argumentName: 'file-path',
    description: 'Path to the zip file',
  })
  declare filePath: string

  @flags.string()
  declare title: string

  @flags.string()
  declare email: string

  async run() {
    if (!this.email) {
      this.logger.error('Provide your email.')
      return (this.exitCode = 1)
    }

    if (!this.title) {
      this.logger.error('Provide a title for the file')
      return (this.exitCode = 1)
    }

    if (!this.filePath) {
      this.logger.error('Provide the path to the file')
      return (this.exitCode = 1)
    }

    if (!fs.existsSync(this.filePath)) {
      this.logger.error(`File not found at ${this.filePath}`)
      return (this.exitCode = 1)
    }

    // const readStream = fs.createReadStream(this.filePath)
    const fileBlob = await fs.openAsBlob(this.filePath)

    const fileName = path.basename(this.filePath)

    const formData = new FormData()
    formData.append('title', this.title)

    formData.append('file', fileBlob, fileName)

    const baseUrl = `http://${process.env.HOST}:${process.env.PORT}/file_uploads`

    const preFlightResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: this.email,
        title: this.title,
        file_name: fileName,
        file_size: fileBlob.size,
      }),
    })

    const preFlightData = (await preFlightResponse.json()) as {
      message?: string
      fileUploadId?: string
      error?: string
      errors?: string[]
    }

    if (!preFlightResponse.ok) {
      this.logger.error(preFlightData.error ?? preFlightData.errors?.join(', ') ?? 'Unknown error')

      return (this.exitCode = 1)
    }

    if (!preFlightData.fileUploadId) {
      return
    }

    const response = await fetch(`${baseUrl}/${preFlightData.fileUploadId}`, {
      method: 'POST',
      body: formData,
      headers: {
        email: this.email,
      },
    })

    const data = (await response.json()) as {
      message?: string
      error?: string
      errors?: string[]
    }

    if (!response.ok) {
      this.logger.error(data.error ?? data.errors?.join(', ') ?? 'Unknown error')

      return (this.exitCode = 1)
    }

    this.logger.info(data.message || 'File upload successful.')
  }
}
