import app from '@adonisjs/core/services/app'
import { readFile, writeFile } from 'fs/promises'

export default class ConfigService {
  static get #path() {
    return app.makePath(app.inTest ? '.vault-config.test.json' : '.vault-config.json')
  }

  public static async saveLicenceKey(licenceKey: string): Promise<string> {
    const filePath = this.#path
    await writeFile(filePath, JSON.stringify({ licenceKey }, null, 2))

    return filePath
  }

  public static async getLicenceKey(): Promise<string | null> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf-8')).licenceKey
    } catch (error) {
      return null
    }
  }
}
