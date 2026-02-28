import ConfigService from '#services/config_service'
import { BaseCommand } from '@adonisjs/core/ace'

export async function resolveLicenceKey({
  overrideKey,
  prompt,
  logger,
}: {
  overrideKey?: boolean
  prompt: BaseCommand['prompt']
  logger: BaseCommand['logger']
}) {
  let licenceKey: string | null = null

  if (!overrideKey) {
    licenceKey = await ConfigService.getLicenceKey()
  }

  // If no licence key in config or if --override-key was used, prompt securely
  if (!licenceKey?.trim()) {
    licenceKey = await prompt.secure(
      overrideKey
        ? 'Enter the override licence key'
        : 'Enter your licence key (not found in config).'
    )
  }

  if (!licenceKey?.trim()) {
    logger.error('Licence key is required.')
    return null
  }

  return licenceKey
}
