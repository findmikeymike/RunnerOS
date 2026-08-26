import { afterEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  applyPackagedTradeGodRuntimeIdentity,
  assertTradeGodRuntimeBoundary,
} from '../trade-god-runtime-identity.ts'

const sandboxes: string[] = []

const sandboxHome = (): string => {
  const root = join(tmpdir(), `trade-god-boundary-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  sandboxes.push(root)
  return root
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('packaged Trade God refuses generic Runner identity and runtime variables', () => {
  const env: NodeJS.ProcessEnv = {
    CRAFT_CONFIG_DIR: '/artist/config',
    CRAFT_USER_DATA_DIR: '/artist/electron',
    CRAFT_APP_NAME: 'Artist OS',
    CRAFT_DEEPLINK_SCHEME: 'artist',
    CRAFT_SERVER_URL: 'wss://artist.invalid',
    CRAFT_TRIGGER_PORT: '9999',
    CRAFT_TRIGGER_HOST: '0.0.0.0',
    RUNNEROS_ROOT: '/artist/worktree',
  }

  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator')

  expect(env).toMatchObject({
    CRAFT_CONFIG_DIR: '/Users/operator/.trade-god',
    CRAFT_USER_DATA_DIR: '/Users/operator/.trade-god/electron',
    CRAFT_APP_NAME: 'Trade God',
    CRAFT_DEEPLINK_SCHEME: 'tradegod',
    CRAFT_TRIGGER_PORT: '9201',
    CRAFT_TRIGGER_HOST: '127.0.0.1',
  })
  expect(env.CRAFT_SERVER_URL).toBeUndefined()
  expect(env.RUNNEROS_ROOT).toBeUndefined()
})

test('packaged Trade God ignores every inherited and dedicated path override', () => {
  const env: NodeJS.ProcessEnv = {
    TRADE_GOD_CONFIG_DIR: '/trade/config',
    TRADE_GOD_USER_DATA_DIR: '/trade/electron',
    TRADE_GOD_SERVER_URL: 'wss://trade.invalid',
    TRADE_GOD_RUNNEROS_ROOT: '/trade/worktree',
    TRADE_GOD_TRIGGER_PORT: '9301',
    TRADE_GOD_TRIGGER_HOST: '127.0.0.2',
  }

  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator')
  expect(env).toMatchObject({
    CRAFT_CONFIG_DIR: '/Users/operator/.trade-god',
    CRAFT_USER_DATA_DIR: '/Users/operator/.trade-god/electron',
    CRAFT_TRIGGER_PORT: '9201',
    CRAFT_TRIGGER_HOST: '127.0.0.1',
  })
  expect(env.CRAFT_SERVER_URL).toBeUndefined()
  expect(env.RUNNEROS_ROOT).toBeUndefined()
})

test('development keeps its explicitly isolated worktree identity only from trusted app state', () => {
  const env: NodeJS.ProcessEnv = {
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    CRAFT_CONFIG_DIR: '/dev/trade-config',
  }
  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator', false)
  expect(env.CRAFT_CONFIG_DIR).toBe('/dev/trade-config')
})

test('packaged identity cannot be bypassed by an inherited Vite URL', () => {
  const env: NodeJS.ProcessEnv = {
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    CRAFT_CONFIG_DIR: '/artist/config',
  }
  applyPackagedTradeGodRuntimeIdentity(env, '/Users/operator', true)
  expect(env.CRAFT_CONFIG_DIR).toBe('/Users/operator/.trade-god')
  expect(env.CRAFT_APP_NAME).toBe('Trade God')
})

test('accepts a contained Trade God workspace registry', () => {
  const home = sandboxHome()
  const runtimeRoot = join(home, '.trade-god')
  const workspaceRoot = join(runtimeRoot, 'workspaces', 'trading')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(runtimeRoot, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'trading', name: 'Trading', rootPath: '~/.trade-god/workspaces/trading' }],
  }))

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runtimeRoot,
    CRAFT_USER_DATA_DIR: join(runtimeRoot, 'electron'),
  }, home, true)).not.toThrow()
})

test('refuses Runner storage even when supplied through Trade God variables', () => {
  const home = sandboxHome()
  const runnerRoot = join(home, '.craft-agent')

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runnerRoot,
    CRAFT_USER_DATA_DIR: join(runnerRoot, 'electron'),
  }, home, false)).toThrow('Refusing to use Runner or Artist OS runtime storage')
})

test('refuses an Electron profile outside the Trade God root', () => {
  const home = sandboxHome()
  const runtimeRoot = join(home, '.trade-god')

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runtimeRoot,
    CRAFT_USER_DATA_DIR: join(home, 'shared-electron'),
  }, home, false)).toThrow('outside the Trade God runtime root')
})

test('refuses a stored workspace outside the Trade God workspace root', () => {
  const home = sandboxHome()
  const runtimeRoot = join(home, '.trade-god')
  mkdirSync(runtimeRoot, { recursive: true })
  writeFileSync(join(runtimeRoot, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'artist', name: 'Artist', rootPath: '~/.craft-agent/workspaces/artist' }],
  }))

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runtimeRoot,
    CRAFT_USER_DATA_DIR: join(runtimeRoot, 'electron'),
  }, home, true)).toThrow('workspace outside the Trade God runtime root')
})

test('refuses a remote Runner workspace even when its local mirror is contained', () => {
  const home = sandboxHome()
  const runtimeRoot = join(home, '.trade-god')
  mkdirSync(runtimeRoot, { recursive: true })
  writeFileSync(join(runtimeRoot, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'remote',
      name: 'Remote Runner',
      rootPath: '~/.trade-god/workspaces/remote',
      remoteServer: { url: 'ws://127.0.0.1:9100', token: 'not-a-real-token', remoteWorkspaceId: 'runner' },
    }],
  }))

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runtimeRoot,
    CRAFT_USER_DATA_DIR: join(runtimeRoot, 'electron'),
  }, home, true)).toThrow('remote Runner workspace')
})

test('refuses a workspace symlink that escapes into Runner storage', () => {
  const home = sandboxHome()
  const runtimeRoot = join(home, '.trade-god')
  const workspacesRoot = join(runtimeRoot, 'workspaces')
  const runnerWorkspace = join(home, '.craft-agent', 'workspaces', 'artist')
  mkdirSync(workspacesRoot, { recursive: true })
  mkdirSync(runnerWorkspace, { recursive: true })
  symlinkSync(runnerWorkspace, join(workspacesRoot, 'trading'))
  writeFileSync(join(runtimeRoot, 'config.json'), JSON.stringify({
    workspaces: [{ id: 'trading', name: 'Trading', rootPath: '~/.trade-god/workspaces/trading' }],
  }))

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runtimeRoot,
    CRAFT_USER_DATA_DIR: join(runtimeRoot, 'electron'),
  }, home, true)).toThrow('symbolic')
})

test('refuses a runtime config symlink into Runner storage before parsing it', () => {
  const home = sandboxHome()
  const runtimeRoot = join(home, '.trade-god')
  const runnerRoot = join(home, '.craft-agent')
  mkdirSync(runtimeRoot, { recursive: true })
  mkdirSync(runnerRoot, { recursive: true })
  writeFileSync(join(runnerRoot, 'config.json'), JSON.stringify({ workspaces: [] }))
  symlinkSync(join(runnerRoot, 'config.json'), join(runtimeRoot, 'config.json'))

  expect(() => assertTradeGodRuntimeBoundary({
    CRAFT_CONFIG_DIR: runtimeRoot,
    CRAFT_USER_DATA_DIR: join(runtimeRoot, 'electron'),
  }, home, true)).toThrow('symbolic links cannot own Trade God runtime state')
})

test('agent-facing Trade God surfaces never direct writes into Runner storage', () => {
  const docsDir = resolve(import.meta.dir, '../../../resources/docs')
  const repoRoot = resolve(import.meta.dir, '../../../../..')
  const files = [
    ...readdirSync(docsDir).filter((name) => name.endsWith('.md')).map((name) => join(docsDir, name)),
    resolve(import.meta.dir, '../../renderer/components/ui/EditPopover.tsx'),
    resolve(import.meta.dir, '../../renderer/pages/PreferencesPage.tsx'),
    join(repoRoot, 'packages/session-tools-core/src/handlers/config-validate.ts'),
    join(repoRoot, 'packages/session-tools-core/src/handlers/mermaid-validate.ts'),
    join(repoRoot, 'packages/ui/src/components/chat/UserMessageBubble.tsx'),
    join(repoRoot, 'packages/server-core/src/handlers/rpc/auth.ts'),
    join(repoRoot, 'packages/server-core/src/services/privileged-execution-broker.ts'),
  ]

  for (const file of files) {
    expect(readFileSync(file, 'utf8')).not.toContain('.craft-agent')
  }
})
