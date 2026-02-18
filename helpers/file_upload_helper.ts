export const allowedExtensions = ['zip', 'doc', 'docx', 'pdf']

export const allowedPattern = new RegExp(`\\.(${allowedExtensions.join('|')})$`, 'i')
