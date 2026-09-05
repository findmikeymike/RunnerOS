import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EmbeddedOmniRoute,
  EMBEDDED_OMNIROUTE_BASE_URL,
  buildEmbeddedOmniRouteEnv,
  resolveEmbeddedOmniRoutePaths,
} from './embedded-omniroute'

describe('embedded OmniRoute configuration', () => {
  test('uses a loopback-only, keyless local gateway', () => {
    const env = buildEmbeddedOmniRouteEnv('/tmp/artist-os-omniroute', { PATH: '/bin' })

    expect(EMBEDDED_OMNIROUTE_BASE_URL).toBe('http://127.0.0.1:20128/v1')
    expect(env.OMNIROUTE_SERVER_HOST).toBe('127.0.0.1')
    expect(env.REQUIRE_API_KEY).toBe('false')
    expect(env.DATA_DIR).toBe('/tmp/artist-os-omniroute')
    expect(env.OMNIROUTE_CLI_SKIP_REPO_ENV).toBe('1')
  })

  test('does not reuse an unrelated server occupying the gateway port', async () => {
    const runtime = new EmbeddedOmniRoute(
      { serverPath: '/server.mjs', runtimePath: '/electron', dataDir: '/data' },
      { info() {}, warn() {}, error() {} },
      {
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'some-other-model' }] })),
      },
    )

    expect(await runtime.isReady()).toBe(false)
  })

  test('recognizes the embedded free route', async () => {
    const runtime = new EmbeddedOmniRoute(
      { serverPath: '/server.mjs', runtimePath: '/electron', dataDir: '/data' },
      { info() {}, warn() {}, error() {} },
      {
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'auto/best-free' }] })),
      },
    )

    expect(await runtime.isReady()).toBe(true)
  })

  test('resolves the installed development runtime without a global CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'artist-os-omniroute-'))
    const serverPath = join(root, 'node_modules', 'omniroute', 'dist', 'server-ws.mjs')
    const runtimePath = join(root, 'electron')
    mkdirSync(join(root, 'node_modules', 'omniroute', 'dist'), { recursive: true })
    writeFileSync(serverPath, '')
    writeFileSync(runtimePath, '')

    const paths = resolveEmbeddedOmniRoutePaths({
      appRootPath: join(root, 'apps', 'electron'),
      resourcesPath: join(root, 'resources'),
      dataRoot: join(root, 'artist-data'),
      isPackaged: false,
      cwd: root,
      configuredRuntimePath: runtimePath,
    })

    expect(existsSync(serverPath)).toBe(true)
    expect(paths).toEqual({
      serverPath,
      runtimePath,
      dataDir: join(root, 'artist-data', 'integrations', 'omniroute'),
    })
  })
})
