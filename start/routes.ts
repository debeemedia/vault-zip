/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

// Resourceful routes for `users`.
router
  .resource('users', () => import('#controllers/users_controller'))
  .apiOnly()
  .only(['store'])

// Resourceful routes for `file_uploads`.
router
  .resource('file_uploads', () => import('#controllers/file_uploads_controller'))
  .apiOnly()
  .only(['store' /* Route to initialise the file upload */, 'index', 'show'])

// Route to upload the file
router.post('file_uploads/:file_upload_id', [
  () => import('#controllers/file_uploads_controller'),
  'upload',
])
