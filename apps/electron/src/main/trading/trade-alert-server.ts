import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { ZodError } from 'zod'

import type { TradeAlertIngestionStatus } from '@trade-god/contracts'

import { TradeAlertLedger } from './trade-alert-ledger.ts'
import type { TradeAlertTunnelHandle } from './trade-alert-tunnel.ts'

const WEBHOOK_PATH = '/v1/trade-god/alerts/tradingview'
const HEALTH_PATH = '/v1/health'
const MAX_BODY_BYTES = 64 * 1024
const BODY_TIMEOUT_MS = 10_000
const RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000

export interface TradeAlertServerHandle {
  url: string
  webhookUrl: string
  token: string
  stop(): Promise<void>
}

interface TradeAlertServerOptions {
  port: number
  host?: string
  ledger: TradeAlertLedger
  token?: string
  logger?: {
    info(message: string): void
    warn(message: string): void
    error(message: string, error?: unknown): void
  }
}

export async function startTradeAlertServer(
  options: TradeAlertServerOptions,
): Promise<TradeAlertServerHandle | null> {
  if (options.port < 0) return null
  const host = options.host ?? '127.0.0.1'
  const token = options.token ?? await options.ledger.getOrCreateWebhookToken()
  const logger = options.logger ?? { info: () => {}, warn: () => {}, error: () => {} }
  const authenticatedRateBuckets = new Map<string, { count: number; startedAt: number }>()
  const rejectedRateBuckets = new Map<string, { count: number; startedAt: number }>()

  const server = createServer((request, response) => {
    handleTradeAlertRequest(request, response, {
      ledger: options.ledger,
      token,
      authenticatedRateBuckets,
      rejectedRateBuckets,
    }).catch((error) => {
      logger.error('[trade-alert-server] request failed', error)
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal_error', message: 'The alert receiver failed.' },
        request_id: randomUUID(),
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  const url = `http://${host}:${port}`
  logger.info(`[trade-alert-server] Listening on ${url}`)

  return {
    url,
    webhookUrl: `${url}${WEBHOOK_PATH}`,
    token,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export const toTradeAlertIngestionStatus = (
  handle: TradeAlertServerHandle | null,
  error?: unknown,
  tunnel?: TradeAlertTunnelHandle | null,
  tunnelError?: unknown,
): TradeAlertIngestionStatus => {
  if (handle) {
    const publicRelayConnected = Boolean(tunnel?.isConnected())
    return {
      state: 'ready',
      local_url: handle.webhookUrl,
      ...(publicRelayConnected ? { public_url: tunnel!.webhookUrl } : {}),
      authentication: 'json-body-secret',
      public_relay_connected: publicRelayConnected,
      message: publicRelayConnected
        ? 'Public HTTPS receiver is ready for TradingView alerts.'
        : tunnelError
          ? `Local receiver is ready, but the public relay failed: ${formatStatusError(tunnelError)}`
          : 'Local authenticated receiver is ready. Enable the public relay for TradingView delivery.',
    }
  }
  return {
    state: error ? 'unavailable' : 'disabled',
    authentication: 'json-body-secret',
    public_relay_connected: false,
    ...(error ? { message: error instanceof Error ? error.message : String(error) } : {}),
  }
}

const formatStatusError = (error: unknown): string => (
  (error instanceof Error ? error.message : String(error)).slice(0, 360)
)

async function handleTradeAlertRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    ledger: TradeAlertLedger
    token: string
    authenticatedRateBuckets: Map<string, { count: number; startedAt: number }>
    rejectedRateBuckets: Map<string, { count: number; startedAt: number }>
  },
): Promise<void> {
  const requestId = randomUUID()
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const method = (request.method ?? 'GET').toUpperCase()

  if (url.pathname === HEALTH_PATH) {
    if (method !== 'GET') return sendError(response, 405, 'method_not_allowed', 'Use GET.', requestId)
    return sendJson(response, 200, { ok: true, data: { status: 'ok' }, request_id: requestId })
  }

  if (url.pathname !== WEBHOOK_PATH) {
    return sendError(response, 404, 'not_found', 'Alert endpoint not found.', requestId)
  }
  if (method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendError(response, 405, 'method_not_allowed', 'Use POST.', requestId)
  }
  if (!String(request.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    return sendError(response, 415, 'unsupported_media_type', 'Use application/json.', requestId)
  }

  let rawBody: string
  try {
    rawBody = await readBody(request)
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return sendError(response, 413, 'body_too_large', 'Alert payload exceeds 64 KB.', requestId)
    }
    if (error instanceof BodyTimeoutError) {
      return sendError(response, 408, 'body_timeout', 'Alert payload timed out.', requestId)
    }
    return sendError(response, 400, 'bad_request', 'Alert payload could not be read.', requestId)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return sendError(response, 400, 'invalid_json', 'Alert payload must be valid JSON.', requestId)
  }

  const providedSecret = (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).secret === 'string'
  )
    ? (payload as Record<string, string>).secret
    : ''
  const remoteIp = request.socket.remoteAddress ?? 'unknown'
  if (!TradeAlertLedger.tokenMatches(context.token, providedSecret)) {
    const remaining = consumeRateLimit(context.rejectedRateBuckets, remoteIp)
    setRateLimitHeaders(response, remaining)
    if (remaining < 0) {
      return sendError(response, 429, 'rate_limited', 'Too many rejected alerts.', requestId)
    }
    return sendError(response, 401, 'invalid_secret', 'Alert authentication failed.', requestId)
  }

  const remaining = consumeRateLimit(context.authenticatedRateBuckets, remoteIp)
  setRateLimitHeaders(response, remaining)
  if (remaining < 0) {
    return sendError(response, 429, 'rate_limited', 'Too many alerts.', requestId)
  }

  try {
    const result = await context.ledger.ingestTradingView(payload)
    return sendJson(response, result.created ? 201 : 200, {
      ok: true,
      data: {
        alert_id: result.alert.id,
        created: result.created,
      },
      request_id: requestId,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return sendError(response, 422, 'invalid_alert', 'Alert payload failed validation.', requestId)
    }
    throw error
  }
}

function consumeRateLimit(
  buckets: Map<string, { count: number; startedAt: number }>,
  key: string,
): number {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { count: 0, startedAt: now }
  if (now - bucket.startedAt >= RATE_WINDOW_MS) {
    bucket.count = 0
    bucket.startedAt = now
  }
  if (bucket.count >= RATE_LIMIT) {
    buckets.set(key, bucket)
    return -1
  }
  bucket.count += 1
  buckets.set(key, bucket)
  return RATE_LIMIT - bucket.count
}

function setRateLimitHeaders(response: ServerResponse, remaining: number): void {
  response.setHeader('X-RateLimit-Limit', String(RATE_LIMIT))
  response.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)))
}

class BodyTooLargeError extends Error {}
class BodyTimeoutError extends Error {}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new BodyTimeoutError())
    }, BODY_TIMEOUT_MS)
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      operation()
    }
    request.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        finish(() => reject(new BodyTooLargeError()))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf8'))))
    request.on('error', (error) => finish(() => reject(error)))
  })
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
): void {
  sendJson(response, status, {
    ok: false,
    error: { code, message },
    request_id: requestId,
  })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}
