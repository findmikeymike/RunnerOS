import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  TRADE_ALERT_SCHEMA_VERSION,
  tradeAlertSchema,
  tradingViewAlertPayloadSchema,
  type TradeAlert,
  type TradeAlertDirection,
  type TradingViewAlertPayload,
} from '@trade-god/contracts'

const MAX_ALERTS = 500
const ALERTS_FILE = 'alerts.json'
const TOKEN_FILE = 'tradingview-webhook-token'

const safeIdentifier = (value: string, fallback: string): string => {
  const normalized = value.trim().replace(/[^A-Za-z0-9._:@/-]/g, '-').slice(0, 160)
  return /^[A-Za-z0-9]/.test(normalized) ? normalized : fallback
}

const canonicalPrice = (value: string | number | undefined): string | undefined => {
  if (value === undefined) return undefined
  const raw = typeof value === 'number'
    ? (Number.isFinite(value) ? value.toFixed(10).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1') : '')
    : value.trim().replace(/,/g, '')
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) ? raw : undefined
}

const normalizeOccurredAt = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(value)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const normalizeDirection = (action: string | undefined): TradeAlertDirection => {
  const normalized = action?.trim().toLowerCase() ?? ''
  if (['buy', 'long', 'bull', 'bullish'].includes(normalized)) return 'long'
  if (['sell', 'short', 'bear', 'bearish'].includes(normalized)) return 'short'
  if (['flat', 'close', 'exit'].includes(normalized)) return 'flat'
  return 'none'
}

export const normalizeTradingViewAlert = (
  input: TradingViewAlertPayload,
  receivedAt: string,
): TradeAlert => {
  const symbol = safeIdentifier(input.ticker ?? input.symbol ?? '', 'UNKNOWN')
  const sourceRef = input.alert_id ? safeIdentifier(input.alert_id, 'tradingview-alert') : undefined
  const direction = normalizeDirection(input.action)
  const occurredAt = normalizeOccurredAt(input.time ?? input.timestamp)
  const title = (
    input.title
    ?? input.message
    ?? `${symbol}${direction === 'none' ? ' alert' : ` ${direction} alert`}`
  ).trim().slice(0, 240)
  const message = input.message?.trim().slice(0, 2_000)
  const identity = JSON.stringify({
    sourceRef,
    symbol,
    action: input.action,
    title,
    message,
    occurredAt,
    price: input.price,
    interval: input.interval,
  })
  const id = `tv-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`

  return tradeAlertSchema.parse({
    schema_version: TRADE_ALERT_SCHEMA_VERSION,
    id,
    source: 'tradingview',
    ...(sourceRef ? { source_ref: sourceRef } : {}),
    received_at: receivedAt,
    ...(occurredAt ? { occurred_at: occurredAt } : {}),
    symbol,
    title,
    ...(message && message !== title ? { message } : {}),
    severity: input.severity ?? 'watch',
    direction,
    status: 'new',
    ...(canonicalPrice(input.price) ? { price: canonicalPrice(input.price) } : {}),
    ...(input.exchange ? { exchange: safeIdentifier(input.exchange, 'UNKNOWN') } : {}),
    ...(input.interval ? { interval: input.interval.trim().slice(0, 40) } : {}),
  })
}

export class TradeAlertLedger {
  private alerts: TradeAlert[] | null = null
  private mutation = Promise.resolve()
  private readonly listeners = new Set<(alert: TradeAlert) => void>()

  constructor(
    private readonly directory: string,
    private readonly now: () => string,
  ) {}

  async list(limit = 50): Promise<TradeAlert[]> {
    await this.ensureLoaded()
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
    return [...(this.alerts ?? [])].slice(-safeLimit).reverse()
  }

  async ingestTradingView(
    rawInput: unknown,
  ): Promise<{ alert: TradeAlert; created: boolean }> {
    const payload = tradingViewAlertPayloadSchema.parse(rawInput)
    const alert = normalizeTradingViewAlert(payload, this.now())
    return this.withMutation(async () => {
      await this.ensureLoaded()
      const existing = this.alerts?.find((entry) => entry.id === alert.id)
      if (existing) return { alert: existing, created: false }

      this.alerts = [...(this.alerts ?? []), alert].slice(-MAX_ALERTS)
      await this.persist()
      for (const listener of this.listeners) listener(alert)
      return { alert, created: true }
    })
  }

  async acknowledge(alertId: string): Promise<TradeAlert | null> {
    return this.withMutation(async () => {
      await this.ensureLoaded()
      const index = this.alerts?.findIndex((entry) => entry.id === alertId) ?? -1
      if (index < 0 || !this.alerts) return null
      const updated = tradeAlertSchema.parse({ ...this.alerts[index], status: 'acknowledged' })
      this.alerts[index] = updated
      await this.persist()
      return updated
    })
  }

  subscribe(listener: (alert: TradeAlert) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async getOrCreateWebhookToken(): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    const tokenPath = path.join(this.directory, TOKEN_FILE)
    try {
      const existing = (await readFile(tokenPath, 'utf8')).trim()
      if (existing.length >= 32) return existing
    } catch {
      // Create a new token below.
    }
    const token = randomBytes(32).toString('hex')
    await writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    return (await readFile(tokenPath, 'utf8')).trim()
  }

  static tokenMatches(expected: string, provided: string): boolean {
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(provided)
    return expectedBuffer.length === providedBuffer.length
      && timingSafeEqual(expectedBuffer, providedBuffer)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.alerts) return
    await mkdir(this.directory, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(path.join(this.directory, ALERTS_FILE), 'utf8'))
      this.alerts = Array.isArray(parsed)
        ? parsed.flatMap((entry) => {
            const result = tradeAlertSchema.safeParse(entry)
            return result.success ? [result.data] : []
          }).slice(-MAX_ALERTS)
        : []
    } catch {
      this.alerts = []
    }
  }

  private async persist(): Promise<void> {
    const destination = path.join(this.directory, ALERTS_FILE)
    const temporary = `${destination}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.alerts ?? [], null, 2)}\n`, 'utf8')
    await rename(temporary, destination)
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }
}
