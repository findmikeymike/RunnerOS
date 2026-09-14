import { describe, expect, test } from 'bun:test'
import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG, SETUP_CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions'
import { canUseConnectionSetup, canDirectlyMutateUserMemory, canSaveRunnerSecrets, canScheduleWork, directUserMemoryPolicyError, runnerSecretPolicyError } from './SessionManager'

describe('session memory write policy', () => {
  test('allows direct user memory writes from manual sessions', () => {
    expect(canDirectlyMutateUserMemory()).toBe(true)
  })

  test('allows direct user memory writes from top-level system agents', () => {
    expect(canDirectlyMutateUserMemory({ agentSlug: CONCIERGE_SLUG })).toBe(true)
    expect(canDirectlyMutateUserMemory({ agentSlug: ORCHESTRATOR_SLUG })).toBe(true)
  })

  test('blocks ordinary spawned agents from directly mutating USER.md', () => {
    const spawned = { agentSlug: 'deep-researcher' }

    expect(canDirectlyMutateUserMemory(spawned)).toBe(false)
    expect(directUserMemoryPolicyError(spawned)).toContain('cannot directly write USER.md')
    expect(directUserMemoryPolicyError(spawned)).toContain('memory review queue')
  })
})

describe('session secret write policy', () => {
  test('blocks manual sessions from directly saving RunnerOS secrets', () => {
    expect(canSaveRunnerSecrets()).toBe(false)
  })

  test('allows RunnerOS secret saves only through HNIC and Setup Concierge', () => {
    expect(canSaveRunnerSecrets({ agentSlug: CONCIERGE_SLUG })).toBe(true)
    expect(canSaveRunnerSecrets({ agentSlug: SETUP_CONCIERGE_SLUG })).toBe(true)
    expect(canSaveRunnerSecrets({ agentSlug: ORCHESTRATOR_SLUG })).toBe(false)
  })

  test('blocks ordinary spawned agents from directly saving RunnerOS secrets', () => {
    const spawned = { agentSlug: 'deep-researcher' }

    expect(canSaveRunnerSecrets(spawned)).toBe(false)
    expect(runnerSecretPolicyError(spawned)).toContain('cannot save RunnerOS secrets directly')
    expect(runnerSecretPolicyError(spawned)).toContain('Setup Concierge')
  })
})

describe('scheduled work tool policy', () => {
  test('allows HNIC only', () => {
    expect(canScheduleWork({ agentSlug: CONCIERGE_SLUG })).toBe(true)
    expect(canScheduleWork({ agentSlug: ORCHESTRATOR_SLUG })).toBe(false)
    expect(canScheduleWork({ agentSlug: SETUP_CONCIERGE_SLUG })).toBe(false)
    expect(canScheduleWork()).toBe(false)
  })
})


describe('interactive connection setup policy', () => {
  test('allows direct Setup Concierge and Artist Manager conversations', () => {
    for (const agentSlug of [CONCIERGE_SLUG, SETUP_CONCIERGE_SLUG]) {
      expect(canUseConnectionSetup({ spawnedFromAgent: { agentSlug }, launchReceipt: { origin: 'agent', createdAt: 1 } })).toBe(true)
    }
    expect(canUseConnectionSetup({})).toBe(false)
    expect(canUseConnectionSetup({ spawnedFromAgent: { agentSlug: 'ad-runner' } })).toBe(false)
  })
  test('blocks delegated and automated ancestry including a branched helper', () => {
    const spawnedFromAgent = { agentSlug: SETUP_CONCIERGE_SLUG }
    expect(canUseConnectionSetup({ spawnedFromAgent, triggeredBy: { automationId: 'a' } })).toBe(false)
    for (const origin of ['automation', 'workflow', 'deep-research', 'spawned-session'] as const) {
      expect(canUseConnectionSetup({ spawnedFromAgent, launchReceipt: { createdAt: 1, origin } })).toBe(false)
    }
    expect(canUseConnectionSetup({ spawnedFromAgent, launchReceipt: { createdAt: 1, origin: 'branch', automatedAncestry: true } })).toBe(false)
    expect(canUseConnectionSetup({ spawnedFromAgent, launchReceipt: { createdAt: 1, origin: 'agent', delegation: { mechanism: 'message-agent', depth: 1 } } })).toBe(false)
  })
})
