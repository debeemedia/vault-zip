import app from '@adonisjs/core/services/app'

export const allowedExtensions = ['zip', 'doc', 'docx', 'pdf']

export const allowedPattern = new RegExp(`\\.(${allowedExtensions.join('|')})$`, 'i')

export const maxFileSizeMB = app.inTest ? 50 : 500 // in "mb"
