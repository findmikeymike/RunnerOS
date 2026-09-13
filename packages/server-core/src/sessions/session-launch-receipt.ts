import type { SessionLaunchReceipt } from '@craft-agent/shared/sessions'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'

export function completeLaunchReceipt(
  receipt: SessionLaunchReceipt | undefined,
  fallback: {
    origin: SessionLaunchReceipt['origin']
    model?: string
    llmConnection?: string
    permissionMode?: PermissionMode
    thinkingLevel?: ThinkingLevel
    workingDirectory?: string
    customSystemPrompt?: string
    agentSkillSlugs?: string[]
    enabledSourceSlugs?: string[]
    spawnedFromAgent?: { agentSlug: string; agentName: string; timestamp?: number }
    inheritedAutomatedAncestry?: boolean
  },
): SessionLaunchReceipt {
  const injected = receipt?.injected ?? {
    skills: fallback.agentSkillSlugs ?? [],
    sources: fallback.enabledSourceSlugs ?? [],
    contextDocs: [],
  }
  return {
    voiceTask: receipt?.voiceTask ? { ...receipt.voiceTask } : undefined,
    delegation: receipt?.delegation ? { ...receipt.delegation } : undefined,
    createdAt: receipt?.createdAt ?? Date.now(),
    origin: receipt?.origin ?? fallback.origin,
    automatedAncestry: hasAutomatedSessionAncestry(receipt)
      || fallback.inheritedAutomatedAncestry === true
      || isAutomatedLaunchOrigin(receipt?.origin ?? fallback.origin),
    summary: receipt?.summary,
    agent: receipt?.agent ?? (fallback.spawnedFromAgent
      ? {
          slug: fallback.spawnedFromAgent.agentSlug,
          name: fallback.spawnedFromAgent.agentName,
        }
      : undefined),
    taskMode: receipt?.taskMode,
    capabilityExpansions: receipt?.capabilityExpansions,
    taskModeSelectionPending: receipt?.taskModeSelectionPending,
    workflow: receipt?.workflow,
    deepResearch: receipt?.deepResearch,
    automation: receipt?.automation,
    config: {
      ...receipt?.config,
      model: fallback.model,
      llmConnection: fallback.llmConnection,
      permissionMode: fallback.permissionMode,
      thinkingLevel: fallback.thinkingLevel,
      workingDirectory: fallback.workingDirectory,
    },
    injected: {
      ...injected,
      skills: injected.skills ?? [],
      sources: injected.sources ?? [],
      contextDocs: injected.contextDocs ?? [],
      systemPromptChars: receipt?.injected.systemPromptChars
        ?? (fallback.customSystemPrompt ? fallback.customSystemPrompt.length : undefined),
    },
    routing: receipt?.routing,
  }
}

function isAutomatedLaunchOrigin(origin: SessionLaunchReceipt['origin'] | undefined): boolean {
  return origin === 'automation' || origin === 'workflow' || origin === 'deep-research'
}

export function hasAutomatedSessionAncestry(receipt: SessionLaunchReceipt | undefined): boolean {
  return receipt?.automatedAncestry === true || isAutomatedLaunchOrigin(receipt?.origin)
}

