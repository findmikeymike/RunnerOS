import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_AUTOMATION_PLAN_SCHEMA_VERSION,
  OPTIONS_AUTOMATION_RECEIPT_SCHEMA_VERSION,
  OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
  optionsAutomationPlanSchema,
  optionsAutomationReceiptSchema,
  optionsReservationReleaseProofSchema,
  type OptionsAutomationPlan,
  type OptionsAutomationReceipt,
  type OptionsAutopilotAuthority,
  type OptionsAutomationRoute,
  type OptionsConnection,
  type DiscordOptionsSignal,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
  type OptionsEntryDecision,
  type OptionsEntryPolicy,
  type OptionsExecutionRecord,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { decideOptionsEntry } from './entry-policy.ts'
import { parseDiscordOptionsEntry, type DiscordOptionsEntryInput } from './discord-options-parser.ts'
import type { ExecuteOptionsEntryInput, OptionsExecutionGateway } from './options-execution-gateway.ts'
import type { FileOptionsAutomationStore } from './options-automation-store.ts'
import type { FileOptionsAutopilotAuthorityStore } from './options-autopilot-authority.ts'
import type { OptionsProviderAdapter } from './options-provider-adapter.ts'
import type { FileOptionsDebitReservationStore } from './options-reservation-store.ts'
import { FixedDecimal } from './fixed-decimal.ts'

export class FileOptionsAutomationReceiptStore {
  private readonly directory: string
  constructor(root: string) { this.directory = path.join(root, 'options-automation', 'receipts') }

