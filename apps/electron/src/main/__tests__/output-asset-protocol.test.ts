import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

mock.module('electron', () => ({
  protocol: {
    handle: defaultHandle,
  },
  session: {
    fromPartition,
  },
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

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => workspaces.get(id) ?? null,
}))

const { registerOutputAssetHandler } = await import('../output-asset-protocol')
const { BROWSER_PANE_SESSION_PARTITION } = await import('../browser-pane-constants')
const { RUNNER_OUTPUT_SCHEME } = await import('@craft-agent/shared/outputs')

function assetUrl(workspaceId: string, outputId: string, assetPath: string): string {
  return `${RUNNER_OUTPUT_SCHEME}://asset/${workspaceId}/${outputId}/${assetPath}`
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
  test('forbids fetch/XHR outright so a shared-origin document cannot read another output', async () => {
    const response = await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'")
  })

  test("never grants 'self', which under an opaque origin matches nothing and would blank every page", async () => {
    const csp = (await handle(assetUrl('attacker', ATTACKER_OUTPUT, 'index.html')))
      .headers.get('Content-Security-Policy') ?? ''

    expect(csp).not.toContain("'self'")
    // Subresources must stay loadable by scheme, or a page with a separate
    // stylesheet renders blank once the iframe origin goes opaque.
    expect(csp).toContain(`style-src ${RUNNER_OUTPUT_SCHEME}:`)
    expect(csp).toContain(`script-src ${RUNNER_OUTPUT_SCHEME}:`)
    expect(csp).toContain(`img-src ${RUNNER_OUTPUT_SCHEME}:`)
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
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'")
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
      const response = await handle(buildUrl())
      const body = response.status === 200 ? await response.text() : ''
      expect(body).not.toContain('SECRET')
    })
  }

  /**
   * The handler serves any workspace addressed by id — it cannot see who is
   * asking, so it is NOT the thing that isolates one output from another.
   * Isolation is the browser's job: an opaque iframe origin plus
   * `connect-src 'none'`. This test states that boundary explicitly so nobody
   * later "hardens" the handler and assumes the job is done here.
   */
  test('serves any workspace addressed directly — isolation is the CSP/origin, not this handler', async () => {
    const response = await handle(assetUrl('victim', VICTIM_OUTPUT, 'secret.html'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('SECRET')
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'")
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
