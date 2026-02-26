import app from '@adonisjs/core/services/app'
import { chmod, readFile, writeFile, mkdir } from 'fs/promises'
import { relative, dirname, join } from 'path'
import fs from 'fs'

export default class ConfigService {
  static get #licenceKeyPath() {
    return app.makePath('vault_data', app.inTest ? '.config.test.json' : '.config.json')
  }

  public static async saveLicenceKey(licenceKey: string): Promise<string> {
    const filePath = this.#licenceKeyPath

    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ licenceKey }, null, 2))

    try {
      // Ensure the file is readable and writable by both the Docker user and Host user to avoid permission collisions
      await chmod(filePath, 0o666)
    } catch (_) {
      // Catch any error in case of filesystems that don't support Linux chmod
    }

    return `./${relative(app.makePath(), filePath)}`
  }

  public static async getLicenceKey(): Promise<string | null> {
    try {
      return JSON.parse(await readFile(this.#licenceKeyPath, 'utf-8')).licenceKey
    } catch (error) {
      return null
    }
  }

  public static getDownloadPath(fileName: string): string {
    const pathFromRoot = app.makePath()
    const downloadDir = join(pathFromRoot, app.inTest ? 'vault_downloads_test' : 'vault_downloads')

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true })
    }

    const outputPath = join(downloadDir, fileName)

    return `./${relative(pathFromRoot, outputPath)}`
  }
}
