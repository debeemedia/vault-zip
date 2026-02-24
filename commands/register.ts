import ConfigService from '#services/config_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class Register extends BaseCommand {
  static commandName = 'vault-zip:register'
  static description = 'Register a user.'
  static help = ['You can use a dummy email address, but it must be unique.']

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.string()
  declare email: string

  async run() {
    if (!this.email?.trim()) {
      this.logger.error('Provide any email.')
      return (this.exitCode = 1)
    }

    const response = await fetch(`http://${process.env.HOST}:${process.env.PORT}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: this.email }),
    })

    const data = (await response.json()) as {
      message?: string
      licenceKey?: string
      error?: string
      errors?: string[]
    }

    if (!response.ok) {
      this.logger.error(data.error ?? data.errors?.join(', ') ?? 'Unknown error')

      return (this.exitCode = 1)
    }

    if (data.licenceKey) {
      const filePath = await ConfigService.saveLicenceKey(data.licenceKey)

      this.logger.info(`Licence key saved locally to ${filePath}`)
    }

    this.logger.success(data.message || 'Registration successful.')
  }
}
