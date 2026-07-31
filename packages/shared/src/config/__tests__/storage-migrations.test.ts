import { describe, expect, it } from 'bun:test'
import { assignMissingArtistWorkspaceScopes, inferModelSelectionMode, repairLegacyInferredArtistWorkspaceScopes, shouldMigratePiOpenAiProvider, shouldRepairPiApiKeyCodexProvider } from '../storage'
import type { Workspace } from '@craft-agent/core/types'
import type { StoredConfig } from '../storage'

describe('assignMissingArtistWorkspaceScopes', () => {
  it('persists one legacy HQ and leaves unrelated global labels neutral', () => {
    const workspaces = [
      { id: 'campaign', name: 'Global Launch', slug: 'global-launch', rootPath: '/tmp/global-launch', createdAt: 1 },
      { id: 'hq', name: 'My Workspace', slug: 'my-workspace', rootPath: '/tmp/hq', createdAt: 2 },
    ] as Workspace[]

    expect(assignMissingArtistWorkspaceScopes(workspaces)).toBe(true)
    expect(workspaces.map(workspace => [workspace.id, workspace.artistWorkspaceScope])).toEqual([
      ['campaign', 'general'],
      ['hq', 'hq'],
    ])
    expect(assignMissingArtistWorkspaceScopes(workspaces)).toBe(false)
  })

  it('uses the oldest workspace only when no legacy or explicit HQ exists', () => {
    const workspaces = [
      { id: 'newer', name: 'Second', slug: 'second', rootPath: '/tmp/second', createdAt: 20 },
      { id: 'older', name: 'First', slug: 'first', rootPath: '/tmp/first', createdAt: 10 },
    ] as Workspace[]

    assignMissingArtistWorkspaceScopes(workspaces)
    expect(workspaces.find(workspace => workspace.id === 'older')?.artistWorkspaceScope).toBe('hq')
    expect(workspaces.find(workspace => workspace.id === 'newer')?.artistWorkspaceScope).toBe('general')
  })

  it('repairs the old blanket campaign inference once while preserving campaign-like names', () => {
    const config: StoredConfig = {
      workspaces: [
        { id: 'trading', name: 'Trading', slug: 'trading', rootPath: '/tmp/trading', createdAt: 1, artistWorkspaceScope: 'campaign' as const },
        { id: 'release', name: 'Album Rollout', slug: 'album-rollout', rootPath: '/tmp/release', createdAt: 2, artistWorkspaceScope: 'campaign' as const },
      ],
      activeWorkspaceId: 'trading',
      activeSessionId: null,
    }

    expect(repairLegacyInferredArtistWorkspaceScopes(config)).toBe(true)
    expect(config.workspaces.map(workspace => workspace.artistWorkspaceScope)).toEqual(['general', 'campaign'])
    expect(repairLegacyInferredArtistWorkspaceScopes(config)).toBe(false)
  })
})

describe('shouldMigratePiOpenAiProvider', () => {
  it('migrates legacy Pi OAuth OpenAI connections to openai-codex', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'oauth',
    })).toBe(true)
  })

  it('does not migrate Pi API key OpenAI connections', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'api_key',
    })).toBe(false)
  })

  it('does not migrate Pi custom endpoint connections', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'oauth',
      baseUrl: 'https://custom.gateway.example/v1',
    })).toBe(false)
  })

  it('does not migrate already-correct openai-codex connections', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'oauth',
    })).toBe(false)
  })
})

describe('shouldRepairPiApiKeyCodexProvider', () => {
  it('repairs Pi API key connections that were incorrectly set to openai-codex', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'api_key',
    })).toBe(true)
  })

  it('repairs Pi API key with endpoint connections that were incorrectly set to openai-codex', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'api_key_with_endpoint',
    })).toBe(true)
  })

  it('does not repair OAuth openai-codex connections', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'oauth',
    })).toBe(false)
  })

  it('does not repair non-OpenAI-Codex providers', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'api_key',
    })).toBe(false)
  })
})

describe('inferModelSelectionMode', () => {
  it('infers automaticallySyncedFromProvider when model list equals provider defaults', () => {
    const providerDefaults = ['pi/zai-best', 'pi/zai-balanced', 'pi/zai-fast']
    const mode = inferModelSelectionMode({ models: [...providerDefaults] }, providerDefaults)
    expect(mode).toBe('automaticallySyncedFromProvider')
  })

  it('infers userDefined3Tier when model list is a custom subset', () => {
    const providerDefaults = ['pi/zai-best', 'pi/zai-balanced', 'pi/zai-fast', 'pi/zai-extra']
    const mode = inferModelSelectionMode({ models: ['pi/zai-best', 'pi/zai-fast', 'pi/zai-extra'] }, providerDefaults)
    expect(mode).toBe('userDefined3Tier')
  })

  it('infers automaticallySyncedFromProvider for empty model lists', () => {
    const providerDefaults = ['pi/zai-best', 'pi/zai-balanced', 'pi/zai-fast']
    const mode = inferModelSelectionMode({ models: [] }, providerDefaults)
    expect(mode).toBe('automaticallySyncedFromProvider')
  })
})
