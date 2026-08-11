import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION,
  ORDER_INTENT_SCHEMA_VERSION,
  discoTraderPushPayloadSchema,
  discoTraderTicketSchema,
  orderIntentSchema,
  type DiscoTraderTicket,
  type ExecutionRecord,
  type OrderIntent,
} from '@trade-god/contracts'

import { computeOrderIntentChecksum, sha256 } from '../canonical.ts'
import { ExecutionGatewayError } from '../errors.ts'

export interface DiscoTraderInstrumentRoute {
  canonical_id: string
  symbol: string
  exchange: string
  expiry?: string
  tick_size: string
  point_value_usd: string
}

export interface DiscoTraderIntentRoute {
  connection_id: string
  source_id: string
  instrument: DiscoTraderInstrumentRoute
  valid_for_ms: number
}

export interface DiscoTraderIntentSourceArtifact {
  source_schema_version: typeof DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION
  source_ticket_sha256: string
  source_ticket_id: string
  source_message_id: string
  source_author_id: string
  source_mode: DiscoTraderTicket['mode']
  deterministic_contracts: number
  deterministic_risk_usd: string
  gate_trail: string[]
  veto: NonNullable<DiscoTraderTicket['llmVeto']>
  source_ticket: DiscoTraderTicket
  intent: OrderIntent
  received_at: string
}

export interface DiscoTraderIntentRegistrar {
  registerIntent(intent: OrderIntent, traceId?: string): Promise<ExecutionRecord>
  get(intentId: string): Promise<ExecutionRecord>
}