  async getByMessage(input: Pick<DiscordOptionsEntryInput, 'guild_id' | 'channel_id' | 'message_id'>): Promise<OptionsAutomationReceipt | undefined> {
    try {
      return verifyReceipt(JSON.parse(await readFile(this.file(input), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async save(input: OptionsAutomationReceipt): Promise<OptionsAutomationReceipt> {
    const receipt = verifyReceipt(input)
    await mkdir(this.directory, { recursive: true })
    try {
      await writeFile(this.file(receipt), `${canonicalJson(receipt)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.getByMessage(receipt)
      if (!existing || existing.content_checksum !== receipt.content_checksum) throw new Error('Options automation receipt identity already has different evidence.')
      return existing
    }
    return receipt
  }

  async update(receiptId: string, expectedChecksum: string, changes: Partial<OptionsAutomationReceipt>): Promise<OptionsAutomationReceipt> {
    const current = (await this.list()).find((receipt) => receipt.receipt_id === receiptId)
    if (!current || current.content_checksum !== expectedChecksum) throw new Error('Options automation receipt changed before update.')
    const body = { ...current, ...changes, receipt_id: current.receipt_id, content_checksum: undefined }
    delete (body as { content_checksum?: string }).content_checksum
    const next = optionsAutomationReceiptSchema.parse({ ...body, content_checksum: sha256(body) })
    const target = this.file(current)
    const temporary = `${target}.${sha256(next.content_checksum).slice(0, 12)}.tmp`
    await writeFile(temporary, `${canonicalJson(next)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    const reloaded = verifyReceipt(JSON.parse(await readFile(target, 'utf8')))
    if (reloaded.content_checksum !== expectedChecksum) throw new Error('Options automation receipt changed during update.')
    await rename(temporary, target)
    return next
  }

  async list(): Promise<OptionsAutomationReceipt[]> {
    let names: string[]
    try { names = await readdir(this.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.filter((name) => name.endsWith('.json')).sort().map(async (name) => {
      const receipt = verifyReceipt(JSON.parse(await readFile(path.join(this.directory, name), 'utf8')))
      if (path.basename(this.file(receipt)) !== name) throw new Error('Options automation receipt file identity is invalid.')
      return receipt
    }))
  }

  private file(input: Pick<DiscordOptionsEntryInput, 'guild_id' | 'channel_id' | 'message_id'>): string {
    return path.join(this.directory, `${sha256({ guild: input.guild_id, channel: input.channel_id, message: input.message_id })}.json`)
  }
}

export class FileOptionsAutomationPlanStore {
  private readonly directory: string
  constructor(root: string) { this.directory = path.join(root, 'options-automation', 'plans') }

  async getByMessage(input: Pick<DiscordOptionsEntryInput, 'guild_id' | 'channel_id' | 'message_id'>): Promise<OptionsAutomationPlan | undefined> {
    try {
      return verifyPlan(JSON.parse(await readFile(this.file(input), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async save(input: OptionsAutomationPlan): Promise<OptionsAutomationPlan> {
    const plan = verifyPlan(input)
    await mkdir(this.directory, { recursive: true })
    try {
      await writeFile(this.file(plan.signal.provenance), `${canonicalJson(plan)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.getByMessage(plan.signal.provenance)
      if (!existing || existing.content_checksum !== plan.content_checksum) throw new Error('Options automation plan identity already has different evidence.')
      return existing
    }
    return plan
  }

  async list(): Promise<OptionsAutomationPlan[]> {
    let names: string[]
    try { names = await readdir(this.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.filter((name) => name.endsWith('.json')).sort().map(async (name) => {
      const plan = verifyPlan(JSON.parse(await readFile(path.join(this.directory, name), 'utf8')))
      if (path.basename(this.file(plan.signal.provenance)) !== name) throw new Error('Options automation plan file identity is invalid.')
      return plan
    }))
  }

  private file(input: Pick<DiscordOptionsEntryInput, 'guild_id' | 'channel_id' | 'message_id'>): string {
    return path.join(this.directory, `${sha256({ guild: input.guild_id, channel: input.channel_id, message: input.message_id })}.json`)
  }
}

export class OptionsAutomaticEntryCoordinator {
  private static readonly messageQueues = new Map<string, Promise<void>>()
  constructor(private readonly options: {
    automation: Pick<FileOptionsAutomationStore, 'resolve' | 'getPolicy'>
    authorities: Pick<FileOptionsAutopilotAuthorityStore, 'getActive'>
    receipts: FileOptionsAutomationReceiptStore
    plans: FileOptionsAutomationPlanStore
    resolveExecution(connection: OptionsConnection): Promise<{
      gateway: Pick<OptionsExecutionGateway, 'execute'>
      adapter: OptionsProviderAdapter
      reservations: FileOptionsDebitReservationStore
    }>
    resolveConnection(connectionId: string): Promise<OptionsConnection>
    now?: () => string
  }) {}

  async ingest(input: DiscordOptionsEntryInput): Promise<OptionsAutomationReceipt> {
    const key = sha256({ guild: input.guild_id, channel: input.channel_id, message: input.message_id })
    const previous = OptionsAutomaticEntryCoordinator.messageQueues.get(key) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => turn)
    OptionsAutomaticEntryCoordinator.messageQueues.set(key, queued)
    await previous
    try {
      return await this.ingestUnlocked(input)
    } finally {
      release()
      if (OptionsAutomaticEntryCoordinator.messageQueues.get(key) === queued) {
        OptionsAutomaticEntryCoordinator.messageQueues.delete(key)
      }
    }
  }

  private async ingestUnlocked(input: DiscordOptionsEntryInput): Promise<OptionsAutomationReceipt> {
    const now = this.options.now ?? (() => new Date().toISOString())
    const existing = await this.options.receipts.getByMessage(input)
    const existingPlan = await this.options.plans.getByMessage(input)
    const rawChecksum = createHash('sha256').update(input.raw_text).digest('hex')
    if (existing) {
      if (existing.raw_content_checksum !== rawChecksum || existing.author_id !== input.author_id
        || existing.thread_id !== input.thread_id || existing.posted_at !== input.posted_at) {
        throw new Error('Discord options message was replayed with different immutable evidence.')
      }
      if (existing.state === 'prepared') {
        if (!existingPlan) throw new Error('Prepared options automation receipt is missing its frozen plan.')
        return this.resume(existingPlan, existing, now())
      }
      return existing
    }
    if (existingPlan) {
      if (existingPlan.raw_content_checksum !== rawChecksum || existingPlan.signal.provenance.author_id !== input.author_id
        || existingPlan.signal.provenance.thread_id !== input.thread_id || existingPlan.signal.provenance.posted_at !== input.posted_at) {
        throw new Error('Discord options message was replayed with different immutable evidence.')
      }
      const restored = await this.options.receipts.save(this.preparedReceipt(input, now(), rawChecksum, existingPlan))
      return this.resume(existingPlan, restored, now())
    }
    const parsed = parseDiscordOptionsEntry(input)
    if (parsed.status !== 'parsed') {
      return this.options.receipts.save(this.baseReceipt(input, now(), rawChecksum, {
        state: 'blocked', reason_codes: [parsed.code], detail: parsed.detail,
      }))
    }
    const route = await this.options.automation.resolve(parsed.signal.provenance)
    if (!route) return this.options.receipts.save(this.baseReceipt(input, now(), rawChecksum, {
      signal_checksum: parsed.signal.content_checksum, state: 'blocked', reason_codes: ['OPTIONS_ROUTE_MISSING'],
      detail: 'No exact options account route is assigned to this Discord trader and channel.',
    }))
    const policy = await this.options.automation.getPolicy(route.policy_id, route.policy_revision)
    const connection = await this.options.resolveConnection(route.connection_id)
    const authority = await this.options.authorities.getActive(route, policy, connection, now())
    if (!authority) return this.options.receipts.save(this.baseReceipt(input, now(), rawChecksum, {
      signal_checksum: parsed.signal.content_checksum, route_id: route.route_id, route_checksum: route.content_checksum,
      connection_id: route.connection_id, policy_checksum: policy.content_checksum, state: 'blocked',
      reason_codes: ['OPTIONS_AUTOPILOT_LOCKED'], detail: 'This exact Discord route is not certified and activated for automatic paper orders.',
    }))
    this.assertExactAuthority(route, policy, connection, authority)
    const { adapter, reservations } = await this.options.resolveExecution(connection)
    const contract = await adapter.resolveContract({ underlying: parsed.signal.underlying, expiration: parsed.signal.expiration,
      strike: parsed.signal.strike, right: parsed.signal.right })
    const quote = await adapter.quote(contract.canonical_id)
    let decision = decideOptionsEntry({ signal: parsed.signal, contract, quote, policy, route_checksum: route.content_checksum,
      account_checksum: connection.content_checksum, decision_at: quote.decision_at, estimated_fee_per_contract: '0' })
    if (decision.action === 'marketable_limit' || decision.action === 'passive_limit') {
      const preview = await adapter.preview({
        account_id: connection.account_ref, canonical_contract_id: contract.canonical_id,
        provider_instrument_id: contract.provider_instrument_id, action: 'BUY_TO_OPEN', order_type: 'limit',
        limit_price: decision.limit_price!, quantity: decision.planned_quantity, time_in_force: 'day', regular_hours_only: true,
        client_order_id: `options-fee-preview-${sha256(decision.content_checksum).slice(0, 32)}`,
      })
      const feePerContract = FixedDecimal.from(preview.estimated_fees).divideInteger(decision.planned_quantity).toCanonicalString(4)
      decision = decideOptionsEntry({ signal: parsed.signal, contract, quote, policy, route_checksum: route.content_checksum,
        account_checksum: connection.content_checksum, decision_at: quote.decision_at, estimated_fee_per_contract: feePerContract })
    }
    if (decision.action !== 'marketable_limit' && decision.action !== 'passive_limit') {
      return this.options.receipts.save(this.baseReceipt(input, now(), rawChecksum, {
        signal_checksum: parsed.signal.content_checksum, route_id: route.route_id, route_checksum: route.content_checksum,
        connection_id: connection.connection_id, policy_checksum: policy.content_checksum,
        authority_checksum: authority.content_checksum, decision_checksum: decision.content_checksum,
        state: decision.action === 'skip' ? 'skipped' : 'blocked', reason_codes: decision.reason_codes,
        detail: decision.action === 'skip' ? 'The signal was valid but did not pass your price and liquidity rules.' : 'The signal was blocked by exact safety rules.',
      }))
    }
    const snapshot = await adapter.snapshotAccount(connection.account_ref)
    const reservationId = `options-reservation:${sha256({ decision: decision.content_checksum, authority: authority.content_checksum }).slice(0, 32)}`
    const reservation = await reservations.admit({
      reservation_id: reservationId, intent_id: decision.decision_id, connection_id: connection.connection_id,
      account_id: connection.account_ref, source_id: parsed.signal.signal_id, policy_id: policy.policy_id,
      policy_checksum: policy.content_checksum, mandate_id: authority.authority_id, mandate_checksum: authority.content_checksum,
      canonical_contract_id: contract.canonical_id, contract_checksum: contract.content_checksum,
      reserved_contracts: decision.planned_quantity, limit_price: decision.limit_price!, multiplier: 100,
      estimated_fees: subtractDebitFee(decision.maximum_debit, decision.limit_price!, decision.planned_quantity),
      worst_case_debit: decision.maximum_debit, account_capacity_snapshot_checksum: sha256(snapshot), expires_at: decision.valid_until,
    }, { max_aggregate_open_debit: policy.max_aggregate_open_debit, max_daily_debit_initiated: policy.max_daily_debit_initiated,
      max_open_positions: policy.max_open_positions })
    const receiptId = this.receiptId(input)
    const planBody = {
      plan_schema_version: OPTIONS_AUTOMATION_PLAN_SCHEMA_VERSION, plan_id: receiptId, receipt_id: receiptId,
      raw_content_checksum: rawChecksum, signal: parsed.signal, route, connection, policy, authority, contract, quote,
      decision, reservation, created_at: now(),
    }
    const plan = optionsAutomationPlanSchema.parse({ ...planBody, content_checksum: sha256(planBody) })
    await this.options.plans.save(plan)
    const receipt = await this.options.receipts.save(this.preparedReceipt(input, now(), rawChecksum, plan))
    return this.resume(plan, receipt, now())
  }

  async recoverPending(): Promise<OptionsAutomationReceipt[]> {
    const recovered: OptionsAutomationReceipt[] = []
    for (const receipt of await this.options.receipts.list()) {
      if (receipt.state !== 'prepared') continue
      const plan = (await this.options.plans.list()).find((candidate) => candidate.receipt_id === receipt.receipt_id)
      if (!plan) throw new Error(`Prepared options automation receipt ${receipt.receipt_id} is missing its frozen plan.`)
      recovered.push(await this.resume(plan, receipt, (this.options.now ?? (() => new Date().toISOString()))()))
    }
    return recovered
  }

  private preparedReceipt(input: DiscordOptionsEntryInput, createdAt: string, rawChecksum: string,
    plan: OptionsAutomationPlan): OptionsAutomationReceipt {
    return this.baseReceipt(input, createdAt, rawChecksum, {
      signal_checksum: plan.signal.content_checksum, route_id: plan.route.route_id, route_checksum: plan.route.content_checksum,
      connection_id: plan.connection.connection_id, policy_checksum: plan.policy.content_checksum,
      authority_checksum: plan.authority.content_checksum, decision_checksum: plan.decision.content_checksum,
      reservation_id: plan.reservation.reservation_id, state: 'prepared', reason_codes: ['ELIGIBLE'],
      detail: 'The exact paper order passed all configured rules and is ready for gateway delivery.',
    })
  }

  private async resume(plan: OptionsAutomationPlan, receipt: OptionsAutomationReceipt, updatedAt: string): Promise<OptionsAutomationReceipt> {
    const authority = await this.options.authorities.getActive(plan.route, plan.policy, plan.connection, updatedAt)
    if (!authority || authority.content_checksum !== plan.authority.content_checksum) {
      await this.releasePreparedReservation(plan)
      return this.options.receipts.update(receipt.receipt_id, receipt.content_checksum, {
        state: 'halted', reason_codes: ['OPTIONS_AUTOPILOT_LOCKED'],
        detail: 'Automatic paper authority changed before gateway delivery. No new order was sent.', updated_at: updatedAt,
      })
    }
    const { gateway } = await this.options.resolveExecution(plan.connection)
    const execution = await gateway.execute(this.executionInput(plan.signal, plan.route, plan.connection,
      plan.policy, plan.authority, plan.contract, plan.quote, plan.decision, plan.reservation.reservation_id))
    return this.options.receipts.update(receipt.receipt_id, receipt.content_checksum, {
      execution_intent_id: execution.intent_id, state: receiptState(execution), reason_codes: ['GATEWAY_RECONCILED'],
      detail: execution.state === 'open-position' ? 'The exact paper position is open and tracked.' : 'The exact paper order is tracked by the gateway.',
      updated_at: updatedAt,
    })
  }

  private executionInput(signal: DiscordOptionsSignal, route: OptionsAutomationRoute,
    connection: OptionsConnection, policy: OptionsEntryPolicy, authority: OptionsAutopilotAuthority,
    contract: OptionContractIdentity, quote: OptionQuoteSnapshot,
    decision: OptionsEntryDecision, reservationId: string): ExecuteOptionsEntryInput {
    return { signal, contract, quote, policy, decision, reservation_id: reservationId,
      mandate_id: authority.authority_id, mandate_checksum: authority.content_checksum,
      route_checksum: route.content_checksum, account_checksum: connection.content_checksum,
      autopilot_authority: authority, automation_route: route }
  }

  private async releasePreparedReservation(plan: OptionsAutomationPlan): Promise<void> {
    const { adapter, reservations } = await this.options.resolveExecution(plan.connection)
    const snapshot = await adapter.snapshotAccount(plan.connection.account_ref)
    if (snapshot.account_id !== plan.connection.account_ref || snapshot.positions.length > 0 || snapshot.orders.length > 0) {
      throw new Error('Automatic authority changed, but exact flat provider truth was unavailable; debit capacity remains contained.')
    }
    const current = await reservations.get(plan.reservation.reservation_id)
    if (current.state === 'released') return
    if (current.state !== 'prepared' || current.content_checksum !== plan.reservation.content_checksum) {
      throw new Error('Automatic authority changed after provider delivery began; debit capacity remains contained.')
    }
    const provenAt = (this.options.now ?? (() => new Date().toISOString()))()
    const body = {
      proof_schema_version: OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
      proof_id: `options-release:${sha256({ reservation: current.content_checksum, snapshot }).slice(0, 32)}`,
      reservation_id: current.reservation_id, reservation_checksum: current.content_checksum,
      connection_id: current.connection_id, account_id: current.account_id,
      canonical_contract_id: current.canonical_contract_id, provider_snapshot_checksum: sha256(snapshot),
      provider_order_ids: [], open_position_quantity: 0 as const, working_order_count: 0 as const,
      delivery_state: 'not-sent' as const, proven_at: provenAt,
    }
    await reservations.release(optionsReservationReleaseProofSchema.parse({ ...body, content_checksum: sha256(body) }))
  }

  private assertExactAuthority(route: OptionsAutomationRoute, policy: OptionsEntryPolicy, connection: OptionsConnection, authority: OptionsAutopilotAuthority): void {
    if (authority.route_checksum !== route.content_checksum || authority.policy_checksum !== policy.content_checksum
      || authority.connection_checksum !== connection.content_checksum || authority.credential_generation !== connection.credential_generation) {
      throw new Error('Active options authority drifted from its exact route, policy, or account.')
    }
  }

  private baseReceipt(input: DiscordOptionsEntryInput, createdAt: string, rawChecksum: string,
    changes: Partial<OptionsAutomationReceipt>): OptionsAutomationReceipt {
    const body = {
      receipt_schema_version: OPTIONS_AUTOMATION_RECEIPT_SCHEMA_VERSION,
      receipt_id: this.receiptId(input),
      guild_id: input.guild_id, channel_id: input.channel_id, thread_id: input.thread_id, message_id: input.message_id,
      author_id: input.author_id, raw_content_checksum: rawChecksum, signal_checksum: null, route_id: null, route_checksum: null,
      connection_id: null, policy_checksum: null, authority_checksum: null, decision_checksum: null,
      reservation_id: null, execution_intent_id: null, state: 'blocked' as const, reason_codes: ['OPTIONS_SIGNAL_INCOMPLETE'],
      detail: 'The options signal was not actionable.', posted_at: input.posted_at, received_at: input.received_at,
      created_at: createdAt, updated_at: createdAt, ...changes,
    }
    return optionsAutomationReceiptSchema.parse({ ...body, content_checksum: sha256(body) })
  }

  private receiptId(input: Pick<DiscordOptionsEntryInput, 'guild_id' | 'channel_id' | 'message_id'>): string {
    return `options-automation:${sha256({ guild: input.guild_id, channel: input.channel_id, message: input.message_id }).slice(0, 32)}`
  }
}

const verifyReceipt = (input: unknown): OptionsAutomationReceipt => {
  const receipt = optionsAutomationReceiptSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = receipt
  if (sha256(unsigned) !== receipt.content_checksum) throw new Error('Options automation receipt checksum is invalid.')
  return receipt
}

const verifyPlan = (input: unknown): OptionsAutomationPlan => {
  const plan = optionsAutomationPlanSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = plan
  if (sha256(unsigned) !== plan.content_checksum) throw new Error('Options automation plan checksum is invalid.')
  return plan
}

const receiptState = (record: OptionsExecutionRecord): OptionsAutomationReceipt['state'] => record.state === 'open-position'
  ? 'active' : record.state === 'canceled-flat' || record.state === 'closed-flat' || record.state === 'not-sent'
    ? 'flat' : record.state === 'halted' || record.state === 'submit-unknown' ? 'halted' : 'working'

function subtractDebitFee(maximumDebit: string, limitPrice: string, quantity: number): string {
  const fee = FixedDecimal.from(maximumDebit).subtract(FixedDecimal.from(limitPrice).multiplyInteger(100 * quantity))
  if (fee.compare('0') < 0) throw new Error('Options decision fee economics are invalid.')
  return fee.toCanonicalString(2)
}
