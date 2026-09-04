import { protocol, session, type Session } from 'electron'
import { readFile, stat, realpath } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { assertOutputAssetPath, buildRunnerOutputAssetUrl, readOutputManifest, parseRunnerOutputAssetUrl, RUNNER_OUTPUT_SCHEME } from '@craft-agent/shared/outputs'
import { mainLog } from './logger'
import { BROWSER_PANE_SESSION_PARTITION } from './browser-pane-constants'

/**
 * CSP for generated-output documents.
 *
 * Each output has a distinct origin, verified against the URL's workspace/output
 * path. 'self' permits local scripts, styles and data while excluding every other
 * output in both iframe and Browser Pane. Never serve a document on the legacy
 * shared host: old links redirect before bytes are returned. No CORS bypass.
 */
const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function registerOutputAssetHandler(): void {
  registerOutputAssetProtocolHandler(protocol, 'default session')
  registerOutputAssetProtocolHandler(session.fromPartition(BROWSER_PANE_SESSION_PARTITION).protocol, 'browser-pane session')
}

export function registerOutputAssetProtocolHandler(targetProtocol: Pick<typeof protocol, 'handle'> | Pick<Session['protocol'], 'handle'>, label: string): void {
  targetProtocol.handle(RUNNER_OUTPUT_SCHEME, async (request) => {
    try {
      const parsed = parseRunnerOutputAssetUrl(request.url)
      if (!parsed) return new Response(null, { status: 400 })

      const workspace = getWorkspaceByNameOrId(parsed.workspaceId)
      if (!workspace || workspace.remoteServer) return new Response(null, { status: 404 })

      const url = new URL(request.url)
      if (url.hostname === 'asset') {
        const canonical = new URL(buildRunnerOutputAssetUrl(parsed.workspaceId, parsed.outputId, parsed.assetPath))
        canonical.search = url.search
        canonical.hash = url.hash
        return new Response(null, { status: 302, headers: { Location: canonical.href, 'Cache-Control': 'no-store' } })
      }

      const safePath = await resolveProtocolAssetPath(workspace.rootPath, parsed.outputId, parsed.assetPath)
      const fileStat = await stat(safePath)
      if (!fileStat.isFile()) return new Response(null, { status: 404 })

      const body = await readFile(safePath)
      const mimeType = mimeTypeForPath(safePath)
      // Document sandboxing also forbids document.domain relaxation in Browser
      // Pane. OAC ?1 crashes Electron 39 custom-scheme navigation; do not use it.
      // Keep PDF plugin rendering unsandboxed. Scripts/data retain own origin.
      const csp = ['text/html', 'image/svg+xml'].includes(mimeType.split(';')[0]!)
        ? `${HTML_PREVIEW_CSP}; sandbox allow-scripts allow-same-origin allow-forms`
        : HTML_PREVIEW_CSP
      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      mainLog.warn('Output asset protocol request failed:', error)
      return new Response(null, { status: 404 })
    }
  })

  mainLog.info(`Registered ${RUNNER_OUTPUT_SCHEME}:// protocol handler (${label})`)
}

async function resolveProtocolAssetPath(root: string, outputId: string, assetPath: string): Promise<string> {
  const candidate = assertOutputAssetPath(root, outputId, assetPath)
  const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(candidate)])
  const contained = (base: string, file: string) => {
    const path = relative(base, file)
    return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path)
  }
  if (!contained(actualRoot, actualFile)) throw new Error('Output asset leaves its workspace')
  if (isAbsolute(assetPath)) {
    // Legacy session assets are allowed only when explicitly attached to this
    // Output. A page cannot turn its own origin into a workspace-wide file API.
    const manifest = readOutputManifest(root, outputId)
    const assets = [...(manifest?.assets ?? []), ...(manifest?.primary ? [manifest.primary] : [])]
    if (!assets.some((asset) => isAbsolute(asset.path) && resolve(asset.path) === candidate)) {
      throw new Error('Absolute preview asset is not attached to this Output')
    }
  } else if (!contained(resolve(actualRoot, 'outputs', outputId), actualFile)) {
    throw new Error('Output asset leaves its bundle')
  }
  return actualFile
}

function mimeTypeForPath(path: string): string {
  if (/\.workflow-run\.json$/i.test(path)) return 'application/vnd.runneros.workflow-run+json'
  if (/\.workflow\.json$/i.test(path)) return 'application/vnd.runneros.workflow+json'
  if (/\.(chart|vega|vegalite)\.json$/i.test(path)) return 'application/vnd.runneros.chart+json'
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mimeMap: Record<string, string> = {
    css: 'text/css',
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    excalidraw: 'application/vnd.excalidraw+json',
    mp4: 'video/mp4',
    webm: 'video/webm',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
    wav: 'audio/wav',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  }
  return mimeMap[ext] ?? 'application/octet-stream'
}
