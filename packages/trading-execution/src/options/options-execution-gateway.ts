import {
  OPTIONS_EXECUTION_COMMAND_SCHEMA_VERSION,
  OPTIONS_EXECUTION_RECORD_SCHEMA_VERSION,
  OPTIONS_ORDER_INTENT_SCHEMA_VERSION,
  OPTIONS_PROVIDER_PREVIEW_SCHEMA_VERSION,
  OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
  discordOptionsSignalSchema,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  optionsDebitReservationSchema,
  optionsEntryDecisionSchema,
  optionsEntryPolicySchema,
  optionsExecutionCommandSchema,
  optionsExecutionRecordSchema,
  optionsOrderIntentSchema,
  optionsProviderPreviewSchema,
  optionsReservationReleaseProofSchema,
  type DiscordOptionsSignal,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
  type OptionsDebitReservation,
  type OptionsEntryDecision,
  type OptionsEntryPolicy,
  type OptionsExecutionCommand,
  type OptionsExecutionRecord,
  type OptionsOrderIntent,
  type OptionsProviderPreview,
  type OptionsReservationReleaseProof,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'
import type {
  OptionsProviderAccountSnapshot,
  OptionsProviderOrder,
  OptionsProviderOrderRequest,
} from './options-provider-adapter.ts'
import { FileOptionsExecutionStore, OptionsExecutionStoreError } from './options-execution-store.ts'
import {
  FileOptionsDebitReservationStore,
  type OptionsReservationAccountTransaction,
} from './options-reservation-store.ts'

export type OptionsExecutionAdapter = import('./options-provider-adapter.ts').OptionsProviderAdapter

export type ExecuteOptionsEntryInput = {
  signal: DiscordOptionsSignal
  contract: OptionContractIdentity
  quote: OptionQuoteSnapshot
  decision: OptionsEntryDecision
  policy: OptionsEntryPolicy
  reservation_id: string
  mandate_id: string
  mandate_checksum: string
  route_checksum: string
  account_checksum: string
}

export class OptionsExecutionGatewayError extends Error {
  constructor(
    public readonly code:
      | 'OPTIONS_EXECUTION_INTEGRITY'
      | 'OPTIONS_PREVIEW_REJECTED'
      | 'OPTIONS_PREVIEW_STALE_OR_DRIFTED'
      | 'OPTIONS_PROVIDER_DIVERGENCE'
      | 'OPTIONS_SUBMIT_UNKNOWN'
      | 'OPTIONS_ORDER_EXPIRED',
    message: string,
  ) {
    super(message)
    this.name = 'OptionsExecutionGatewayError'
  }
}

export class OptionsExecutionGateway {
  constructor(
    private readonly executions: FileOptionsExecutionStore,
    private readonly reservations: FileOptionsDebitReservationStore,
    private readonly adapter: OptionsExecutionAdapter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(input: ExecuteOptionsEntryInput): Promise<OptionsExecutionRecord> {
    const evidence = this.validateInput(input)
    const prior = await this.executions.getRecordOrNull(evidence.decision.decision_id)
    if (prior) {
      await this.assertReplayMatches(evidence, prior)
      return this.reconcile(prior.intent_id)
    }

    return this.reservations.withAccountTransaction(
      evidence.policy.account_id,
      `options-entry:${evidence.decision.decision_id}`,
      async (transaction) => {
        const existing = await this.executions.getRecordOrNull(evidence.decision.decision_id)
        if (existing) {
          await this.assertReplayMatches(evidence, existing)
          return this.reconcileLocked(existing, transaction)
        }
        return this.executeLocked(evidence, transaction)
      },
    )
  }

  async reconcile(intentId: string): Promise<OptionsExecutionRecord> {
    const record = await this.executions.getRecord(intentId)
    return this.reservations.withAccountTransaction(
      record.account_id,
      `options-reconcile:${intentId}`,
      (transaction) => this.reconcileLocked(record, transaction),
    )
  }

  async recoverNonTerminal(): Promise<number> {
    let recovered = 0
    for (const record of await this.executions.listRecords()) {
      if (record.state === 'canceled-flat' || record.state === 'not-sent') continue
      await this.reconcile(record.intent_id)
      recovered += 1
    }
    return recovered
  }

  private async executeLocked(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    transaction: OptionsReservationAccountTransaction,
  ): Promise<OptionsExecutionRecord> {
    const reservation = await transaction.get(evidence.input.reservation_id)
    this.assertReservation(evidence, reservation)
    if (await transaction.activeSetChecksum() !== reservation.active_reservation_set_checksum) {
      throw new OptionsExecutionGatewayError('OPTIONS_PREVIEW_STALE_OR_DRIFTED', 'Account reservations changed before preview.')
    }
    const admissionSnapshot = await this.adapter.snapshotAccount(reservation.account_id)
    this.assertPreflightFlat(admissionSnapshot, reservation.account_id, reservation.canonical_contract_id)
    if (sha256(admissionSnapshot) !== reservation.account_capacity_snapshot_checksum) {
      throw new OptionsExecutionGatewayError('OPTIONS_PREVIEW_STALE_OR_DRIFTED', 'Provider account truth changed after debit admission.')
    }
    this.assertQuote(await this.adapter.quote(reservation.canonical_contract_id), evidence.quote)

    const request = this.providerRequest(evidence, reservation)
    let preview: OptionsProviderPreview
    try {
      const previewResponse = await this.adapter.preview(request)
      preview = this.buildPreview(evidence, reservation, request, previewResponse)
      await this.executions.savePreview(preview)

      if (await transaction.activeSetChecksum() !== reservation.active_reservation_set_checksum) {
        throw new OptionsExecutionGatewayError('OPTIONS_PREVIEW_STALE_OR_DRIFTED', 'Account reservations changed after preview.')
      }
      const postPreviewSnapshot = await this.adapter.snapshotAccount(reservation.account_id)
      this.assertPreflightFlat(postPreviewSnapshot, reservation.account_id, reservation.canonical_contract_id)
      if (sha256(postPreviewSnapshot) !== reservation.account_capacity_snapshot_checksum) {
        throw new OptionsExecutionGatewayError('OPTIONS_PREVIEW_STALE_OR_DRIFTED', 'Provider account truth changed across preview.')
      }
      this.assertQuote(await this.adapter.quote(reservation.canonical_contract_id), evidence.quote)
      if (Date.parse(this.now()) >= Date.parse(evidence.decision.valid_until)) {
        throw new OptionsExecutionGatewayError('OPTIONS_ORDER_EXPIRED', 'The options decision expired before command persistence.')
      }
    } catch (error) {
      if (error instanceof OptionsExecutionStoreError) throw error
      const flat = await this.adapter.snapshotAccount(reservation.account_id)
      this.assertPreflightFlat(flat, reservation.account_id, reservation.canonical_contract_id)
      await transaction.release(this.releaseProof(reservation, flat, [], 'not-sent'))
      throw error
    }

    const intent = this.buildIntent(evidence, reservation, preview, request)
    const command = this.buildCommand(evidence, reservation, preview, intent, request)
    await this.executions.saveIntent(intent)
    await this.executions.saveCommand(command)
    let record = await this.executions.createRecord(this.buildRecord(command, intent, reservation))
    let reservationState = await transaction.markInitiated({
      reservation_id: reservation.reservation_id,
      expected_checksum: reservation.content_checksum,
      execution_record_checksum: record.content_checksum,
    })
    const submittedAt = this.now()
    record = await this.executions.updateRecord(record.intent_id, record.content_checksum, {
      state: 'submitting',
      submitted_at: submittedAt,
      updated_at: submittedAt,
    })
    reservationState = await transaction.updateDeliveryState({
      reservation_id: reservationState.reservation_id,
      expected_checksum: reservationState.content_checksum,
      state: 'submit-unknown',
      execution_record_checksum: record.content_checksum,
      filled_quantity: 0,
      open_quantity: 0,
    })

    try {
      const order = await this.adapter.submit(request)
      return this.applyOrderTruth(record, reservationState, order, await this.adapter.snapshotAccount(record.account_id), transaction)
    } catch (error) {
      const uncertain = await this.executions.updateRecord(record.intent_id, record.content_checksum, {
        state: 'submit-unknown',
        failure_code: 'OPTIONS_SUBMIT_UNKNOWN',
        recovery_evidence: [...record.recovery_evidence, safeError(error)],
        updated_at: this.now(),
      })
      await transaction.updateDeliveryState({
        reservation_id: reservationState.reservation_id,
        expected_checksum: reservationState.content_checksum,
        state: 'submit-unknown',
        execution_record_checksum: uncertain.content_checksum,
        filled_quantity: 0,
        open_quantity: 0,
      })
      return uncertain
    }
  }

  private async reconcileLocked(
    supplied: OptionsExecutionRecord,
    transaction: OptionsReservationAccountTransaction,
  ): Promise<OptionsExecutionRecord> {
    let record = await this.executions.getRecord(supplied.intent_id)
    if (record.state === 'canceled-flat' || record.state === 'not-sent') return record
    const command = await this.executions.getCommand(record.command_id)
    this.assertCommandRecord(command, record)
    const reservation = await transaction.get(record.reservation_id)
    const order = await this.adapter.getOrderByClientId(record.account_id, record.provider_client_order_id)
    const snapshot = await this.adapter.snapshotAccount(record.account_id)
    if (!order) {
      this.assertPreflightFlat(snapshot, record.account_id, record.canonical_contract_id)
      const timestamp = this.now()
      record = await this.executions.updateRecord(record.intent_id, record.content_checksum, {
        state: 'not-sent',
        submitted_at: record.submitted_at ?? timestamp,
        reconciled_at: timestamp,
        failure_code: null,
        recovery_evidence: [...record.recovery_evidence, 'Exact client-order lookup and account snapshot prove no provider delivery.'],
        updated_at: timestamp,
      })
      await transaction.release(this.releaseProof(
        reservation,
        snapshot,
        [],
        reservation.initiated_at === null ? 'not-sent' : 'terminal-flat',
      ))
      return record
    }
    return this.applyOrderTruth(record, reservation, order, snapshot, transaction)
  }

  private async applyOrderTruth(
    currentRecord: OptionsExecutionRecord,
    currentReservation: OptionsDebitReservation,
    order: OptionsProviderOrder,
    snapshot: OptionsProviderAccountSnapshot,
    transaction: OptionsReservationAccountTransaction,
  ): Promise<OptionsExecutionRecord> {
    const command = await this.executions.getCommand(currentRecord.command_id)
    this.assertCommandRecord(command, currentRecord)
    if (order.provider_instrument_id !== command.provider_instrument_id
      || order.action !== command.action
      || order.limit_price !== command.limit_price
      || order.quantity !== command.quantity) {
      throw new OptionsExecutionGatewayError('OPTIONS_PROVIDER_DIVERGENCE', 'Provider acknowledgment changed the frozen order economics.')
    }
    this.assertOwnedTruth(currentRecord, order, snapshot)
    const position = snapshot.positions.find((candidate) => candidate.canonical_contract_id === currentRecord.canonical_contract_id)
    const openQuantity = position?.quantity ?? 0
    const timestamp = this.now()
    const state = order.status === 'working'
      ? 'working'
      : order.status === 'partially-filled'
        ? 'partially-filled'
        : order.status === 'canceled'
          ? 'canceled-flat'
          : 'open-position'
    let record = await this.executions.updateRecord(currentRecord.intent_id, currentRecord.content_checksum, {
      state,
      provider_order_id: order.provider_order_id,
      filled_quantity: order.filled_quantity,
      open_quantity: openQuantity,
      average_fill_price: order.average_fill_price ?? null,
      reconciled_at: timestamp,
      failure_code: null,
      recovery_evidence: [...currentRecord.recovery_evidence, `Provider order ${order.provider_order_id} reconciled as ${order.status}.`],
      updated_at: timestamp,
    })
    if (state === 'canceled-flat') {
      const halted = await transaction.updateDeliveryState({
        reservation_id: currentReservation.reservation_id,
        expected_checksum: currentReservation.content_checksum,
        state: 'halted',
        execution_record_checksum: record.content_checksum,
        filled_quantity: 0,
        open_quantity: 0,
      })
      await transaction.release(this.releaseProof(halted, snapshot, [order.provider_order_id], 'terminal-flat'))
      return record
    }
    const reservationState = state === 'working' ? 'working' : state === 'partially-filled' ? 'partially-filled' : 'open-position'
    await transaction.updateDeliveryState({
      reservation_id: currentReservation.reservation_id,
      expected_checksum: currentReservation.content_checksum,
      state: reservationState,
      execution_record_checksum: record.content_checksum,
      filled_quantity: order.filled_quantity,
      open_quantity: openQuantity,
    })
    return record
  }

  private validateInput(input: ExecuteOptionsEntryInput) {
    const signal = discordOptionsSignalSchema.parse(input.signal)
    const contract = optionContractIdentitySchema.parse(input.contract)
    const quote = optionQuoteSnapshotSchema.parse(input.quote)
    const decision = optionsEntryDecisionSchema.parse(input.decision)
    const policy = optionsEntryPolicySchema.parse(input.policy)
    for (const evidence of [signal, contract, quote, decision, policy]) assertChecksum(evidence)
    if ((decision.action !== 'marketable_limit' && decision.action !== 'passive_limit')
      || decision.limit_price === undefined) {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Only an eligible bounded limit decision can execute.')
    }
    if (decision.signal_checksum !== signal.content_checksum
      || decision.contract_checksum !== contract.content_checksum
      || decision.quote_checksum !== quote.content_checksum
      || decision.policy_checksum !== policy.content_checksum
      || decision.route_checksum !== input.route_checksum
      || decision.account_checksum !== input.account_checksum
      || policy.connection_id !== quote.connection_id
      || policy.account_id !== quote.account_id
      || contract.canonical_id !== quote.canonical_contract_id
      || contract.provider_instrument_id !== quote.provider_instrument_id
      || policy.provider_slug !== contract.provider) {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Options entry evidence does not bind one exact route/account/contract.')
    }
    if (policy.adapter_id !== this.adapter.descriptor.adapter_id
      || policy.environment !== this.adapter.descriptor.environment) {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Policy does not bind the installed paper adapter.')
    }
    if (this.adapter.descriptor.adapter_id !== 'fake-options'
      || this.adapter.descriptor.provider_contract_version !== 'fake-options@1') {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'This rollout slice permits only the inert fake options provider.')
    }
    if (Date.parse(this.now()) >= Date.parse(decision.valid_until)) {
      throw new OptionsExecutionGatewayError('OPTIONS_ORDER_EXPIRED', 'The options decision already expired.')
    }
    return { input, signal, contract, quote, decision, policy }
  }

  private assertReservation(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    reservation: OptionsDebitReservation,
  ): void {
    optionsDebitReservationSchema.parse(reservation)
    if (reservation.state !== 'prepared'
      || reservation.intent_id !== evidence.decision.decision_id
      || reservation.connection_id !== evidence.policy.connection_id
      || reservation.account_id !== evidence.policy.account_id
      || reservation.source_id !== evidence.signal.signal_id
      || reservation.policy_id !== evidence.policy.policy_id
      || reservation.policy_checksum !== evidence.policy.content_checksum
      || reservation.mandate_id !== evidence.input.mandate_id
      || reservation.mandate_checksum !== evidence.input.mandate_checksum
      || reservation.canonical_contract_id !== evidence.contract.canonical_id
      || reservation.contract_checksum !== evidence.contract.content_checksum
      || reservation.reserved_contracts !== evidence.decision.planned_quantity
      || reservation.limit_price !== evidence.decision.limit_price
      || reservation.worst_case_debit !== evidence.decision.maximum_debit
      || reservation.expires_at !== evidence.decision.valid_until) {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Debit reservation does not bind the exact entry decision.')
    }
  }

  private assertPreflightFlat(snapshot: OptionsProviderAccountSnapshot, accountId: string, canonicalContractId: string): void {
    const working = snapshot.orders.filter((order) => order.status === 'working' || order.status === 'partially-filled')
    if (snapshot.account_id !== accountId || snapshot.positions.length > 0 || working.length > 0
      || snapshot.positions.some((position) => position.canonical_contract_id === canonicalContractId)) {
      throw new OptionsExecutionGatewayError('OPTIONS_PROVIDER_DIVERGENCE', 'Account has existing or unexplained option exposure.')
    }
  }

  private assertQuote(actual: OptionQuoteSnapshot, expected: OptionQuoteSnapshot): void {
    const verified = optionQuoteSnapshotSchema.parse(actual)
    assertChecksum(verified)
    if (verified.content_checksum !== expected.content_checksum) {
      throw new OptionsExecutionGatewayError('OPTIONS_PREVIEW_STALE_OR_DRIFTED', 'Quote changed across preview admission.')
    }
  }

  private assertOwnedTruth(record: OptionsExecutionRecord, order: OptionsProviderOrder, snapshot: OptionsProviderAccountSnapshot): void {
    const exactOrders = snapshot.orders.filter((candidate) => candidate.client_order_id === record.provider_client_order_id)
    if (order.account_id !== record.account_id
      || order.canonical_contract_id !== record.canonical_contract_id
      || order.client_order_id !== record.provider_client_order_id
      || snapshot.account_id !== record.account_id
      || exactOrders.length !== 1
      || exactOrders[0]!.provider_order_id !== order.provider_order_id
      || sha256(exactOrders[0]) !== sha256(order)
      || snapshot.orders.some((candidate) => (
        (candidate.status === 'working' || candidate.status === 'partially-filled')
        && candidate.client_order_id !== record.provider_client_order_id
      ))
      || snapshot.positions.some((position) => position.canonical_contract_id !== record.canonical_contract_id)) {
      throw new OptionsExecutionGatewayError('OPTIONS_PROVIDER_DIVERGENCE', 'Provider truth contains exposure outside the frozen options lineage.')
    }
    const position = snapshot.positions.find((candidate) => candidate.canonical_contract_id === record.canonical_contract_id)
    const expectedOpen = order.status === 'canceled' ? 0 : order.filled_quantity
    if ((position?.quantity ?? 0) !== expectedOpen) {
      throw new OptionsExecutionGatewayError('OPTIONS_PROVIDER_DIVERGENCE', 'Position quantity does not match the exact provider order truth.')
    }
  }

  private providerRequest(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    reservation: OptionsDebitReservation,
  ): OptionsProviderOrderRequest {
    return {
      account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id,
      provider_instrument_id: evidence.contract.provider_instrument_id,
      action: 'BUY_TO_OPEN',
      order_type: 'limit',
      limit_price: reservation.limit_price,
      quantity: reservation.reserved_contracts,
      time_in_force: 'day',
      regular_hours_only: true,
      client_order_id: `tgopt-${sha256({ intent: reservation.intent_id, account: reservation.account_id }).slice(0, 24)}`,
    }
  }

  private buildPreview(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    reservation: OptionsDebitReservation,
    request: OptionsProviderOrderRequest,
    response: Awaited<ReturnType<OptionsExecutionAdapter['preview']>>,
  ): OptionsProviderPreview {
    if (response.buying_power_impact !== reservation.worst_case_debit
      || response.estimated_fees !== reservation.estimated_fees) {
      throw new OptionsExecutionGatewayError('OPTIONS_PREVIEW_REJECTED', 'Provider preview economics differ from the reserved maximum debit.')
    }
    const timestamp = this.now()
    const requestChecksum = sha256(request)
    const unsigned = {
      preview_schema_version: OPTIONS_PROVIDER_PREVIEW_SCHEMA_VERSION,
      preview_id: `options-preview:${sha256({ request, timestamp }).slice(0, 32)}`,
      provider_request_id: `fake-preview-request:${requestChecksum.slice(0, 24)}`,
      provider_response_id: `fake-preview-response:${sha256(response).slice(0, 24)}`,
      adapter_id: this.adapter.descriptor.adapter_id,
      adapter_version: this.adapter.descriptor.adapter_version,
      provider_contract_version: this.adapter.descriptor.provider_contract_version,
      environment: this.adapter.descriptor.environment,
      credential_generation: this.adapter.descriptor.credential_generation,
      connection_id: reservation.connection_id,
      account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id,
      route_checksum: evidence.input.route_checksum,
      decision_checksum: evidence.decision.content_checksum,
      reservation_checksum: reservation.content_checksum,
      mandate_checksum: reservation.mandate_checksum,
      side: 'buy' as const,
      position_intent: 'BUY_TO_OPEN' as const,
      order_type: 'limit' as const,
      limit_price: reservation.limit_price,
      quantity: reservation.reserved_contracts,
      time_in_force: 'day' as const,
      provider_request_checksum: requestChecksum,
      ...response,
      warnings: [],
      rejects: [],
      option_permission: 'approved' as const,
      provider_timestamp: timestamp,
      received_at: timestamp,
      max_age_ms: 1_000,
      result: 'approved' as const,
    }
    return optionsProviderPreviewSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private buildIntent(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    reservation: OptionsDebitReservation,
    preview: OptionsProviderPreview,
    request: OptionsProviderOrderRequest,
  ): OptionsOrderIntent {
    const unsigned = {
      intent_schema_version: OPTIONS_ORDER_INTENT_SCHEMA_VERSION,
      intent_id: evidence.decision.decision_id,
      source_id: evidence.signal.signal_id,
      source_checksum: evidence.signal.content_checksum,
      decision_checksum: evidence.decision.content_checksum,
      connection_id: reservation.connection_id,
      account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id,
      contract_checksum: reservation.contract_checksum,
      provider_instrument_id: evidence.contract.provider_instrument_id,
      action: 'BUY_TO_OPEN' as const,
      order_type: 'limit' as const,
      limit_price: reservation.limit_price,
      quantity: reservation.reserved_contracts,
      time_in_force: 'day' as const,
      regular_hours_only: true as const,
      planned_maximum_debit: reservation.worst_case_debit,
      estimated_fees: reservation.estimated_fees,
      policy_checksum: reservation.policy_checksum,
      mandate_checksum: reservation.mandate_checksum,
      reservation_id: reservation.reservation_id,
      reservation_checksum: reservation.content_checksum,
      preview_checksum: preview.content_checksum,
      valid_until: reservation.expires_at,
      provider_client_order_id: request.client_order_id,
      idempotency_checksum: sha256(request),
      created_at: this.now(),
    }
    return optionsOrderIntentSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private buildCommand(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    reservation: OptionsDebitReservation,
    preview: OptionsProviderPreview,
    intent: OptionsOrderIntent,
    request: OptionsProviderOrderRequest,
  ): OptionsExecutionCommand {
    const descriptor = this.adapter.descriptor
    const unsigned = {
      command_schema_version: OPTIONS_EXECUTION_COMMAND_SCHEMA_VERSION,
      command_id: `options-command:${sha256({ intent: intent.content_checksum, preview: preview.content_checksum }).slice(0, 32)}`,
      intent_id: intent.intent_id,
      intent_checksum: intent.content_checksum,
      source_checksum: evidence.signal.content_checksum,
      contract_checksum: reservation.contract_checksum,
      quote_checksum: evidence.quote.content_checksum,
      decision_checksum: evidence.decision.content_checksum,
      policy_checksum: reservation.policy_checksum,
      mandate_checksum: reservation.mandate_checksum,
      reservation_id: reservation.reservation_id,
      reservation_checksum: reservation.content_checksum,
      preview_checksum: preview.content_checksum,
      adapter_id: descriptor.adapter_id,
      adapter_version: descriptor.adapter_version,
      provider_contract_version: descriptor.provider_contract_version,
      adapter_checksum: sha256(descriptor),
      credential_generation: descriptor.credential_generation,
      connection_id: reservation.connection_id,
      account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id,
      provider_instrument_id: evidence.contract.provider_instrument_id,
      action: 'BUY_TO_OPEN' as const,
      order_type: 'limit' as const,
      limit_price: reservation.limit_price,
      quantity: reservation.reserved_contracts,
      time_in_force: 'day' as const,
      regular_hours_only: true as const,
      provider_client_order_id: request.client_order_id,
      provider_request_checksum: sha256(request),
      valid_until: reservation.expires_at,
      prepared_at: this.now(),
    }
    return optionsExecutionCommandSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private buildRecord(
    command: OptionsExecutionCommand,
    intent: OptionsOrderIntent,
    reservation: OptionsDebitReservation,
  ): OptionsExecutionRecord {
    const timestamp = this.now()
    const unsigned = {
      record_schema_version: OPTIONS_EXECUTION_RECORD_SCHEMA_VERSION,
      record_id: `options-record:${sha256(command.content_checksum).slice(0, 32)}`,
      command_id: command.command_id,
      command_checksum: command.content_checksum,
      intent_id: intent.intent_id,
      intent_checksum: intent.content_checksum,
      reservation_id: reservation.reservation_id,
      reservation_checksum: reservation.content_checksum,
      connection_id: reservation.connection_id,
      account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id,
      provider_client_order_id: intent.provider_client_order_id,
      state: 'prepared' as const,
      provider_order_id: null,
      requested_quantity: intent.quantity,
      filled_quantity: 0,
      open_quantity: 0,
      average_fill_price: null,
      created_at: timestamp,
      updated_at: timestamp,
      submitted_at: null,
      reconciled_at: null,
      failure_code: null,
      recovery_evidence: [],
    }
    return optionsExecutionRecordSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private assertCommandRecord(command: OptionsExecutionCommand, record: OptionsExecutionRecord): void {
    assertChecksum(command)
    assertChecksum(record)
    if (command.content_checksum !== record.command_checksum
      || command.intent_id !== record.intent_id
      || command.intent_checksum !== record.intent_checksum
      || command.reservation_id !== record.reservation_id
      || command.reservation_checksum !== record.reservation_checksum
      || command.account_id !== record.account_id
      || command.connection_id !== record.connection_id
      || command.canonical_contract_id !== record.canonical_contract_id
      || command.provider_client_order_id !== record.provider_client_order_id
      || command.adapter_checksum !== sha256(this.adapter.descriptor)) {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Execution record does not bind the installed command and adapter.')
    }
  }

  private async assertReplayMatches(
    evidence: ReturnType<OptionsExecutionGateway['validateInput']>,
    record: OptionsExecutionRecord,
  ): Promise<void> {
    const command = await this.executions.getCommand(record.command_id)
    this.assertCommandRecord(command, record)
    if (command.decision_checksum !== evidence.decision.content_checksum
      || command.source_checksum !== evidence.signal.content_checksum
      || command.contract_checksum !== evidence.contract.content_checksum
      || command.quote_checksum !== evidence.quote.content_checksum
      || command.policy_checksum !== evidence.policy.content_checksum
      || command.mandate_checksum !== evidence.input.mandate_checksum
      || command.reservation_id !== evidence.input.reservation_id
      || command.connection_id !== evidence.policy.connection_id
      || command.account_id !== evidence.policy.account_id
      || command.canonical_contract_id !== evidence.contract.canonical_id) {
      throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Intent ID replay carries different immutable evidence.')
    }
  }

  private releaseProof(
    reservation: OptionsDebitReservation,
    snapshot: OptionsProviderAccountSnapshot,
    providerOrderIds: string[],
    deliveryState: 'not-sent' | 'terminal-flat',
  ): OptionsReservationReleaseProof {
    const unsigned = {
      proof_schema_version: OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
      proof_id: `options-release:${sha256({ reservation: reservation.content_checksum, snapshot }).slice(0, 32)}`,
      reservation_id: reservation.reservation_id,
      reservation_checksum: reservation.content_checksum,
      connection_id: reservation.connection_id,
      account_id: reservation.account_id,
      canonical_contract_id: reservation.canonical_contract_id,
      provider_snapshot_checksum: sha256(snapshot),
      provider_order_ids: [...providerOrderIds].sort(),
      open_position_quantity: 0 as const,
      working_order_count: 0 as const,
      delivery_state: deliveryState,
      proven_at: this.now(),
    }
    return optionsReservationReleaseProofSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }
}

function assertChecksum(value: { content_checksum: string }): void {
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) {
    throw new OptionsExecutionGatewayError('OPTIONS_EXECUTION_INTEGRITY', 'Options evidence checksum is invalid.')
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : 'Unknown provider submission failure'
}
