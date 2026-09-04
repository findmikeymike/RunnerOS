import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

/**
 * Create isolated config dir with a root config containing the given connections.
 * Returns paths needed by tests plus a runner to call updateLlmConnection in a subprocess.
 */
function setup(llmConnections: any[]) {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws-config-1',
      name: 'My Workspace',
      slug: 'my-workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  )

  const configPath = join(configDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      defaultLlmConnection: llmConnections[0]?.slug ?? null,
      llmConnections,
    }, null, 2),
    'utf-8',
  )

  function runUpdate(slug: string, updates: Record<string, unknown>): boolean {
    return runUpdateSource(slug, JSON.stringify(updates))
  }

  function runUpdateSource(slug: string, updatesSource: string): boolean {
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { updateLlmConnection } from '${STORAGE_MODULE_PATH}'; const ok = updateLlmConnection(${JSON.stringify(slug)}, ${updatesSource}); process.exit(ok ? 0 : 1);`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (run.exitCode !== 0 && run.stderr.toString().trim()) {
      throw new Error(`update subprocess failed:\n${run.stderr.toString()}`)
    }
    return run.exitCode === 0
  }

  function readConnection(slug: string): any {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return config.llmConnections.find((c: any) => c.slug === slug)
  }

  function runSetGlobal(chain: unknown): boolean {
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { setModelFallbackChain } from '${STORAGE_MODULE_PATH}'; const ok = setModelFallbackChain(${JSON.stringify(chain)}); process.exit(ok ? 0 : 1);`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return run.exitCode === 0
  }

  function readConfig(): any {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  }

  return { configDir, configPath, runUpdate, runUpdateSource, runSetGlobal, readConnection, readConfig }
}

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'custom-compat',
    name: 'My Custom Endpoint',
    providerType: 'pi_compat',
    authType: 'api_key_with_endpoint',
    createdAt: Date.now(),
    baseUrl: 'http://localhost:8085',
    piAuthProvider: 'anthropic',
    ...overrides,
  }
}

describe('updateLlmConnection – customEndpoint', () => {
  it('preserves customEndpoint when provided in updates', () => {
    const { runUpdate, readConnection } = setup([makeConnection()])
    const customEndpoint = { api: 'anthropic-messages' }

    const ok = runUpdate('custom-compat', { customEndpoint })
    expect(ok).toBe(true)

    const conn = readConnection('custom-compat')
    expect(conn.customEndpoint).toEqual(customEndpoint)
  })

  it('preserves existing customEndpoint when updates do not include it', () => {
    const customEndpoint = { api: 'openai-completions' }
    const { runUpdate, readConnection } = setup([makeConnection({ customEndpoint })])

    // Update an unrelated field
    const ok = runUpdate('custom-compat', { name: 'Renamed Endpoint' })
    expect(ok).toBe(true)

    const conn = readConnection('custom-compat')
    expect(conn.customEndpoint).toEqual(customEndpoint)
    expect(conn.name).toBe('Renamed Endpoint')
  })

  it('overwrites customEndpoint protocol when updated', () => {
    const { runUpdate, readConnection } = setup([
      makeConnection({ customEndpoint: { api: 'openai-completions' } }),
    ])

    const ok = runUpdate('custom-compat', { customEndpoint: { api: 'anthropic-messages' } })
    expect(ok).toBe(true)

    const conn = readConnection('custom-compat')
    expect(conn.customEndpoint).toEqual({ api: 'anthropic-messages' })
  })
})

describe('model fallback chain storage', () => {
  it('persists and clears a per-connection override', () => {
    const chain = { enabled: true, entries: [{ connectionSlug: 'backup', model: 'model-b' }] }
    const { runUpdate, runUpdateSource, readConnection } = setup([
      makeConnection({ defaultModel: 'model-a' }),
      makeConnection({ slug: 'backup', defaultModel: 'model-b' }),
    ])

    expect(runUpdate('custom-compat', { fallbackChain: chain })).toBe(true)
    expect(readConnection('custom-compat').fallbackChain).toEqual(chain)

    expect(runUpdateSource('custom-compat', '{ fallbackChain: undefined }')).toBe(true)
    expect(readConnection('custom-compat')).not.toHaveProperty('fallbackChain')
  })

  it('rejects an invalid per-connection chain without changing stored config', () => {
    const { runUpdate, readConnection } = setup([makeConnection({ defaultModel: 'model-a' })])
    const before = readConnection('custom-compat')

    expect(runUpdate('custom-compat', {
      fallbackChain: { enabled: true, entries: [{ connectionSlug: 'custom-compat', model: 'model-a' }] },
    })).toBe(false)
    expect(readConnection('custom-compat')).toEqual(before)
  })

  it('persists a valid global chain and rejects invalid replacements', () => {
    const valid = { enabled: true, entries: [{ connectionSlug: 'backup', model: 'model-b' }] }
    const { runSetGlobal, readConfig } = setup([makeConnection()])

    expect(runSetGlobal(valid)).toBe(true)
    expect(readConfig().modelFallbackChain).toEqual(valid)

    expect(runSetGlobal({ enabled: true, entries: [
      { connectionSlug: 'backup', model: 'model-b' },
      { connectionSlug: 'backup', model: 'model-b' },
    ] })).toBe(false)
    expect(readConfig().modelFallbackChain).toEqual(valid)
  })
})
