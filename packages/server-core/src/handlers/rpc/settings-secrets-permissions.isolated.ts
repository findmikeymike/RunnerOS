import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import * as actualConfigStorage from '@craft-agent/shared/config/storage'
import * as actualConfig from '@craft-agent/shared/config'

// Deliberately isolated because this file mocks the broad Settings import graph.
// The root `bun run test` script executes every *.isolated.ts file separately.

const listUserSecrets = mock(async () => [{ name: 'OPENAI_API_KEY', maskedValue: 'sk-…1234' }])
const exportUserSecretsEnv = mock(async () => ({}))
const getUserSecret = mock<(name: string) => Promise<string | null>>(
  async (name: string) => name === 'GENIUS_ACCESS_TOKEN' ? 'genius-token' : null,
)
const setUserSecret = mock(async () => undefined)
const deleteUserSecret = mock(async () => true)
const assertTeamPermission = mock((_rootPath: string, _action: string) => undefined)
const getWorkspaceOrThrow = mock((workspaceId: string) => ({ id: workspaceId, rootPath: `/${workspaceId}` }))
const assertGlobalSecretVaultPermission = mock((workspaceId: string) => {
  assertTeamPermission(`/${workspaceId}`, 'secrets.update')
})

mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getPreferencesPath: () => '/tmp/preferences.json',
  getSessionDraft: () => null,
  setSessionDraft: () => undefined,
  deleteSessionDraft: () => undefined,
  getAllSessionDrafts: () => ({}),
  getWorkspaceByNameOrId: () => null,
  getDefaultThinkingLevel: () => 'medium',
  setDefaultThinkingLevel: () => undefined,
  resolveSelfEditTarget: () => null,
  validateSelfEditRepo: () => ({ valid: true }),
  updateWorkspaceArtistScope: () => undefined,
  updateWorkspaceRootPath: () => undefined,
}))

mock.module('@craft-agent/shared/config/storage', () => ({
  // Keep every real export; override only what this test controls. A partial
  // mock is *the* module for every later import in this process.
  ...actualConfigStorage,
  loadStoredConfig: () => ({}),
}))

mock.module('@craft-agent/shared/agent/thinking-levels', () => ({
  THINKING_LEVEL_IDS: ['low', 'medium', 'high'],
  isValidThinkingLevel: () => true,
  normalizeThinkingLevel: (value: unknown) => value,
}))

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    listUserSecrets,
    exportUserSecretsEnv,
    getUserSecret,
    setUserSecret,
    deleteUserSecret,
  }),
  isValidUserSecretName: () => true,
  normalizeUserSecretName: (value: string) => value,
}))

mock.module('@craft-agent/server-core/handlers', () => ({ getWorkspaceOrThrow }))
mock.module('@craft-agent/server-core/transport', () => ({ requestClientOpenFileDialog: mock(async () => null) }))
mock.module('../../utils/path-validation', () => ({ isValidWorkingDirectory: () => true }))
mock.module('./team-permission-helpers', () => ({
  assertGlobalSecretVaultPermission,
  assertSessionFilesWritePermission: mock(async () => undefined),
}))
mock.module('@craft-agent/shared/workspaces', () => ({ assertTeamPermission }))

const { registerSettingsHandlers } = await import('./settings')

type Handler = (...args: unknown[]) => unknown

function register(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
  }
  registerSettingsHandlers(server as never, {
    platform: { logger: { info: () => undefined, warn: () => undefined } },
  } as never)
  return handlers
}

beforeEach(() => {
  listUserSecrets.mockClear()
  exportUserSecretsEnv.mockClear()
  getUserSecret.mockClear()
  getUserSecret.mockImplementation(async (name: string) => name === 'GENIUS_ACCESS_TOKEN' ? 'genius-token' : null)
  setUserSecret.mockClear()
  deleteUserSecret.mockClear()
  assertTeamPermission.mockClear()
  assertGlobalSecretVaultPermission.mockClear()
  getWorkspaceOrThrow.mockClear()
  assertTeamPermission.mockImplementation(() => undefined)
})

