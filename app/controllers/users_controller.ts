import User from '#models/user'
import { cuid } from '@adonisjs/core/helpers'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { rules, schema } from '@adonisjs/validator'

export default class UsersController {
  /**
   * Register a user.
   *
   * `POST /users`
   */
  public async store({ request, response }: HttpContext) {
    const { email } = await request.validate({
      schema: schema.create({
        email: schema.string([rules.trim(), rules.escape()]),
      }),
      messages: {
        'email.required': 'Email is required.',
      },
    })

    if (await db.from('users').select('email').where({ email }).first()) {
      return response.badRequest({ error: 'Email already exists.' })
    }

    const licenceKey = cuid()

    // IMPORTANT: Always use model for encryption and decryption of licence_key
    await User.create({ email, licence_key: licenceKey })

    return response.created({
      message: 'Registration successful.',
      licenceKey,
    })
  }
}
