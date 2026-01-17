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

  @flags.string({ required: false })
  declare email?: string

  async run() {
    const response = await fetch(`http://${process.env.HOST}:${process.env.PORT}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: this.email }),
    })

    const data = (await response.json()) as { message?: string; error?: string; errors?: string[] }

    const stringifiedData = JSON.stringify(data)

    if (!response.ok) {
      this.logger.error(data.error ?? data.errors?.join(', ') ?? stringifiedData)

      return (this.exitCode = 1)
    }

    this.logger.info(data.message ?? stringifiedData)
  }
}
