import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class Download extends BaseCommand {
  static commandName = 'vault-zip:download'
  static description = 'Download a file'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.string()
  declare email?: string

  /**
   * NB: Input the flag as "licence-key" when typing the commmand.
   */
  @flags.string()
  declare licenceKey?: string

  async run() {
    if (!this.email?.trim()) {
      this.logger.error('Provide your email.')
      return (this.exitCode = 1)
    }

    if (!this.licenceKey?.trim()) {
      this.logger.error('Provide your licence key.')
      return (this.exitCode = 1)
    }

    const fileUploadsResponse = await fetch(
      `http://${process.env.HOST}:${process.env.PORT}/file_uploads`,
      {
        method: 'GET',
        headers: {
          email: this.email,
          licence_key: this.licenceKey,
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

    const table = this.ui.table()

    table.head(['ID', 'Title', 'Original File Name', ' File Size Approx'])

    data.data.forEach((file) => {
      table.row([file.id, file.title, file.original_file_name, file.file_size])
    })

    table.render()

    const fileUploadId = await this.prompt.ask('Enter the ID of the file', {
      validate(value) {
        return !data.data!.map((file) => file.id).includes(value)
          ? 'Please enter a valid file ID'
          : true
      },
    })

    /* const fileUploadResponse = */ await fetch(
      `http://${process.env.HOST}:${process.env.PORT}/file_uploads/${fileUploadId}`,
      {
        method: 'GET',
        headers: {
          email: this.email,
          licence_key: this.licenceKey,
        },
      }
    )

    console.log('client work in progress...')

    // todo: consider progress bar (this.ui.logger) during large file download
  }
}
