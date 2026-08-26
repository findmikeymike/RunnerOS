import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
  type OptionsCertificationEvidence,
  type OptionsCertificationScenario,
  type OptionsConnection,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'
import {
  FileOptionsCertificationStore,
  runRestrictedOptionsCertification,
  type OptionsCertificationScenarioObservation,
  type RestrictedOptionsCertificationRunner,
} from './options-certification.ts'
import type {
  OptionsProviderAccountSnapshot,
  OptionsProviderAdapter,
  OptionsProviderOrder,
  OptionsProviderOrderRequest,
} from './options-provider-adapter.ts'

const MAX_SESSION_MS = 15 * 60 * 1000
const MAX_POLL_ATTEMPTS = 20

export type StartProviderOptionsCertificationInput = {
  connection: OptionsConnection
  max_test_debit: string
  expires_at: string
  contract: { underlying: string; expiration: string; strike: string; right: 'call' | 'put' }
  operator_confirmed: true
}

type JournalEvent = {
  journal_schema_version: 'options-certification-journal-event@1'
  session_id: string
  sequence: number
  connection_id: string
  scenario: OptionsCertificationScenario | 'session'
  phase: 'started' | 'prepared' | 'provider-observed' | 'mutation-requested' | 'mutation-observed' | 'completed' | 'failed'
  safe_payload: Record<string, unknown>
  previous_event_checksum: string | null
  observed_at: string
  content_checksum: string
}

export class FileOptionsCertificationJournal {
  private readonly directory: string

  constructor(root: string, private readonly sessionId: string, private readonly connectionId: string) {
    this.directory = path.join(root, 'options-certification-sessions', sessionId)
  }

  get session_id(): string { return this.sessionId }

  async headChecksum(): Promise<string> {
    const events = await this.list()
    const head = events.at(-1)?.content_checksum
    if (!head) throw new Error('Options certification journal is empty.')
    return head
  }