describe('settings secret permissions', () => {
  it('lists saved secret summaries only after owner permission passes', async () => {
    const handler = register().get(RPC_CHANNELS.secrets.LIST)!

    await expect(handler({}, 'workspace-owner')).resolves.toEqual([
      { name: 'OPENAI_API_KEY', maskedValue: 'sk-…1234' },
    ])
    expect(assertTeamPermission).toHaveBeenCalledWith('/workspace-owner', 'secrets.update')
    expect(assertGlobalSecretVaultPermission).toHaveBeenCalledWith('workspace-owner', 'Global secret vault access')
    expect(listUserSecrets).toHaveBeenCalledTimes(1)
  })

  it('does not reveal secret names or masks when owner permission is denied', async () => {
    assertTeamPermission.mockImplementation(() => {
      throw new Error('Team permission denied for secrets.update: owner-required')
    })
    const handler = register().get(RPC_CHANNELS.secrets.LIST)!

    await expect(handler({}, 'workspace-editor')).rejects.toThrow('owner-required')
    expect(listUserSecrets).not.toHaveBeenCalled()
  })

  it('fails closed when no active workspace is supplied', async () => {
    const handler = register().get(RPC_CHANNELS.secrets.LIST)!

    await expect(handler({})).rejects.toThrow('Select an active workspace')
    expect(listUserSecrets).not.toHaveBeenCalled()
  })

  it('blocks wallet status before loading stored secrets for an editor', async () => {
    assertTeamPermission.mockImplementation(() => {
      throw new Error('Team permission denied for secrets.update: owner-required')
    })
    const handlers = register()
    exportUserSecretsEnv.mockClear()

    await expect(handlers.get(RPC_CHANNELS.secrets.ZERO_STATUS)!({}, 'workspace-editor'))
      .rejects.toThrow('owner-required')
    expect(exportUserSecretsEnv).not.toHaveBeenCalled()
  })

  it('blocks Genius verification before reading the stored token for an editor', async () => {
    assertTeamPermission.mockImplementation(() => {
      throw new Error('Team permission denied for secrets.update: owner-required')
    })
    const handler = register().get(RPC_CHANNELS.secrets.TEST_GENIUS)!

    await expect(handler({}, 'workspace-editor')).resolves.toMatchObject({ success: false, error: expect.stringContaining('owner-required') })
    expect(getUserSecret).not.toHaveBeenCalled()
  })

  it('blocks Inworld verification before reading the stored key for an editor', async () => {
    assertTeamPermission.mockImplementation(() => {
      throw new Error('Team permission denied for secrets.update: owner-required')
    })
    const handler = register().get(RPC_CHANNELS.secrets.TEST_INWORLD)!

    await expect(handler({}, 'workspace-editor')).resolves.toMatchObject({ success: false, error: expect.stringContaining('owner-required') })
    expect(getUserSecret).not.toHaveBeenCalled()
  })

  it('migrates a matching legacy Inworld key into the canonical secret', async () => {
    getUserSecret.mockImplementation(async (name: string) => name === 'INWORLD_RUNTIME_KEY' ? 'legacy-key' : null)
    const handler = register().get(RPC_CHANNELS.secrets.LIST)!

    await handler({}, 'workspace-owner')

    expect(setUserSecret).toHaveBeenCalledWith('INWORLD_API_KEY', 'legacy-key')
    expect(deleteUserSecret).toHaveBeenCalledWith('INWORLD_RUNTIME_KEY')
    delete process.env.INWORLD_API_KEY
  })

  it('validates the canonical Inworld key and voice through TTS 2 Flash preview', async () => {
    getUserSecret.mockImplementation(async (name: string) => {
      if (name === 'INWORLD_API_KEY') return 'base64-key'
      if (name === 'INWORLD_VOICE_ID') return 'Dennis'
      return null
    })
    const previousFetch = globalThis.fetch
    const fetchMock = mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () => new Response('preview', { status: 200 }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const handler = register().get(RPC_CHANNELS.secrets.TEST_INWORLD)!
      await expect(handler({}, 'workspace-owner')).resolves.toEqual({ success: true, voiceId: 'Dennis' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toContain('voice_id=Dennis')
      expect(String(url)).toContain('model_id=inworld-tts-2-flash')
      expect(init?.headers).toMatchObject({ Authorization: 'Basic base64-key' })
    } finally {
      globalThis.fetch = previousFetch
    }
  })
})
