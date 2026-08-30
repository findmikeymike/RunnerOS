import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { getCredentialManager } from '@craft-agent/shared/credentials'

const ASSEMBLYAI_TOKEN_URL = 'https://streaming.assemblyai.com/v3/token'
const INWORLD_TTS_WS_URL = 'wss://api.inworld.ai/tts/v1/voice:streamBidirectional'
const ACCESS_TOKEN_QUERY = 'artist_manager_voice_token'

export type ArtistManagerVoiceProviderStatus = {
  assemblyAi: boolean
  inworld: boolean
  ready: boolean
}

export type ArtistManagerVoiceProxyInfo = {
  webSocketUrl: string
  accessToken: string
  voiceId?: string
}

export type ArtistManagerVoiceProxy = {
  info: ArtistManagerVoiceProxyInfo
  providerStatus(): Promise<ArtistManagerVoiceProviderStatus>
  createAssemblyAiToken(): Promise<string>
  close(): Promise<void>
}

export async function startArtistManagerVoiceProxy(): Promise<ArtistManagerVoiceProxy> {
  const accessToken = randomBytes(32).toString('base64url')
  const browserWss = new WebSocketServer({ noServer: true })
  const server = createServer((_req, res) => {
    res.statusCode = 404
    res.end()
  })

  server.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket as Socket, head, browserWss, accessToken)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server, browserWss)
    throw new Error('Artist Manager voice proxy could not bind to loopback')
  }

  return {
    info: {
      webSocketUrl: `ws://127.0.0.1:${address.port}/inworld`,
      accessToken,
      voiceId: process.env.INWORLD_VOICE_ID?.trim() || undefined,
    },
    providerStatus: getArtistManagerVoiceProviderStatus,
    createAssemblyAiToken,
    close: () => closeServer(server, browserWss),
  }
}

export async function getArtistManagerVoiceProviderStatus(): Promise<ArtistManagerVoiceProviderStatus> {
  const [assemblyAiKey, inworldKey] = await Promise.all([
    readSecret('ASSEMBLYAI_API_KEY'),
    readSecret('INWORLD_RUNTIME_KEY'),
  ])
  return {
    assemblyAi: Boolean(assemblyAiKey),
    inworld: Boolean(inworldKey),
    ready: Boolean(assemblyAiKey && inworldKey),
  }
}

export async function createAssemblyAiToken(): Promise<string> {
  const apiKey = await readSecret('ASSEMBLYAI_API_KEY')
  if (!apiKey) throw new Error('Voice transcription needs an AssemblyAI key in Settings')

  const url = new URL(ASSEMBLYAI_TOKEN_URL)
  url.searchParams.set('expires_in_seconds', '60')
  url.searchParams.set('max_session_duration_seconds', '600')
  const response = await fetch(url, { headers: { Authorization: apiKey } })
  if (!response.ok) {
    throw new Error(`Voice transcription could not start (${response.status})`)
  }
  const payload = await response.json() as { token?: unknown; temporary_token?: unknown }
  const token = typeof payload.token === 'string'
    ? payload.token
    : typeof payload.temporary_token === 'string'
      ? payload.temporary_token
      : ''
  if (!token) throw new Error('Voice transcription returned no temporary token')
  return token
}

async function handleUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  browserWss: WebSocketServer,
  accessToken: string,
): Promise<void> {
  if (!req.url?.startsWith('/inworld')) {
    rejectSocket(socket, '404 Not Found')
    return
  }
  if (!isAllowedVoiceProxyOrigin(req.headers.origin)) {
    rejectSocket(socket, '403 Forbidden')
    return
  }
  if (!voiceProxyTokensMatch(readAccessToken(req.url), accessToken)) {
    rejectSocket(socket, '401 Unauthorized')
    return
  }

  const runtimeKey = await readSecret('INWORLD_RUNTIME_KEY')
  if (!runtimeKey) {
    rejectSocket(socket, '503 Service Unavailable')
    return
  }

  browserWss.handleUpgrade(req, socket, head, (browserSocket) => {
    bridgeSockets(browserSocket, new WebSocket(INWORLD_TTS_WS_URL, {
      headers: { Authorization: buildInworldAuthorization(runtimeKey) },
    }))
  })
}

function bridgeSockets(browserSocket: WebSocket, upstreamSocket: WebSocket): void {
  const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = []
  browserSocket.on('message', (data, isBinary) => {
    if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary: isBinary })
    else if (upstreamSocket.readyState === WebSocket.CONNECTING) pending.push({ data, isBinary })
  })
  upstreamSocket.on('open', () => {
    for (const message of pending.splice(0)) upstreamSocket.send(message.data, { binary: message.isBinary })
  })
  upstreamSocket.on('message', (data, isBinary) => {
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data, { binary: isBinary })
  })
  upstreamSocket.on('close', (code, reason) => {
    if (browserSocket.readyState === WebSocket.OPEN) {
      browserSocket.close(normalizeCloseCode(code), reason.toString().slice(0, 120))
    }
  })
  upstreamSocket.on('error', () => {
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, 'Voice service unavailable')
  })
  browserSocket.on('close', () => upstreamSocket.close())
  browserSocket.on('error', () => upstreamSocket.close())
}

async function readSecret(name: 'ASSEMBLYAI_API_KEY' | 'INWORLD_RUNTIME_KEY'): Promise<string | null> {
  const stored = await getCredentialManager().getUserSecret(name)
  return stored?.trim() || process.env[name]?.trim() || null
}

export function isAllowedVoiceProxyOrigin(origin: string | undefined): boolean {
  const normalized = origin?.trim()
  if (!normalized || normalized === 'null' || normalized.startsWith('file://')) return true
  try {
    const url = new URL(normalized)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

export function voiceProxyTokensMatch(actual: string | null, expected: string): boolean {
  if (!actual) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function readAccessToken(urlString: string): string | null {
  return new URL(urlString, 'http://127.0.0.1').searchParams.get(ACCESS_TOKEN_QUERY)?.trim() || null
}

export function withVoiceProxyAccessToken(webSocketUrl: string, accessToken: string): string {
  const url = new URL(webSocketUrl)
  url.searchParams.set(ACCESS_TOKEN_QUERY, accessToken)
  return url.toString()
}

function buildInworldAuthorization(runtimeKey: string): string {
  return `Basic ${runtimeKey.includes(':') ? Buffer.from(runtimeKey, 'utf8').toString('base64') : runtimeKey}`
}

function normalizeCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011
}

function rejectSocket(socket: Socket, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`)
  socket.destroy()
}

async function closeServer(server: Server, browserWss: WebSocketServer): Promise<void> {
  for (const client of browserWss.clients) client.close(1001, 'App closing')
  browserWss.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
