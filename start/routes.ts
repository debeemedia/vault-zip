/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

router
  .resource('users', () => import('#controllers/users_controller'))
  .apiOnly()
  .only(['store'])