  async append(
    scenario: JournalEvent['scenario'],
    phase: JournalEvent['phase'],
    safePayload: Record<string, unknown>,
    observedAt: string,
  ): Promise<JournalEvent> {
    const events = await this.list()
    const unsigned = {
      journal_schema_version: 'options-certification-journal-event@1' as const,
      session_id: this.sessionId,
      sequence: events.length + 1,
      connection_id: this.connectionId,
      scenario,
      phase,
      safe_payload: safePayload,
      previous_event_checksum: events.at(-1)?.content_checksum ?? null,
      observed_at: observedAt,
    }
    const event = { ...unsigned, content_checksum: sha256(unsigned) }
    await mkdir(this.directory, { recursive: true })
    await writeFile(path.join(this.directory, `${String(event.sequence).padStart(4, '0')}.json`), `${canonicalJson(event)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    })
    return event
  }

  async list(): Promise<JournalEvent[]> {
    let names: string[]
    try { names = (await readdir(this.directory)).filter((name) => /^\d{4}\.json$/.test(name)).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const events: JournalEvent[] = []
    for (const [index, name] of names.entries()) {
      const value = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as JournalEvent
      const { content_checksum: checksum, ...unsigned } = value
      if (value.journal_schema_version !== 'options-certification-journal-event@1'
        || value.session_id !== this.sessionId
        || value.connection_id !== this.connectionId
        || value.sequence !== index + 1
        || name !== `${String(value.sequence).padStart(4, '0')}.json`
        || value.previous_event_checksum !== (events.at(-1)?.content_checksum ?? null)
        || sha256(unsigned) !== checksum) {
        throw new Error('Options certification journal integrity is invalid.')
      }
      events.push(value)
    }
    return events
  }
}

export class FileProviderOptionsCertificationCoordinator {
  private readonly locksDirectory: string
  private readonly evidenceStore: FileOptionsCertificationStore

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly pollDelay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.locksDirectory = path.join(root, 'options-certification-locks')
    this.evidenceStore = new FileOptionsCertificationStore(root)
  }

  async run(input: StartProviderOptionsCertificationInput, adapter: OptionsProviderAdapter): Promise<OptionsCertificationEvidence> {
    if (input.operator_confirmed !== true) throw new Error('Provider paper certification requires explicit operator confirmation.')
    const startedAt = this.now()
    const expiresAtMs = Date.parse(input.expires_at)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.parse(startedAt)
      || expiresAtMs - Date.parse(startedAt) > MAX_SESSION_MS) {
      throw new Error('Provider paper certification must use a future session no longer than 15 minutes.')
    }
    assertAdapterConnection(input.connection, adapter)
    assertContractDate(input.contract.expiration, startedAt)
    const sessionId = `options-cert-session-${randomUUID()}`
    const clientOrderPrefix = `tgcert-${randomUUID().replaceAll('-', '').slice(0, 12)}`
    return this.withConnectionLock(input.connection.connection_id, async () => {
      const journal = new FileOptionsCertificationJournal(this.root, sessionId, input.connection.connection_id)
      await journal.append('session', 'started', {
        connection_checksum: input.connection.content_checksum,
        credential_generation: input.connection.credential_generation,
        adapter_id: adapter.descriptor.adapter_id,
        adapter_version: adapter.descriptor.adapter_version,
        provider_contract_version: adapter.descriptor.provider_contract_version,
        max_test_debit: input.max_test_debit,
        expires_at: input.expires_at,
        contract_query_checksum: sha256(input.contract),
        client_order_prefix: clientOrderPrefix,
      }, startedAt)
      const runner = new ProviderRestrictedOptionsCertificationRunner({
        connection: input.connection,
        adapter,
        contractQuery: input.contract,
        clientOrderPrefix,
        journal,
        now: this.now,
        pollDelay: this.pollDelay,
      })
      let evidence: OptionsCertificationEvidence
      try {
        evidence = await runRestrictedOptionsCertification({
          connection: input.connection,
          max_test_debit: input.max_test_debit,
          expires_at: input.expires_at,
        }, runner, this.now)
        await journal.append('session', 'completed', {
          certification_id: evidence.certification_id,
          certification_checksum: evidence.content_checksum,
          eligible_level: evidence.eligible_level,
          final_position_quantity: evidence.final_position_quantity,
          final_working_order_count: evidence.final_working_order_count,
        }, this.now())
      } catch (error) {
        await journal.append('session', 'failed', { error: safeError(error) }, this.now()).catch(() => undefined)
        throw error
      }
      return this.evidenceStore.save(evidence)
    })
  }

  async recoverIncompleteSessions(
    connection: OptionsConnection,
    adapter: OptionsProviderAdapter,
    singleInstanceAuthority: boolean,
  ): Promise<number> {
    if (!singleInstanceAuthority) throw new Error('Certification recovery requires desktop single-instance authority.')
    assertAdapterConnection(connection, adapter)
    await mkdir(this.locksDirectory, { recursive: true })
    await unlink(path.join(this.locksDirectory, `${connection.connection_id}.lock`)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    const sessionsDirectory = path.join(this.root, 'options-certification-sessions')
    let sessionIds: string[]
    try { sessionIds = (await readdir(sessionsDirectory)).filter((name) => name.startsWith('options-cert-session-')).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let recovered = 0
    for (const sessionId of sessionIds) {
      const firstFile = path.join(sessionsDirectory, sessionId, '0001.json')
      let first: Record<string, unknown>
      try { first = record(JSON.parse(await readFile(firstFile, 'utf8'))) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (first.connection_id !== connection.connection_id) continue
      const journal = new FileOptionsCertificationJournal(this.root, sessionId, connection.connection_id)
      const events = await journal.list()
      if (events.length === 0) continue
      const terminal = events.some((event) => event.scenario === 'session' && (event.phase === 'completed' || event.phase === 'failed'))
      if (terminal) continue
      await this.withConnectionLock(connection.connection_id, () => this.recoverJournal(journal, events, connection, adapter))
      recovered += 1
    }
    return recovered
  }

  private async recoverJournal(
    journal: FileOptionsCertificationJournal,
    events: JournalEvent[],
    connection: OptionsConnection,
    adapter: OptionsProviderAdapter,
  ): Promise<void> {
    const started = events[0]
    const prefix = typeof started?.safe_payload.client_order_prefix === 'string' ? started.safe_payload.client_order_prefix : undefined
    if (!prefix || !/^tgcert-[a-z0-9-]{1,16}$/.test(prefix)) throw new Error('Interrupted certification has no valid reserved client-order prefix.')
    const requests = events.flatMap((event) => {
      const request = record(event.safe_payload.request)
      return event.phase === 'mutation-requested' && isProviderRequest(request) ? [request] : []
    })
    const unique = [...new Map(requests.map((request) => [request.client_order_id, request])).values()]
    for (const request of unique) {
      const order = await adapter.getOrderByClientId(connection.account_ref, request.client_order_id)
      if (!order) continue
      await journal.append('session', 'provider-observed', { recovery_order: order }, this.now())
      if (order.status === 'working' || order.status === 'partially-filled') {
        await journal.append('session', 'mutation-requested', {
          operation: 'recovery-cancel', provider_order_id: order.provider_order_id, client_order_id: order.client_order_id,
        }, this.now())
        const canceled = await adapter.cancelOrder(connection.account_ref, order.provider_order_id, order.client_order_id)
        await journal.append('session', 'mutation-observed', { recovery_canceled_order: canceled }, this.now())
      }
    }
    let snapshot = await adapter.snapshotAccount(connection.account_ref)
    await journal.append('session', 'provider-observed', { recovery_snapshot: snapshot }, this.now())
    if (snapshot.positions.length > 0) {
      if (snapshot.positions.length !== 1 || snapshot.positions[0]!.quantity !== 1) {
        throw new Error('Interrupted certification exposure is not one exact recoverable long option position.')
      }
      const original = unique.find((request) => request.canonical_contract_id === snapshot.positions[0]!.canonical_contract_id)
      if (!original) throw new Error('Interrupted certification position has no immutable requested contract lineage.')
      const quote = await adapter.quote(original.canonical_contract_id)
      const closeRequest: OptionsProviderOrderRequest = {
        ...original,
        action: 'SELL_TO_CLOSE',
        limit_price: quote.bid,
        client_order_id: `${prefix}-recovery`,
      }
      await journal.append('session', 'mutation-requested', { request: closeRequest, operation: 'recovery-close' }, this.now())
      let close = await adapter.submit(closeRequest)
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && (close.status === 'working' || close.status === 'partially-filled'); attempt += 1) {
        await this.pollDelay(250)
        close = await adapter.getOrderByClientId(connection.account_ref, close.client_order_id) ?? close
      }
      await journal.append('session', 'mutation-observed', { recovery_close_order: close }, this.now())
      if (close.status !== 'filled' || close.filled_quantity !== 1) throw new Error('Interrupted certification close could not be proven filled.')
      snapshot = await adapter.snapshotAccount(connection.account_ref)
    }
    assertFlat(snapshot)
    await journal.append('session', 'failed', { recovered_flat: true, reason: 'interrupted-session-contained' }, this.now())
  }

  private async withConnectionLock<T>(connectionId: string, task: () => Promise<T>): Promise<T> {
    await mkdir(this.locksDirectory, { recursive: true })
    const lock = path.join(this.locksDirectory, `${connectionId}.lock`)
    try {
      await writeFile(lock, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A provider certification session is already active for this account.')
      throw error
    }
    try { return await task() } finally { await unlink(lock).catch(() => undefined) }
  }
}

class ProviderRestrictedOptionsCertificationRunner implements RestrictedOptionsCertificationRunner {
  readonly certification_session_id: string
  readonly connection_id: string
  readonly account_ref: string
  readonly provider: 'ibkr' | 'webull'
  readonly environment: 'paper' | 'sandbox'
  readonly adapter_id: string
  readonly adapter_version: string
  readonly provider_contract_version: string
  readonly client_order_prefix: string
  allowed_contract_id = 'unresolved'
  allowed_provider_instrument_id = 'unresolved'

  private contract?: OptionContractIdentity
  private quoteSnapshot?: OptionQuoteSnapshot
  private passiveRequest?: OptionsProviderOrderRequest
  private passiveOrder?: OptionsProviderOrder
  private entryOrder?: OptionsProviderOrder
  private closeOrder?: OptionsProviderOrder
  private mutationCount = 0
  private halted = false

  constructor(private readonly options: {
    connection: OptionsConnection
    adapter: OptionsProviderAdapter
    contractQuery: StartProviderOptionsCertificationInput['contract']
    clientOrderPrefix: string
    journal: FileOptionsCertificationJournal
    now: () => string
    pollDelay: (ms: number) => Promise<void>
  }) {
    this.connection_id = options.connection.connection_id
    this.certification_session_id = options.journal.session_id
    this.account_ref = options.connection.account_ref
    this.provider = options.connection.provider
    this.environment = options.connection.environment
    this.adapter_id = options.connection.adapter_id
    this.adapter_version = options.connection.adapter_version
    this.provider_contract_version = options.connection.provider_contract_version
    this.client_order_prefix = options.clientOrderPrefix
  }

  async runScenario(
    scenario: OptionsCertificationScenario,
    scope: { max_test_debit: string; expires_at: string },
  ): Promise<OptionsCertificationScenarioObservation> {
    if (this.halted) return this.observation(scenario, 'blocked', 'Certification stopped after an earlier provider uncertainty.', { halted: true })
    try {
      switch (scenario) {
        case 'exact-account-environment': {
          const snapshot = await this.snapshot(scenario)
          assertFlat(snapshot)
          return this.observation(scenario, 'pass', 'Exact paper account is flat with no working option orders.', snapshot)
        }
        case 'exact-standard-contract': {
          this.contract = optionContractIdentitySchema.parse(await this.options.adapter.resolveContract(this.options.contractQuery))
          if (this.contract.provider !== this.provider || !this.contract.standard_deliverable || this.contract.multiplier !== 100) {
            throw new Error('Resolved option contract is outside the exact standard provider scope.')
          }
          this.allowed_contract_id = this.contract.canonical_id
          this.allowed_provider_instrument_id = this.contract.provider_instrument_id
          return this.observation(scenario, 'pass', 'One exact standard option contract resolved.', this.contract)
        }
        case 'fresh-realtime-option-quote': {
          this.quoteSnapshot = await this.quote(scenario)
          return this.observation(scenario, 'pass', 'Realtime option bid, ask, size, and timestamp are proven.', this.quoteSnapshot)
        }
        case 'bounded-preview': {
          this.passiveRequest = this.request('passive', 'BUY_TO_OPEN', this.contractOrThrow().minimum_tick)
          const preview = await this.options.adapter.preview(this.passiveRequest)
          assertDebitBound(preview.buying_power_impact, scope.max_test_debit)
          await this.options.journal.append(scenario, 'provider-observed', { request: this.passiveRequest, preview }, this.options.now())
          return this.observation(scenario, 'pass', 'Provider preview stays inside the operator test debit.', { request: this.passiveRequest, preview })
        }
        case 'one-contract-limit-entry': {
          const request = this.passiveRequest ?? this.request('passive', 'BUY_TO_OPEN', this.contractOrThrow().minimum_tick)
          this.assertEntryWindow(scope.expires_at)
          await this.mutationRequested(scenario, request)
          this.passiveOrder = await this.options.adapter.submit(request)
          this.mutationCount += 1
          await this.mutationObserved(scenario, this.passiveOrder)
          if (this.passiveOrder.status !== 'working' || this.passiveOrder.filled_quantity !== 0) {
            throw new Error('Passive certification order did not remain an unfilled working order.')
          }
          return this.observation(scenario, 'pass', 'One bounded one-contract paper limit order is working.', this.passiveOrder)
        }
        case 'duplicate-submit-suppressed': {
          if (!this.passiveRequest || !this.passiveOrder) throw new Error('No exact prior certification order exists.')
          const duplicate = await this.options.adapter.submit(this.passiveRequest)
          if (duplicate.provider_order_id !== this.passiveOrder.provider_order_id || sha256(duplicate) !== sha256(this.passiveOrder)) {
            throw new Error('Duplicate client-order delivery did not resolve to exact prior truth.')
          }
          const snapshot = await this.snapshot(scenario)
          const matches = snapshot.orders.filter((item) => item.client_order_id === this.passiveRequest!.client_order_id)
          if (matches.length !== 1) throw new Error('Duplicate suppression did not leave one exact provider order.')
          return this.observation(scenario, 'pass', 'Duplicate delivery resolved to one exact provider order.', { order: duplicate, snapshot })
        }
        case 'cancel-working-order-proved': {
          if (!this.passiveOrder) throw new Error('No working certification order exists to cancel.')
          await this.options.journal.append(scenario, 'mutation-requested', {
            operation: 'cancel', provider_order_id: this.passiveOrder.provider_order_id, client_order_id: this.passiveOrder.client_order_id,
          }, this.options.now())
          const canceled = await this.options.adapter.cancelOrder(this.account_ref, this.passiveOrder.provider_order_id, this.passiveOrder.client_order_id)
          this.mutationCount += 1
          await this.mutationObserved(scenario, canceled)
          const snapshot = await this.snapshot(scenario)
          if (canceled.status !== 'canceled' || canceled.filled_quantity !== 0 || activeOrders(snapshot).length !== 0 || snapshot.positions.length !== 0) {
            throw new Error('Working-order cancellation did not prove exact flat provider truth.')
          }
          return this.observation(scenario, 'pass', 'Working entry was canceled and exact account truth is flat.', { canceled, snapshot })
        }
        case 'full-close-no-short-proved':
          return this.runFullCloseScenario(scenario, scope)
        case 'restart-reconciliation-proved': {
          const persisted = await this.options.journal.list()
          const observedOrders = persisted.flatMap((event) => {
            const order = record(event.safe_payload.order)
            return event.phase === 'mutation-observed' && isProviderOrder(order) ? [order] : []
          })
          const persistedEntry = observedOrders.find((order) => order.client_order_id === `${this.client_order_prefix}-entry`)
          const persistedClose = observedOrders.find((order) => order.client_order_id === `${this.client_order_prefix}-close`)
          if (!persistedEntry || !persistedClose) throw new Error('Completed entry and close lineage are unavailable from the durable journal.')
          const [entry, close, snapshot] = await Promise.all([
            this.options.adapter.getOrderByClientId(this.account_ref, persistedEntry.client_order_id),
            this.options.adapter.getOrderByClientId(this.account_ref, persistedClose.client_order_id),
            this.snapshot(scenario),
          ])
          if (!entry || !close || entry.provider_order_id !== persistedEntry.provider_order_id
            || close.provider_order_id !== persistedClose.provider_order_id) throw new Error('Restart lookup lost exact provider order lineage.')
          assertFlat(snapshot)
          return this.observation(scenario, 'pass', 'Exact client-order lineage survives a fresh provider lookup.', { entry, close, snapshot })
        }
        case 'unknown-submit-contained':
          return this.runUnknownSubmitScenario(scenario, scope)
        case 'final-flat-zero-orders': {
          const snapshot = await this.snapshot(scenario)
          assertFlat(snapshot)
          return this.observation(scenario, 'pass', 'Certification ends flat with zero working option orders.', snapshot)
        }
      }
    } catch (error) {
      this.halted = true
      await this.options.journal.append(scenario, 'failed', { error: safeError(error) }, this.options.now()).catch(() => undefined)
      throw error
    }
  }

  async finalTruth(): Promise<{ position_quantity: number; working_order_count: number; mutation_count: number; evidence: unknown }> {
    const snapshot = await this.options.adapter.snapshotAccount(this.account_ref)
    return {
      position_quantity: snapshot.positions.reduce((sum, item) => sum + Math.abs(item.quantity), 0),
      working_order_count: activeOrders(snapshot).length,
      mutation_count: this.mutationCount,
      evidence: snapshot,
    }
  }

  journalHeadChecksum(): Promise<string> { return this.options.journal.headChecksum() }

  private async runFullCloseScenario(
    scenario: OptionsCertificationScenario,
    scope: { max_test_debit: string; expires_at: string },
  ): Promise<OptionsCertificationScenarioObservation> {
    const quote = await this.quote(scenario)
    const entryRequest = this.request('entry', 'BUY_TO_OPEN', quote.ask)
    const preview = await this.options.adapter.preview(entryRequest)
    assertDebitBound(preview.buying_power_impact, scope.max_test_debit)
    this.assertEntryWindow(scope.expires_at)
    await this.mutationRequested(scenario, entryRequest)
    this.entryOrder = await this.options.adapter.submit(entryRequest)
    this.mutationCount += 1
    this.entryOrder = await this.waitForTerminal(this.entryOrder)
    await this.mutationObserved(scenario, this.entryOrder)
    if (this.entryOrder.status !== 'filled' || this.entryOrder.filled_quantity !== 1) {
      if (this.entryOrder.status === 'working') {
        await this.options.adapter.cancelOrder(this.account_ref, this.entryOrder.provider_order_id, this.entryOrder.client_order_id)
        this.mutationCount += 1
      }
      throw new Error('Marketable paper entry did not fill exactly one contract; certification stopped.')
    }
    const preClose = await this.snapshot(scenario)
    const position = preClose.positions.find((item) => item.canonical_contract_id === this.contractOrThrow().canonical_id)
    if (preClose.positions.length !== 1 || position?.quantity !== 1 || activeOrders(preClose).length !== 0) {
      throw new Error('Filled certification entry does not map to one exact unencumbered long position.')
    }
    const exitQuote = await this.quote(scenario)
    const closeRequest = this.request('close', 'SELL_TO_CLOSE', exitQuote.bid)
    await this.mutationRequested(scenario, closeRequest)
    this.closeOrder = await this.options.adapter.submit(closeRequest)
    this.mutationCount += 1
    this.closeOrder = await this.waitForTerminal(this.closeOrder)
    await this.mutationObserved(scenario, this.closeOrder)
    if (this.closeOrder.status !== 'filled' || this.closeOrder.filled_quantity !== 1) {
      throw new Error('Paper sell-to-close outcome is not exact; account remains halted for operator recovery.')
    }
    const final = await this.snapshot(scenario)
    assertFlat(final)
    return this.observation(scenario, 'pass', 'One paper contract filled, sold to close, and ended flat without short exposure.', {
      entry: this.entryOrder, close: this.closeOrder, final,
    })
  }

  private async runUnknownSubmitScenario(
    scenario: OptionsCertificationScenario,
    scope: { max_test_debit: string; expires_at: string },
  ): Promise<OptionsCertificationScenarioObservation> {
    const request = this.request('unknown', 'BUY_TO_OPEN', this.contractOrThrow().minimum_tick)
    const preview = await this.options.adapter.preview(request)
    assertDebitBound(preview.buying_power_impact, scope.max_test_debit)
    this.assertEntryWindow(scope.expires_at)
    await this.mutationRequested(scenario, request)
    // The adapter stops immediately after provider acceptance and before normal
    // order readback. Recovery must proceed only from the reserved client ID.
    await this.options.adapter.submitCertificationUnknown(request)
    this.mutationCount += 1
    const adopted = await this.options.adapter.getOrderByClientId(this.account_ref, request.client_order_id)
    if (!adopted || adopted.status !== 'working' || adopted.filled_quantity !== 0) {
      throw new Error('Unknown-submit recovery could not adopt one exact unfilled provider order.')
    }
    await this.mutationObserved(scenario, adopted)
    const canceled = await this.options.adapter.cancelOrder(this.account_ref, adopted.provider_order_id, adopted.client_order_id)
    this.mutationCount += 1
    const snapshot = await this.snapshot(scenario)
    if (canceled.status !== 'canceled') throw new Error('Recovered unknown-submit order was not proven canceled.')
    assertFlat(snapshot)
    await this.mutationObserved(scenario, canceled)
    return this.observation(scenario, 'pass', 'Lost submit response was adopted by client ID and canceled without a resend.', { adopted, canceled, snapshot })
  }

  private async waitForTerminal(order: OptionsProviderOrder): Promise<OptionsProviderOrder> {
    let current = order
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && (current.status === 'working' || current.status === 'partially-filled'); attempt += 1) {
      await this.options.pollDelay(250)
      current = await this.options.adapter.getOrderByClientId(this.account_ref, order.client_order_id) ?? current
    }
    return current
  }

  private request(suffix: string, action: OptionsProviderOrderRequest['action'], limitPrice: string): OptionsProviderOrderRequest {
    const contract = this.contractOrThrow()
    return {
      account_id: this.account_ref,
      canonical_contract_id: contract.canonical_id,
      provider_instrument_id: contract.provider_instrument_id,
      action,
      order_type: 'limit',
      limit_price: limitPrice,
      quantity: 1,
      time_in_force: 'day',
      regular_hours_only: true,
      client_order_id: `${this.client_order_prefix}-${suffix}`,
    }
  }

  private async quote(scenario: OptionsCertificationScenario): Promise<OptionQuoteSnapshot> {
    const quote = optionQuoteSnapshotSchema.parse(await this.options.adapter.quote(this.contractOrThrow().canonical_id))
    if (quote.connection_id !== this.connection_id || quote.account_id !== this.account_ref
      || quote.environment !== this.environment || quote.delayed || quote.indicative || quote.halted
      || quote.market_data_mode !== 'realtime' || quote.bid_size <= 0 || quote.ask_size <= 0
      || quote.quote_age_ms > 1_000
      || Math.abs(Date.parse(this.options.now()) - Date.parse(quote.provider_timestamp)) > 1_000) {
      throw new Error('Option quote does not prove exact realtime tradable paper evidence.')
    }
    await this.options.journal.append(scenario, 'provider-observed', { quote }, this.options.now())
    return quote
  }

  private async snapshot(scenario: OptionsCertificationScenario): Promise<OptionsProviderAccountSnapshot> {
    const snapshot = await this.options.adapter.snapshotAccount(this.account_ref)
    if (snapshot.account_id !== this.account_ref) throw new Error('Provider snapshot does not match the exact certification account.')
    await this.options.journal.append(scenario, 'provider-observed', { snapshot }, this.options.now())
    return snapshot
  }

  private async mutationRequested(scenario: OptionsCertificationScenario, request: OptionsProviderOrderRequest): Promise<void> {
    await this.options.journal.append(scenario, 'mutation-requested', { request }, this.options.now())
  }

  private async mutationObserved(scenario: OptionsCertificationScenario, order: OptionsProviderOrder): Promise<void> {
    await this.options.journal.append(scenario, 'mutation-observed', { order }, this.options.now())
  }

  private async observation(
    scenario: OptionsCertificationScenario,
    status: OptionsCertificationScenarioObservation['status'],
    detail: string,
    evidence: unknown,
  ): Promise<OptionsCertificationScenarioObservation> {
    await this.options.journal.append(scenario, status === 'pass' ? 'completed' : 'failed', { detail, evidence_checksum: sha256(evidence) }, this.options.now())
    return { status, detail, evidence }
  }

  private contractOrThrow(): OptionContractIdentity {
    if (!this.contract) throw new Error('Exact option contract has not been resolved.')
    return this.contract
  }

  private assertEntryWindow(expiresAt: string): void {
    if (Date.parse(this.options.now()) >= Date.parse(expiresAt)) {
      throw new Error('Certification session expired before a new provider entry mutation.')
    }
  }
}

const assertAdapterConnection = (connection: OptionsConnection, adapter: OptionsProviderAdapter): void => {
  if (connection.state !== 'read-only-verified' || !connection.read_only || connection.execution_enabled
    || connection.adapter_id !== adapter.descriptor.adapter_id
    || connection.adapter_version !== adapter.descriptor.adapter_version
    || connection.provider_contract_version !== adapter.descriptor.provider_contract_version
    || connection.environment !== adapter.descriptor.environment
    || connection.credential_generation !== adapter.descriptor.credential_generation
    || (connection.provider === 'ibkr' && adapter.descriptor.adapter_id !== 'ibkr-options-api')
    || (connection.provider === 'webull' && adapter.descriptor.adapter_id !== 'webull-options-api')) {
    throw new Error('Certification adapter does not bind the exact verified read-only account.')
  }
}

const assertContractDate = (expiration: string, now: string): void => {
  const today = now.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration) || expiration <= today) {
    throw new Error('Certification requires an option with at least one full day to expiration.')
  }
}
const activeOrders = (snapshot: OptionsProviderAccountSnapshot): OptionsProviderOrder[] => snapshot.orders.filter((order) => order.status === 'working' || order.status === 'partially-filled')
const assertFlat = (snapshot: OptionsProviderAccountSnapshot): void => {
  if (snapshot.positions.length !== 0 || activeOrders(snapshot).length !== 0) throw new Error('Certification account is not flat with zero working option orders.')
}
const assertDebitBound = (actual: string, maximum: string): void => {
  if (FixedDecimal.from(actual).compare('0') <= 0 || FixedDecimal.from(actual).compare(maximum) > 0) {
    throw new Error('Provider preview exceeds the certification debit limit.')
  }
}
const safeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 300)
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const isProviderRequest = (value: Record<string, unknown>): value is OptionsProviderOrderRequest => (
  typeof value.account_id === 'string' && typeof value.canonical_contract_id === 'string'
  && typeof value.provider_instrument_id === 'string' && (value.action === 'BUY_TO_OPEN' || value.action === 'SELL_TO_CLOSE')
  && value.order_type === 'limit' && typeof value.limit_price === 'string' && value.quantity === 1
  && value.time_in_force === 'day' && value.regular_hours_only === true && typeof value.client_order_id === 'string'
)
const isProviderOrder = (value: Record<string, unknown>): value is OptionsProviderOrder => (
  isProviderRequest(value) && 'provider_order_id' in value && typeof value.provider_order_id === 'string'
  && 'status' in value && typeof value.status === 'string'
  && 'filled_quantity' in value && typeof value.filled_quantity === 'number'
)
