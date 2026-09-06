import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as actualConfig from '@craft-agent/shared/config'

type ProtocolHandler = (request: Request) => Promise<Response>

let defaultHandler: ProtocolHandler | null = null

const defaultHandle = mock((_scheme: string, handler: ProtocolHandler) => {
  defaultHandler = handler
})
const partitionHandle = mock((_scheme: string, _handler: ProtocolHandler) => {})
const fromPartition = mock((_partition: string) => ({
  protocol: {
    handle: partitionHandle,
  },
}))

// mock.module is process-global and never undone. A partial 'electron' stub
// here becomes *the* electron for every test file that runs after this one in
// the same process — which is how the RPC registration tests failed on sharded
// CI with "Export named 'app' not found". Stub everything the main-process
// handlers import, not just what this file uses.
mock.module('electron', () => ({
  protocol: {
    handle: defaultHandle,
  },
  session: {
    fromPartition,
  },
  ipcMain: { handle: () => {}, on: () => {} },
  app: {
    isPackaged: false,
    getAppPath: () => '/',
    getPath: () => '/',
    quit: () => {},
    on: () => {},
    dock: { setIcon: () => {}, setBadge: () => {} },
  },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  BrowserView: class {},
  Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
  Notification: class { static isSupported() { return false } on() {} show() {} },
}))

mock.module('../logger', () => ({
  mainLog: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}))

/**
 * Two workspaces on disk. `victim` holds the asset that generated HTML in
 * `attacker` must never be able to read.
 */
let root: string
const workspaces = new Map<string, { rootPath: string; remoteServer?: unknown }>()

/** Output ids must be UUIDs (`isValidOutputId`); anything else 404s before reaching path logic. */
const ATTACKER_OUTPUT = '11111111-1111-4111-8111-111111111111'
const VICTIM_OUTPUT = '22222222-2222-4222-8222-222222222222'

// Same rule for the config module: keep every real export and override only
// the one this test controls, so a later file's `import { getWorkspaces }`
// still resolves.
mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (id: string) => workspaces.get(id) ?? null,
}))

const { registerOutputAssetHandler } = await import('../output-asset-protocol')
const { BROWSER_PANE_SESSION_PARTITION } = await import('../browser-pane-constants')
const { RUNNER_OUTPUT_SCHEME, buildRunnerOutputAssetUrl } = await import('@craft-agent/shared/outputs')

function assetUrl(workspaceId: string, outputId: string, assetPath: string): string {
  return buildRunnerOutputAssetUrl(workspaceId, outputId, assetPath)
}

async function handle(url: string): Promise<Response> {
  if (!defaultHandler) throw new Error('protocol handler was never registered')
  return defaultHandler(new Request(url))
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'output-asset-protocol-'))

  for (const [name, outputId] of [['attacker', ATTACKER_OUTPUT], ['victim', VICTIM_OUTPUT]] as const) {
    const rootPath = join(root, name)
    mkdirSync(join(rootPath, 'outputs', outputId, 'nested'), { recursive: true })
    workspaces.set(name, { rootPath })
  }

  writeFileSync(join(root, 'attacker', 'outputs', ATTACKER_OUTPUT, 'index.html'), '<h1>generated</h1>')
  writeFileSync(join(root, 'victim', 'outputs', VICTIM_OUTPUT, 'secret.html'), 'SECRET')

  registerOutputAssetHandler()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('registerOutputAssetHandler', () => {
  test('registers runner-output on the default and browser-pane protocol sessions', () => {
    expect(defaultHandle).toHaveBeenCalledWith(RUNNER_OUTPUT_SCHEME, expect.any(Function))
    expect(fromPartition).toHaveBeenCalledWith(BROWSER_PANE_SESSION_PARTITION)
    expect(partitionHandle).toHaveBeenCalledWith(RUNNER_OUTPUT_SCHEME, expect.any(Function))
  })
})

