import type { LlmConnectionWithStatus, ModelDefinition } from '@craft-agent/shared/config'

export interface PulseExecutionTarget {
  llmConnection?: string
  model?: string
}

/**
 * Keep unattended pulse runs off explicitly free shared-pool routes when the
 * artist already has another authenticated model connection available.
 */
export function resolvePulseExecutionTarget(
  connections: LlmConnectionWithStatus[],
  workspaceDefaultConnection?: string,
): PulseExecutionTarget {
  const ready = connections.filter((connection) => connection.isAuthenticated)
  if (ready.length === 0) return {}

  const configuredDefault = ready.find((connection) => connection.slug === workspaceDefaultConnection)
    ?? ready.find((connection) => connection.isDefault)
    ?? ready[0]

  const selected = isExplicitlyFree(modelId(configuredDefault))
    ? ready.find((connection) => !isExplicitlyFree(modelId(connection))) ?? configuredDefault
    : configuredDefault
  const model = modelId(selected)

  return {
    llmConnection: selected.slug,
    ...(model ? { model } : {}),
  }
}

function modelId(connection: LlmConnectionWithStatus): string | undefined {
  if (connection.defaultModel) return connection.defaultModel
  const first = connection.models?.[0]
  if (typeof first === 'string') return first
  return (first as ModelDefinition | undefined)?.id
}

function isExplicitlyFree(model: string | undefined): boolean {
  return Boolean(model && /:free(?:$|[/?#])/i.test(model))
}