export class FileDiscoTraderIntentSource {
  constructor(
    private readonly directory: string,
    private readonly registrar: DiscoTraderIntentRegistrar,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async ingestPush(
    input: unknown,
    route: DiscoTraderIntentRoute,
    traceId?: string,
    receivedAt: string = this.now(),
  ): Promise<{ artifact: DiscoTraderIntentSourceArtifact; record: ExecutionRecord }> {
    const payload = discoTraderPushPayloadSchema.parse(input)
    if (payload.kind !== 'ticket' || !payload.ticket) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Only a DiscoTrader ticket push can create an order intent.',
      )
    }
    const artifact = convertDiscoTraderTicket(payload.ticket, route, receivedAt)
    await this.bindTicketIdentity(artifact)
    const existing = await this.persist(artifact)
    const durableArtifact = existing ?? artifact
    return {
      artifact: durableArtifact,
      record: await this.registerOrRecover(durableArtifact, Boolean(existing), traceId),
    }
  }

  async get(intentId: string): Promise<DiscoTraderIntentSourceArtifact> {
    return parseSourceArtifact(JSON.parse(
      await readFile(this.artifactPath(intentId), 'utf8'),
    ))
  }

  private async persist(
    artifact: DiscoTraderIntentSourceArtifact,
  ): Promise<DiscoTraderIntentSourceArtifact | null> {
    await mkdir(this.directory, { recursive: true })
    const destination = this.artifactPath(artifact.intent.intent_id)
    try {
      await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const current = await this.get(artifact.intent.intent_id)
      if (current.source_ticket_sha256 !== artifact.source_ticket_sha256) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'DiscoTrader intent source artifact conflicts with an existing ticket.',
        )
      }
      return current
    }
  }

  private async bindTicketIdentity(artifact: DiscoTraderIntentSourceArtifact): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const destination = path.join(
      this.directory,
      `${hash(artifact.source_ticket_id)}.ticket-binding.json`,
    )
    const binding = {
      source_ticket_id: artifact.source_ticket_id,
      source_message_id: artifact.source_message_id,
      intent_id: artifact.intent.intent_id,
    }
    try {
      await writeFile(destination, `${JSON.stringify(binding, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const current = JSON.parse(await readFile(destination, 'utf8')) as Partial<typeof binding>
      if (
        current.source_ticket_id !== binding.source_ticket_id
        || current.source_message_id !== binding.source_message_id
        || current.intent_id !== binding.intent_id
      ) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'DiscoTrader ticket identity is already bound to another Discord source event.',
        )
      }
    }
  }

  private async registerOrRecover(
    artifact: DiscoTraderIntentSourceArtifact,
    sourceAlreadyExisted: boolean,
    traceId?: string,
  ): Promise<ExecutionRecord> {
    if (sourceAlreadyExisted) {
      try {
        return await this.registrar.get(artifact.intent.intent_id)
      } catch (error) {
        if (
          !(error instanceof ExecutionGatewayError)
          || error.code !== 'INTENT_NOT_FOUND'
        ) {
          throw error
        }
      }
    }
    return this.registrar.registerIntent(
      artifact.intent,
      traceId ?? `trace-discotrader-${artifact.source_ticket_sha256.slice(0, 24)}`,
    )
  }

  private artifactPath(intentId: string): string {
    if (!/^intent-discotrader-[a-f0-9]{32}$/.test(intentId)) {
      throw new Error('DiscoTrader intent ID is not path-safe.')
    }
    return path.join(this.directory, `${intentId}.source.json`)
  }
}

export const convertDiscoTraderPush = (
  input: unknown,
  route: DiscoTraderIntentRoute,
  receivedAt: string,
): DiscoTraderIntentSourceArtifact => {
  const payload = discoTraderPushPayloadSchema.parse(input)
  if (payload.kind !== 'ticket' || !payload.ticket) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'Only a DiscoTrader ticket push can create an order intent.',
    )
  }
  return convertDiscoTraderTicket(payload.ticket, route, receivedAt)
}

export const convertDiscoTraderTicket = (
  input: unknown,
  route: DiscoTraderIntentRoute,
  receivedAt: string,
): DiscoTraderIntentSourceArtifact => {
  const ticket = discoTraderTicketSchema.parse(input)
  if (!Number.isFinite(Date.parse(receivedAt))) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'DiscoTrader source receipt time is invalid.',
    )
  }
  assertDiscoTraderTicketCanEnterGateway(ticket, route, receivedAt)
  const tickSize = positiveDecimal(route.instrument.tick_size, 'instrument tick size')
  const validForMs = route.valid_for_ms
  if (!Number.isSafeInteger(validForMs) || validForMs <= 0 || validForMs > 5 * 60_000) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'DiscoTrader intent validity must be between 1 ms and 5 minutes.',
    )
  }
  const stopLoss = ticket.stop === undefined
    ? {
        type: 'ticks' as const,
        value: canonicalPositiveDecimal(
          exactTickCount(ticket.stopDistancePoints, tickSize),
          'stop distance',
        ),
      }
    : {
        type: 'price' as const,
        value: canonicalPositiveDecimal(ticket.stop, 'stop price'),
      }
  const target = ticket.targets[0]
  const unsigned: Omit<OrderIntent, 'content_checksum'> = {
    intent_schema_version: ORDER_INTENT_SCHEMA_VERSION,
    intent_id: `intent-discotrader-${hash({
      source_id: route.source_id,
      message_id: ticket.provenance.messageId,
      author_id: ticket.provenance.authorId,
    }).slice(0, 32)}`,
    source: {
      type: 'discord',
      source_id: route.source_id,
      author_id: ticket.provenance.authorId!,
    },
    connection_id: route.connection_id,
    instrument: {
      canonical_id: route.instrument.canonical_id,
      symbol: route.instrument.symbol,
      exchange: route.instrument.exchange,
      ...(route.instrument.expiry ? { expiry: route.instrument.expiry } : {}),
      tick_size: route.instrument.tick_size,
      point_value_usd: route.instrument.point_value_usd,
    },
    side: ticket.side === 'long' ? 'buy' : 'sell',
    quantity: ticket.contracts,
    entry: ticket.entry === undefined
      ? { type: 'market' }
      : { type: 'limit', price: canonicalPositiveDecimal(ticket.entry, 'entry price') },
    protection: {
      stop_loss: stopLoss,
      ...(target === undefined
        ? {}
        : {
            take_profit: {
              type: 'price' as const,
              value: canonicalPositiveDecimal(target, 'target price'),
            },
          }),
    },
    max_loss_usd: String(ticket.riskUsd),
    time_in_force: 'day',
    created_at: ticket.provenance.postedAt!,
    valid_until: new Date(Date.parse(ticket.provenance.postedAt!) + validForMs).toISOString(),
  }
  const intent = orderIntentSchema.parse({
    ...unsigned,
    content_checksum: computeOrderIntentChecksum(unsigned),
  })
  return {
    source_schema_version: DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION,
    source_ticket_sha256: sha256(ticket),
    source_ticket_id: ticket.id,
    source_message_id: ticket.provenance.messageId,
    source_author_id: ticket.provenance.authorId!,
    source_mode: ticket.mode,
    deterministic_contracts: ticket.contracts,
    deterministic_risk_usd: canonicalPositiveDecimal(ticket.riskUsd, 'risk USD'),
    gate_trail: ticket.gateTrail,
    veto: ticket.llmVeto!,
    source_ticket: ticket,
    intent,
    received_at: receivedAt,
  }
}

const assertDiscoTraderTicketCanEnterGateway = (
  ticket: DiscoTraderTicket,
  route: DiscoTraderIntentRoute,
  receivedAt: string,
): void => {
  if (ticket.mode === 'armed-live') {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'DiscoTrader armed-live tickets are refused because execution authority must not be duplicated.',
    )
  }
  if (ticket.mode === 'observe-only') {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'DiscoTrader observe-only tickets are not eligible for execution.',
    )
  }
  if (ticket.action.intent !== 'entry' && ticket.action.intent !== 'add') {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'DiscoTrader ticket is not a new-entry intent.',
    )
  }
  if (ticket.action.side && ticket.action.side !== ticket.side) {
    throw new ExecutionGatewayError(
      'RISK_DENIED',
      'DiscoTrader ticket direction conflicts with its parsed action.',
    )
  }
  if (!ticket.provenance.authorId) {
    throw new ExecutionGatewayError(
      'AUTHORIZATION_MISMATCH',
      'DiscoTrader ticket lacks an immutable Discord author ID.',
    )
  }
  if (!ticket.provenance.postedAt) {
    throw new ExecutionGatewayError(
      'INTENT_EXPIRED',
      'Executable DiscoTrader tickets require the immutable Discord posted timestamp.',
    )
  }
  const postedAt = Date.parse(ticket.provenance.postedAt)
  const observedAt = Date.parse(ticket.provenance.observedAt)
  const createdAt = Date.parse(ticket.createdAt)
  const receivedAtMs = Date.parse(receivedAt)
  if (
    observedAt < postedAt
    || createdAt < observedAt
    || receivedAtMs < createdAt
    // DiscoTrader records end-to-end ingest latency when it creates the ticket,
    // not the earlier Discord observation timestamp.
    || Math.abs((createdAt - postedAt) - ticket.provenance.latencyMs) > 1_000
  ) {
    throw new ExecutionGatewayError(
      'RECORD_INTEGRITY_FAILURE',
      'DiscoTrader posted, observed, created, received, and latency timestamps disagree.',
    )
  }
  if (receivedAtMs >= postedAt + route.valid_for_ms) {
    throw new ExecutionGatewayError(
      'INTENT_EXPIRED',
      'DiscoTrader source message expired before reaching the execution gateway.',
    )
  }
  if (!ticket.llmVeto || ticket.llmVeto.decision !== 'accept') {
    throw new ExecutionGatewayError(
      'RISK_DENIED',
      'DiscoTrader ticket does not carry an accepted veto result.',
    )
  }
  if (route.instrument.symbol !== ticket.tradedSymbol) {
    throw new ExecutionGatewayError(
      'ACCOUNT_MISMATCH',
      'DiscoTrader traded symbol does not match the configured gateway route.',
    )
  }
  if (ticket.targets.length > 1) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'DiscoTrader tickets with multiple targets are refused until target quantities and multi-leg protection are explicit.',
    )
  }
  if (
    ticket.entry !== undefined
    && ticket.stop !== undefined
    && (
      (ticket.side === 'long' && ticket.stop >= ticket.entry)
      || (ticket.side === 'short' && ticket.stop <= ticket.entry)
    )
  ) {
    throw new ExecutionGatewayError('RISK_DENIED', 'DiscoTrader stop is on the wrong side of entry.')
  }
  const firstTarget = ticket.targets[0]
  if (
    ticket.entry !== undefined
    && firstTarget !== undefined
    && (
      (ticket.side === 'long' && firstTarget <= ticket.entry)
      || (ticket.side === 'short' && firstTarget >= ticket.entry)
    )
  ) {
    throw new ExecutionGatewayError('RISK_DENIED', 'DiscoTrader target is on the wrong side of entry.')
  }
}

const parseSourceArtifact = (value: unknown): DiscoTraderIntentSourceArtifact => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'DiscoTrader source artifact is invalid.')
  }
  const artifact = value as DiscoTraderIntentSourceArtifact
  const intent = orderIntentSchema.parse(artifact.intent)
  const ticket = discoTraderTicketSchema.parse(artifact.source_ticket)
  if (
    artifact.source_schema_version !== DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION
    || typeof artifact.source_ticket_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(artifact.source_ticket_sha256)
    || typeof artifact.source_ticket_id !== 'string'
    || typeof artifact.source_message_id !== 'string'
    || typeof artifact.source_author_id !== 'string'
    || artifact.source_ticket_sha256 !== sha256(ticket)
    || artifact.source_ticket_id !== ticket.id
    || artifact.source_message_id !== ticket.provenance.messageId
    || artifact.source_author_id !== ticket.provenance.authorId
    || artifact.source_mode !== ticket.mode
    || artifact.deterministic_contracts !== ticket.contracts
    || artifact.deterministic_risk_usd !== canonicalPositiveDecimal(ticket.riskUsd, 'risk USD')
    || intent.quantity !== ticket.contracts
    || !Array.isArray(artifact.gate_trail)
    || JSON.stringify(artifact.gate_trail) !== JSON.stringify(ticket.gateTrail)
    || JSON.stringify(artifact.veto) !== JSON.stringify(ticket.llmVeto)
    || !Number.isFinite(Date.parse(artifact.received_at))
    || computeOrderIntentChecksum(intent) !== intent.content_checksum
  ) {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'DiscoTrader source artifact is invalid.')
  }
  return { ...artifact, source_ticket: ticket, intent }
}

const positiveDecimal = (value: string, label: string): number => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', `${label} must be a canonical decimal.`)
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', `${label} must be positive and finite.`)
  }
  return number
}

const exactTickCount = (points: number, tickSize: number): number => {
  const ticks = points / tickSize
  if (!Number.isSafeInteger(ticks) || ticks <= 0) {
    throw new ExecutionGatewayError(
      'RISK_DENIED',
      'DiscoTrader stop distance is not an exact positive instrument tick count.',
    )
  }
  return ticks
}

const canonicalPositiveDecimal = (value: number, label: string): string => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', `${label} must be positive and finite.`)
  }
  const decimal = value.toString()
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal)) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', `${label} is outside the canonical decimal range.`)
  }
  return decimal
}

const hash = (value: unknown): string => sha256(value)
