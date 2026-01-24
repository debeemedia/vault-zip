import app from '@adonisjs/core/services/app'
import { chmod, readFile, writeFile } from 'fs/promises'
import { basename } from 'path'

export default class ConfigService {
  static get #path() {
    return app.makePath(app.inTest ? '.vault-config.test.json' : '.vault-config.json')
  }

  public static async saveLicenceKey(licenceKey: string): Promise<string> {
    const filePath = this.#path
    await writeFile(filePath, JSON.stringify({ licenceKey }, null, 2))

    try {
      // Ensure the file is readable and writable by both the Docker user and Host user to avoid permission collisions
      await chmod(filePath, 0o666)
    } catch (_) {
      // Catch any error in case of filesystems that don't support Linux chmod
    }

    return `./${basename(filePath)}`
  }

  public static async getLicenceKey(): Promise<string | null> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf-8')).licenceKey
    } catch (error) {
      return null
    }
  }
}
