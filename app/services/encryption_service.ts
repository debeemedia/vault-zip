import env from '#start/env'
import { Encryption } from '@adonisjs/core/encryption'

export default class EncryptionService {
  public static getEncryption(version: string) {
    const envKey = `APP_KEY_V${version}`

    const secret = env.get(envKey)

    if (!secret) {
      throw new Error(`Missing environment variable: ${envKey}`)
    }

    return new Encryption({ algorithm: 'aes-256-cbc', secret })
  }
}