describe('generated-output CSP', () => {
  test('permits own-bundle fetch on a distinct output origin', async () => {
    const response = await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'self'")
    expect(new URL(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html')).host)
      .not.toBe(new URL(assetUrl('victim', VICTIM_OUTPUT, 'secret.html')).host)
    expect(response.headers.get('Origin-Agent-Cluster')).toBeNull()
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts allow-same-origin')
  })

  test('allows subresources only from the output origin, never the whole scheme', async () => {
    const csp = (await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html')))
      .headers.get('Content-Security-Policy') ?? ''

    expect(csp).not.toContain(`${RUNNER_OUTPUT_SCHEME}:`)
    expect(csp).toContain("style-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("img-src 'self'")
  })

  test('denies by default and blocks framing, objects, base-uri, and form posts', async () => {
    const csp = (await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html')))
      .headers.get('Content-Security-Policy') ?? ''

    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
  })

  test('is served on every asset type, not just HTML', async () => {
    writeFileSync(join(root, 'attacker', 'outputs', ATTACKER_OUTPUT, 'app.js'), 'console.log(1)')
    const response = await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'app.js'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/javascript')
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'self'")
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('path scoping', () => {
  /**
   * Every way one output could reach another output's bytes. The status code is
   * deliberately not asserted: a raw `..` is rejected by `isSafeProtocolAssetPath`
   * (400), while a percent-encoded `%2E%2E` is collapsed by WHATWG URL parsing
   * before the guard ever runs, leaving a non-UUID output id (404). Both are
   * blocked; pinning the code would test the URL parser, not the guard.
   */
  const escapeAttempts: Array<[string, () => string]> = [
    ['raw traversal segments', () =>
      `${RUNNER_OUTPUT_SCHEME}://asset/attacker/${ATTACKER_OUTPUT}/../../victim/outputs/${VICTIM_OUTPUT}/secret.html`],
    ['percent-encoded traversal segments', () =>
      `${RUNNER_OUTPUT_SCHEME}://asset/attacker/${ATTACKER_OUTPUT}/${encodeURIComponent('..')}/${encodeURIComponent('..')}/victim/outputs/${VICTIM_OUTPUT}/secret.html`],
    ['an absolute path into another workspace', () =>
      `${RUNNER_OUTPUT_SCHEME}://asset/attacker/${ATTACKER_OUTPUT}/${encodeURIComponent(join(root, 'victim', 'outputs', VICTIM_OUTPUT, 'secret.html'))}`],
  ]

  for (const [label, buildUrl] of escapeAttempts) {
    test(`never serves another workspace's asset via ${label}`, async () => {
      let response = await handle(buildUrl())
      if (response.status === 302) response = await handle(response.headers.get('location')!)
      expect([400, 404]).toContain(response.status)
      const body = await response.text()
      expect(body).not.toContain('SECRET')
    })
  }

  test('serves another output only at its own scoped origin', async () => {
    const response = await handle(assetUrl('victim', VICTIM_OUTPUT, 'secret.html'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('SECRET')
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'self'")
  })

  test('rejects another workspace/output path on the attacker origin', async () => {
    const forged = new URL(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html'))
    forged.pathname = new URL(assetUrl('victim', VICTIM_OUTPUT, 'secret.html')).pathname
    expect((await handle(forged.href)).status).toBe(400)
  })

  test('redirects old shared-origin links before serving any bytes', async () => {
    const response = await handle(`${RUNNER_OUTPUT_SCHEME}://asset/attacker/${ATTACKER_OUTPUT}/index.html?v=2`)
    expect(response.status).toBe(302)
    expect(await response.text()).toBe('')
    expect(response.headers.get('location')).toBe(`${assetUrl('attacker', ATTACKER_OUTPUT, 'index.html')}?v=2`)
  })

  test('rejects an undeclared absolute asset from the same workspace', async () => {
    const privateFile = join(root, 'attacker', 'private.json')
    writeFileSync(privateFile, 'PRIVATE')
    expect((await handle(assetUrl('attacker', ATTACKER_OUTPUT, privateFile))).status).toBe(404)
  })

  test('serves manifest-attached absolute PDF and image assets', async () => {
    const paths = ['attached.pdf', 'attached.png'].map((name) => join(root, 'attacker', name))
    const assets = paths.map((path, i) => ({ id: `attached-${i}`, label: 'Attached', role: 'primary', path }))
    writeFileSync(join(root, 'attacker', 'outputs', ATTACKER_OUTPUT, 'output.json'), JSON.stringify({
      schemaVersion: 1, id: ATTACKER_OUTPUT, workspaceId: 'attacker', title: 'Attached', slug: 'attached', summary: '',
      kind: 'report', status: 'published', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
      origin: { source: 'workflow' }, primary: assets[0], assets, receipts: [], links: [],
    }))
    for (const path of paths) {
      writeFileSync(path, 'ATTACHED')
      const response = await handle(assetUrl('attacker', ATTACKER_OUTPUT, path))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('ATTACHED')
      expect(response.headers.get('Content-Security-Policy')).not.toContain('sandbox')
    }
  })

  test('rejects a symlink from the bundle into another workspace', async () => {
    symlinkSync(join(root, 'victim', 'outputs', VICTIM_OUTPUT, 'secret.html'),
      join(root, 'attacker', 'outputs', ATTACKER_OUTPUT, 'linked.html'))
    expect((await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'linked.html'))).status).toBe(404)
  })

  test('rejects a symlink into a different output in the same workspace', async () => {
    const other = join(root, 'attacker', 'outputs', VICTIM_OUTPUT)
    mkdirSync(other)
    writeFileSync(join(other, 'secret.html'), 'PRIVATE')
    symlinkSync(join(other, 'secret.html'), join(root, 'attacker', 'outputs', ATTACKER_OUTPUT, 'other.html'))
    expect((await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'other.html'))).status).toBe(404)
  })

  test('404s an unknown workspace instead of resolving it against another root', async () => {
    const response = await handle(assetUrl('does-not-exist', ATTACKER_OUTPUT, 'index.html'))
    expect(response.status).toBe(404)
  })

  test('404s a remote workspace', async () => {
    workspaces.set('remote', { rootPath: join(root, 'attacker'), remoteServer: { url: 'https://example.test' } })
    const response = await handle(assetUrl('remote', ATTACKER_OUTPUT, 'index.html'))
    expect(response.status).toBe(404)
    workspaces.delete('remote')
  })

  test('404s a directory rather than streaming it', async () => {
    const response = await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'nested'))
    expect(response.status).toBe(404)
  })
})
