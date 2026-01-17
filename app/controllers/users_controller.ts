import User from '#models/user'
import { cuid } from '@adonisjs/core/helpers'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { rules, schema, ValidationException } from '@adonisjs/validator'

export default class UsersController {
  public async store({ request, response }: HttpContext) {
    try {
      const { email } = await request.validate({
        schema: schema.create({
          email: schema.string.optional([
            rules.trim(),
            rules.escape(),
            rules.required() /** Apply required rule after trimming */,
          ]),
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
        message: `Registration successful. Your licence key is ${licenceKey}. You will need this to access files.`,
      })
    } catch (error) {
      if (error instanceof ValidationException) {
        return response.unprocessableEntity({
          errors: error.messages.errors.map(({ message }: { message: string }) => message),
        })
      }

      return response.internalServerError({ error: error.message })
    }
  }
}
