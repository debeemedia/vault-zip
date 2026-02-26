import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import fs from 'fs'
import ConfigService from '#services/config_service'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export default class Download extends BaseCommand {
  static commandName = 'vault-zip:download'
  static description = 'Download a file'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.string()
  declare email?: string

  @flags.boolean({ description: 'Manually enter a different licence key.' })
  declare overrideKey?: boolean

  async run() {
    if (!this.email?.trim()) {
      this.logger.error('Provide your email.')
      return (this.exitCode = 1)
    }

    let licenceKey: string | null = null

    if (!this.overrideKey) {
      licenceKey = await ConfigService.getLicenceKey()
    }

    // If no licence key in config or if --override-key was used, prompt securely
    if (!licenceKey?.trim()) {
      licenceKey = await this.prompt.secure(
        this.overrideKey
          ? 'Enter the override licence key'
          : 'Enter your licence key (not found in config).'
      )
    }

    if (!licenceKey?.trim()) {
      this.logger.error('Licence key is required.')
      return (this.exitCode = 1)
    }

    this.logger.info('Getting your files...')

    const fileUploadsResponse = await fetch(
      `http://${process.env.HOST}:${process.env.PORT}/file_uploads`,
      {
        method: 'GET',
        headers: {
          email: this.email,
          licence_key: licenceKey,
        },
      }
    )

    const data = (await fileUploadsResponse.json()) as {
      data?: { id: string; title: string; original_file_name: string; file_size: string }[]
      error?: string
      errors?: string[]
    }

    if (!fileUploadsResponse.ok) {
      this.logger.error(data.error ?? data.errors?.join(', ') ?? 'Unknown error')

      return (this.exitCode = 1)
    }

    if (!data.data) {
      return
    }

    if (!data.data.length) {
      this.logger.info('You have not uploaded any file.')

      return (this.exitCode = 0)
    }

    if (process?.stdout?.columns < 100) {
      this.logger.warning('Terminal width is narrow. The table below might look messy.')
    }

    const table = this.ui.table()

    table.head(['ID', 'Title', 'Original File Name', 'File Size Approx'])

    data.data.forEach((file) => {
      table.row([file.id, file.title, file.original_file_name, file.file_size])
    })

    table.render()

    const fileUploadId = await this.prompt.choice(
      'Select the file to download',
      data.data.map((file) => ({
        name: file.id,
        message: file.original_file_name,
        hint: file.title.length > 25 ? file.title.substring(0, 22) + '...' : file.title,
      }))
    )

    const fileUploadResponse = await fetch(
      `http://${process.env.HOST}:${process.env.PORT}/file_uploads/${fileUploadId}`,
      {
        method: 'GET',
        headers: {
          email: this.email,
          licence_key: licenceKey,
        },
      }
    )

    if (!fileUploadResponse.ok || !fileUploadResponse.body) {
      this.logger.error('Failed to fetch file stream.')
      return (this.exitCode = 1)
    }

    const fileName =
      fileUploadResponse.headers.get('content-disposition')?.split('filename=')[1] ||
      'encrypted_file.vault'

    const outputPath = ConfigService.getDownloadPath(fileName)

    try {
      const fileStream = fs.createWriteStream(outputPath)

      const readableStream = Readable.fromWeb(fileUploadResponse.body)

      this.logger.info('Downloading encrypted bundle...')

      // Use `pipeline` rahter than `pipe` for graceful stream closing in case of error
      await pipeline(readableStream, fileStream)

      this.logger.success(`Download complete. Encrypted bundle saved to ${outputPath}`)
    } catch (error) {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath)
      }

      this.logger.error(`Download interrupted: ${error.message}`)

      this.exitCode = 1
    }

    /**
     * @todo: Future consideration: progress bar for large file downloads.
     */
  }
}
