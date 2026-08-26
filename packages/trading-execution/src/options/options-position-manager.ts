import {
  OPTIONS_MANAGEMENT_COMMAND_SCHEMA_VERSION,
  OPTIONS_MANAGEMENT_RECORD_SCHEMA_VERSION,
  OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  optionsManagementCommandSchema,
  optionsManagementRecordSchema,
  optionsReservationReleaseProofSchema,
  type OptionsExecutionCommand,
  type OptionsExecutionRecord,
  type OptionsManagementCommand,
  type OptionsManagementRecord,
  type OptionsReservationReleaseProof,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'
import { FileOptionsExecutionStore } from './options-execution-store.ts'
import { FileOptionsManagementStore } from './options-management-store.ts'
import type { OptionsProviderAccountSnapshot, OptionsProviderAdapter, OptionsProviderOrder } from './options-provider-adapter.ts'
import { FileOptionsDebitReservationStore, type OptionsReservationAccountTransaction } from './options-reservation-store.ts'

type ManagementReason = 'operator' | 'signal-no-fill' | 'signal-exit' | 'expiration-custody'

export class OptionsPositionManager {
  constructor(
    private readonly executions: FileOptionsExecutionStore,
    private readonly management: FileOptionsManagementStore,
    private readonly reservations: FileOptionsDebitReservationStore,
    private readonly adapter: OptionsProviderAdapter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async cancelWorkingEntry(input: { intent_id: string; request_id: string; reason: ManagementReason }): Promise<OptionsManagementRecord> {
    const entry = await this.executions.getRecord(input.intent_id)
    return this.reservations.withAccountTransaction(entry.account_id, `options-cancel:${input.request_id}`, async (transaction) => {
      const current = await this.executions.getRecord(input.intent_id)
      const entryCommand = await this.executions.getCommand(current.command_id)
      this.assertEntryLineage(current, entryCommand)
      const managementId = id('options-management', { request: input.request_id, intent: current.intent_id, action: 'cancel-entry' })
      const prior = await this.management.getRecordOrNull(managementId)
      if (prior) return this.reconcileLocked(prior, transaction)
      const snapshot = await this.adapter.snapshotAccount(current.account_id)
      const entryOrder = this.exactEntryOrder(current, snapshot)
      this.assertNoUnownedActiveOrders(snapshot, new Set([current.provider_client_order_id]))
      const open = this.exactOpenQuantity(current, snapshot)
      const command = this.buildCommand({
        managementId, entry: current, entryCommand, action: 'cancel-entry', reason: input.reason,
        expectedOpen: open, closeQuantity: null, limitPrice: null, providerClientOrderId: null,
      })
      await this.management.saveCommand(command)
      let record = await this.management.saveRecord(this.buildRecord(command, open))
      if (entryOrder.status !== 'working' && entryOrder.status !== 'partially-filled') {
        return this.applyCancelTruth(record, command, entryOrder, snapshot, transaction)
      }
      try {
        const canceled = await this.adapter.cancelOrder(current.account_id, entryOrder.provider_order_id, entryOrder.client_order_id)
        return this.applyCancelTruth(record, command, canceled, await this.adapter.snapshotAccount(current.account_id), transaction)
      } catch (error) {
        record = await this.management.updateRecord(record.management_id, record.content_checksum, {
          state: 'cancel-unknown', failure_code: 'OPTIONS_CANCEL_UNKNOWN',
          evidence: [...record.evidence, safeError(error)], updated_at: this.now(),
        })
        return record
      }
    })
  }

  async closePosition(input: {
    intent_id: string
    request_id: string
    reason: ManagementReason
    quantity: number | 'all'
    minimum_credit: string
  }): Promise<OptionsManagementRecord> {
    const entry = await this.executions.getRecord(input.intent_id)
    return this.reservations.withAccountTransaction(entry.account_id, `options-close:${input.request_id}`, async (transaction) => {
      const current = await this.executions.getRecord(input.intent_id)
      const entryCommand = await this.executions.getCommand(current.command_id)
      this.assertEntryLineage(current, entryCommand)
      const managementId = id('options-management', { request: input.request_id, intent: current.intent_id, action: 'close-position' })
      const prior = await this.management.getRecordOrNull(managementId)
      if (prior) return this.reconcileLocked(prior, transaction)
      const snapshot = await this.adapter.snapshotAccount(current.account_id)
      const entryOrder = this.exactEntryOrder(current, snapshot)
      if (entryOrder.status === 'working' || entryOrder.status === 'partially-filled') {
        throw new Error('Cancel and prove the working entry remainder before closing the filled position.')
      }
      this.assertNoUnownedActiveOrders(snapshot, new Set())
      const open = this.exactOpenQuantity(current, snapshot)
      if (open <= 0) throw new Error('The exact options lineage has no open long position to close.')
      const quantity = input.quantity === 'all' ? open : input.quantity
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > open) throw new Error('Close quantity must be a positive whole contract within the exact open position.')
      const contract = optionContractIdentitySchema.parse(await this.adapter.resolveContract(parseCanonicalContract(current.canonical_contract_id)))
      if (contract.canonical_id !== current.canonical_contract_id || contract.provider_instrument_id !== entryCommand.provider_instrument_id) {
        throw new Error('The provider no longer resolves the exact owned option contract.')
      }
      const quote = optionQuoteSnapshotSchema.parse(await this.adapter.quote(contract.canonical_id))
      assertChecksum(quote)
      if (quote.market_data_mode !== 'realtime' || quote.delayed || quote.indicative || quote.halted
        || Date.parse(this.now()) - Date.parse(quote.received_at) > 1_000
        || FixedDecimal.from(quote.bid).compare(input.minimum_credit) < 0
        || FixedDecimal.from(quote.bid).compare('0') <= 0) {
        throw new Error('A fresh realtime bid at or above the minimum credit is required to close.')
      }
      const providerClientOrderId = `tgopt-close-${sha256({ managementId, entry: current.content_checksum }).slice(0, 16)}`
      const command = this.buildCommand({
        managementId, entry: current, entryCommand, action: 'close-position', reason: input.reason,
        expectedOpen: open, closeQuantity: quantity, limitPrice: quote.bid, providerClientOrderId,
      })
      await this.management.saveCommand(command)
      let record = await this.management.saveRecord(this.buildRecord(command, open))
      const request = {
        account_id: current.account_id,
        canonical_contract_id: current.canonical_contract_id,
        provider_instrument_id: entryCommand.provider_instrument_id,
        action: 'SELL_TO_CLOSE' as const,
        order_type: 'limit' as const,
        limit_price: quote.bid,
        quantity,
        time_in_force: 'day' as const,
        regular_hours_only: true as const,
        client_order_id: providerClientOrderId,
      }
      try {
        const order = await this.adapter.submit(request)
        return this.applyCloseTruth(record, command, order, await this.adapter.snapshotAccount(current.account_id), transaction)
      } catch (error) {
        const adopted = await this.adapter.getOrderByClientId(current.account_id, providerClientOrderId)
        if (adopted) return this.applyCloseTruth(record, command, adopted, await this.adapter.snapshotAccount(current.account_id), transaction)
        record = await this.management.updateRecord(record.management_id, record.content_checksum, {
          state: 'close-unknown', failure_code: 'OPTIONS_CLOSE_UNKNOWN',
          evidence: [...record.evidence, safeError(error)], updated_at: this.now(),
        })
        return record
      }
    })
  }

  async reconcile(managementId: string): Promise<OptionsManagementRecord> {
    const record = await this.management.getRecord(managementId)
    return this.reservations.withAccountTransaction(record.account_id, `options-management-reconcile:${managementId}`, (transaction) => (
      this.reconcileLocked(record, transaction)
    ))
  }

  async recoverNonTerminal(): Promise<number> {
    let count = 0
    for (const record of await this.management.listRecords()) {
      if (record.state === 'entry-canceled' || record.state === 'closed-flat' || record.state === 'position-open'
        || record.state === 'close-canceled' || record.state === 'partial-close-canceled') continue
      await this.reconcile(record.management_id)
      count += 1
    }
    return count
  }

  /** Startup-only: audit every receipt because a terminal receipt may have
   * persisted before its entry ledger or debit reservation was repaired. */
  async recoverAll(): Promise<number> {
    let count = 0
    for (const record of await this.management.listRecords()) {
      await this.reconcile(record.management_id)
      count += 1
    }
    return count
  }

  private async reconcileLocked(record: OptionsManagementRecord, transaction: OptionsReservationAccountTransaction): Promise<OptionsManagementRecord> {
    const current = await this.management.getRecord(record.management_id)
    const command = await this.management.getCommand(current.command_id)
    if (command.content_checksum !== current.command_checksum || command.entry_intent_id !== current.entry_intent_id) throw new Error('Options management lineage failed integrity validation.')
    const entry = await this.executions.getRecord(command.entry_intent_id)
    const snapshot = await this.adapter.snapshotAccount(command.account_id)
    if (command.action === 'cancel-entry') {
      const order = this.exactEntryOrder(entry, snapshot)
      return this.applyCancelTruth(current, command, order, snapshot, transaction)
    }
    const order = await this.adapter.getOrderByClientId(command.account_id, command.provider_client_order_id!)
    if (!order) {
      if (current.state === 'prepared' || current.state === 'close-unknown') return current
      return this.management.updateRecord(current.management_id, current.content_checksum, {
        state: 'close-unknown', failure_code: 'OPTIONS_CLOSE_UNKNOWN', updated_at: this.now(),
        evidence: [...current.evidence, 'Exact close order is absent; no retry was sent.'],
      })
    }
    return this.applyCloseTruth(current, command, order, snapshot, transaction)
  }

  private async applyCancelTruth(record: OptionsManagementRecord, command: OptionsManagementCommand, order: OptionsProviderOrder, snapshot: OptionsProviderAccountSnapshot, transaction: OptionsReservationAccountTransaction): Promise<OptionsManagementRecord> {
    if (order.client_order_id !== command.expected_entry_order_id || order.canonical_contract_id !== command.canonical_contract_id) throw new Error('Cancel truth does not match the exact entry order.')
    if (order.status === 'working' || order.status === 'partially-filled') {
      return this.management.updateRecord(record.management_id, record.content_checksum, {
        state: 'cancel-unknown', failure_code: 'OPTIONS_CANCEL_UNKNOWN', updated_at: this.now(),
        evidence: [...record.evidence, 'Entry cancellation is not yet terminal.'],
      })
    }
    const entry = await this.executions.getRecord(command.entry_intent_id)
    const open = this.positionQuantity(snapshot, command.canonical_contract_id)
    if (snapshot.positions.some((position) => position.canonical_contract_id !== command.canonical_contract_id)
      || open !== order.filled_quantity) throw new Error('Canceled entry position does not match exact fill truth.')
    const nextEntry = await this.executions.updateRecord(entry.intent_id, entry.content_checksum, {
      state: open === 0 ? 'canceled-flat' : 'open-position',
      filled_quantity: order.filled_quantity, open_quantity: open,
      average_fill_price: order.average_fill_price ?? null,
      reconciled_at: this.now(), updated_at: this.now(), failure_code: null,
      recovery_evidence: [...entry.recovery_evidence, `Entry cancellation reconciled as ${order.status}.`],
    })
    const reservation = await transaction.get(command.reservation_id)
    if (open === 0) {
      this.assertFlatForRelease(snapshot)
      if (reservation.state !== 'released') await transaction.release(this.releaseProof(reservation, snapshot))
    } else {
      if (reservation.state === 'released') throw new Error('Released debit capacity conflicts with an open options position.')
      await transaction.updateDeliveryState({ reservation_id: reservation.reservation_id, expected_checksum: reservation.content_checksum,
        state: 'open-position', execution_record_checksum: nextEntry.content_checksum,
        filled_quantity: order.filled_quantity, open_quantity: open })
    }
    return this.management.updateRecord(record.management_id, record.content_checksum, {
      state: open === 0 ? 'entry-canceled' : 'position-open', failure_code: null,
      before_open_quantity: open, requested_close_quantity: 0, closed_quantity: 0,
      remaining_open_quantity: open, updated_at: this.now(),
      evidence: [...record.evidence, `Entry order ${order.provider_order_id} is ${order.status}.`],
    })
  }

  private async applyCloseTruth(record: OptionsManagementRecord, command: OptionsManagementCommand, order: OptionsProviderOrder, snapshot: OptionsProviderAccountSnapshot, transaction: OptionsReservationAccountTransaction): Promise<OptionsManagementRecord> {
    if (order.action !== 'SELL_TO_CLOSE' || order.client_order_id !== command.provider_client_order_id
      || order.canonical_contract_id !== command.canonical_contract_id || order.quantity !== command.close_quantity) {
      throw new Error('Provider close truth does not match the frozen management command.')
    }
    const open = this.positionQuantity(snapshot, command.canonical_contract_id)
    const expectedOpen = command.expected_open_quantity - order.filled_quantity
    if (open !== expectedOpen || open < 0 || snapshot.positions.some((position) => position.canonical_contract_id !== command.canonical_contract_id)) {
      throw new Error('Provider position no longer matches the exact close lineage.')
    }
    const active = snapshot.orders.filter(isActiveOrder)
    if (active.some((candidate) => candidate.client_order_id !== command.provider_client_order_id)) throw new Error('Unowned working options order blocks close reconciliation.')
    const state = open === 0 && active.length === 0
      ? 'closed-flat'
      : order.status === 'canceled'
        ? 'close-canceled'
        : order.status === 'partially-filled-canceled'
          ? 'partial-close-canceled'
          : order.filled_quantity > 0
            ? 'partially-closed'
            : 'close-working'
    const entry = await this.executions.getRecord(command.entry_intent_id)
    const nextEntry = await this.executions.updateRecord(entry.intent_id, entry.content_checksum, {
      state: open === 0 ? 'closed-flat' : 'open-position', open_quantity: open,
      reconciled_at: this.now(), updated_at: this.now(), failure_code: null,
      recovery_evidence: [...entry.recovery_evidence, `Management ${record.management_id} left ${open} contract(s) open.`],
    })
    const reservation = await transaction.get(command.reservation_id)
    if (state === 'closed-flat') {
      this.assertFlatForRelease(snapshot)
      if (reservation.state !== 'released') await transaction.release(this.releaseProof(reservation, snapshot))
    } else {
      if (reservation.state === 'released') throw new Error('Released debit capacity conflicts with an open options position.')
      await transaction.updateDeliveryState({ reservation_id: reservation.reservation_id, expected_checksum: reservation.content_checksum,
        state: 'open-position', execution_record_checksum: nextEntry.content_checksum,
        filled_quantity: entry.filled_quantity, open_quantity: open })
    }
    return this.management.updateRecord(record.management_id, record.content_checksum, {
      state, provider_close_order_id: order.provider_order_id, provider_client_order_id: order.client_order_id,
      closed_quantity: order.filled_quantity, remaining_open_quantity: open, failure_code: null,
      updated_at: this.now(), evidence: [...record.evidence, `Close order ${order.provider_order_id} reconciled as ${order.status}.`],
    })
  }

  private buildCommand(input: {
    managementId: string; entry: OptionsExecutionRecord; entryCommand: OptionsExecutionCommand
    action: 'cancel-entry' | 'close-position'; reason: ManagementReason; expectedOpen: number
    closeQuantity: number | null; limitPrice: string | null; providerClientOrderId: string | null
  }): OptionsManagementCommand {
    const unsigned = {
      command_schema_version: OPTIONS_MANAGEMENT_COMMAND_SCHEMA_VERSION,
      command_id: input.managementId,
      entry_intent_id: input.entry.intent_id,
      entry_record_checksum: input.entry.content_checksum,
      entry_command_checksum: input.entryCommand.content_checksum,
      reservation_id: input.entry.reservation_id,
      reservation_checksum: input.entry.reservation_checksum,
      connection_id: input.entry.connection_id,
      account_id: input.entry.account_id,
      canonical_contract_id: input.entry.canonical_contract_id,
      provider_instrument_id: input.entryCommand.provider_instrument_id,
      action: input.action, reason: input.reason,
      expected_entry_order_id: input.entry.provider_client_order_id,
      expected_open_quantity: input.expectedOpen,
      close_quantity: input.closeQuantity,
      limit_price: input.limitPrice,
      provider_client_order_id: input.providerClientOrderId,
      prepared_at: this.now(),
    }
    return optionsManagementCommandSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private buildRecord(command: OptionsManagementCommand, open: number): OptionsManagementRecord {
    const timestamp = this.now()
    const unsigned = {
      record_schema_version: OPTIONS_MANAGEMENT_RECORD_SCHEMA_VERSION,
      management_id: command.command_id, command_id: command.command_id, command_checksum: command.content_checksum,
      entry_intent_id: command.entry_intent_id, connection_id: command.connection_id,
      account_id: command.account_id, canonical_contract_id: command.canonical_contract_id,
      state: 'prepared' as const, provider_close_order_id: null,
      provider_client_order_id: command.provider_client_order_id,
      before_open_quantity: open, requested_close_quantity: command.close_quantity ?? 0,
      closed_quantity: 0, remaining_open_quantity: open, failure_code: null,
      evidence: [], created_at: timestamp, updated_at: timestamp,
    }
    return optionsManagementRecordSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private assertEntryLineage(record: OptionsExecutionRecord, command: OptionsExecutionCommand): void {
    assertChecksum(record); assertChecksum(command)
    if (record.command_id !== command.command_id || record.command_checksum !== command.content_checksum
      || record.intent_id !== command.intent_id || record.account_id !== command.account_id
      || record.canonical_contract_id !== command.canonical_contract_id
      || record.provider_order_id === null
      || record.state === 'prepared' || record.state === 'submitting' || record.state === 'submit-unknown' || record.state === 'halted') {
      throw new Error('Options entry is not exact, provider-confirmed, and manageable.')
    }
  }

  private exactEntryOrder(record: OptionsExecutionRecord, snapshot: OptionsProviderAccountSnapshot): OptionsProviderOrder {
    const matches = snapshot.orders.filter((order) => order.client_order_id === record.provider_client_order_id)
    if (snapshot.account_id !== record.account_id || matches.length !== 1
      || matches[0]!.provider_order_id !== record.provider_order_id
      || matches[0]!.canonical_contract_id !== record.canonical_contract_id
      || matches[0]!.action !== 'BUY_TO_OPEN') throw new Error('Exact entry order truth is missing or divergent.')
    return matches[0]!
  }

  private exactOpenQuantity(record: OptionsExecutionRecord, snapshot: OptionsProviderAccountSnapshot): number {
    const quantity = this.positionQuantity(snapshot, record.canonical_contract_id)
    if (quantity < 0 || snapshot.positions.some((position) => position.canonical_contract_id !== record.canonical_contract_id)) throw new Error('Account contains unowned or short option exposure.')
    return quantity
  }

  private positionQuantity(snapshot: OptionsProviderAccountSnapshot, contractId: string): number {
    const matches = snapshot.positions.filter((position) => position.canonical_contract_id === contractId)
    if (matches.length > 1) throw new Error('Provider returned duplicate option positions.')
    return matches[0]?.quantity ?? 0
  }

  private assertNoUnownedActiveOrders(snapshot: OptionsProviderAccountSnapshot, allowed: Set<string>): void {
    if (snapshot.orders.filter(isActiveOrder).some((order) => !allowed.has(order.client_order_id))) throw new Error('Account contains a working order outside this exact lineage.')
  }

  private assertFlatForRelease(snapshot: OptionsProviderAccountSnapshot): void {
    if (snapshot.positions.length > 0 || snapshot.orders.some(isActiveOrder)) throw new Error('Debit cannot release until the account is flat with zero working option orders.')
  }

  private releaseProof(reservation: Awaited<ReturnType<OptionsReservationAccountTransaction['get']>>, snapshot: OptionsProviderAccountSnapshot): OptionsReservationReleaseProof {
    const unsigned = {
      proof_schema_version: OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
      proof_id: id('options-release', { reservation: reservation.content_checksum, snapshot }),
      reservation_id: reservation.reservation_id, reservation_checksum: reservation.content_checksum,
      connection_id: reservation.connection_id, account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id, provider_snapshot_checksum: sha256(snapshot),
      provider_order_ids: snapshot.orders.map((order) => order.provider_order_id).sort(),
      open_position_quantity: 0 as const, working_order_count: 0 as const,
      delivery_state: 'terminal-flat' as const, proven_at: this.now(),
    }
    return optionsReservationReleaseProofSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }
}

const isActiveOrder = (order: OptionsProviderOrder): boolean => order.status === 'working' || order.status === 'partially-filled'
const id = (prefix: string, value: unknown): string => `${prefix}:${sha256(value).slice(0, 32)}`
const safeError = (error: unknown): string => error instanceof Error ? error.message.slice(0, 300) : 'Unknown provider error'

function assertChecksum(value: { content_checksum: string }): void {
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) throw new Error('Options evidence checksum is invalid.')
}

function parseCanonicalContract(canonicalId: string): { underlying: string; expiration: string; right: 'call' | 'put'; strike: string } {
  const match = /^USOPT:([A-Z][A-Z0-9.]{0,14}):(\d{4}-\d{2}-\d{2}):([CP]):(.+)$/.exec(canonicalId)
  if (!match) throw new Error('Canonical option contract identity is invalid.')
  return { underlying: match[1]!, expiration: match[2]!, right: match[3] === 'C' ? 'call' : 'put', strike: match[4]! }
}
