import app from '@adonisjs/core/services/app'
import { HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { ValidationException } from '@adonisjs/validator'
import { errors } from '@vinejs/vine'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof ValidationException || error instanceof errors.E_VALIDATION_ERROR) {
      const rawMessages = error.messages?.errors || error.messages

      const messages = Array.isArray(rawMessages)
        ? rawMessages.map(({ message }: { message: string }) => message)
        : [error?.message || 'Validation failed']

      return ctx.response.unprocessableEntity({
        errors: messages,
      })
    }

    const err = error as any

    if (err?.code === 'E_ROW_NOT_FOUND') {
      return ctx.response.notFound({ error: 'The requested resource does not exist.' })
    }

    if (err?.status) {
      return ctx.response.status(err.status).send({
        error: err?.message,
      })
    }

    return ctx.response.internalServerError({
      error: this.debug ? err?.message : 'An unexpected server error occurred.',
    })

    // return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
