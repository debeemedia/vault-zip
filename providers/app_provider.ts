import type { ApplicationService } from '@adonisjs/core/types'
import { BaseModel, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {}

  /**
   * The container bindings have booted
   */
  async boot() {
    // Forces Lucid to map database snake_case columns to model properties and ensures `.serialize()` outputs snake_case keys.
    // Note: Foreign keys must still be explicitly defined in snake_case on the model.
    BaseModel.namingStrategy = new SnakeCaseNamingStrategy()
  }

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * The process has been started
   */
  async ready() {}

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {}
}
