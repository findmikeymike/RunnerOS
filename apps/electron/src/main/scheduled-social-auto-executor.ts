import type { ScheduledSocialBrowserExecutionInput, ScheduledSocialBrowserExecutionResult } from './scheduled-social-browser-executor'

export interface ScheduledSocialPreparedRoute {
  provider: 'trypost' | 'postiz'
  execute(): Promise<ScheduledSocialBrowserExecutionResult>
}

export interface ScheduledSocialProviderRoute {
  provider: ScheduledSocialPreparedRoute['provider']
  prepare(input: ScheduledSocialBrowserExecutionInput): Promise<ScheduledSocialPreparedRoute | undefined>
}

export interface ScheduledSocialAutoExecutorDeps {
  providerRoutes: ScheduledSocialProviderRoute[]
  executeBrowser(input: ScheduledSocialBrowserExecutionInput): Promise<ScheduledSocialBrowserExecutionResult>
  log?: (message: string) => void
}

/**
 * Read-only provider discovery may fall through. Once a provider is selected,
 * execution errors stop: falling back after a possibly-live API call could duplicate a post.
 */
export async function executeScheduledSocialAuto(
  input: ScheduledSocialBrowserExecutionInput,
  deps: ScheduledSocialAutoExecutorDeps,
): Promise<ScheduledSocialBrowserExecutionResult> {
  for (const route of deps.providerRoutes) {
    let prepared: ScheduledSocialPreparedRoute | undefined
    try {
      prepared = await route.prepare(input)
    } catch (error) {
      if (error instanceof ScheduledSocialProviderUnavailableError) {
        deps.log?.(`${route.provider} unavailable for ${input.order.id}: ${error.message}`)
        continue
      }
      throw error
    }
    if (!prepared) continue
    deps.log?.(`Using ${prepared.provider} for scheduled social post ${input.order.id}.`)
    return prepared.execute()
  }
  deps.log?.(`Using native browser for scheduled social post ${input.order.id}.`)
  return deps.executeBrowser(input)
}

export class ScheduledSocialProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduledSocialProviderUnavailableError'
  }
}
