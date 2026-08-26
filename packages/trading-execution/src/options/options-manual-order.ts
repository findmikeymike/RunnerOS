import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_ENTRY_DECISION_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  OPTIONS_MANUAL_ORDER_REVIEW_SCHEMA_VERSION,
  OPTIONS_MANUAL_ORDER_SOURCE_SCHEMA_VERSION,
  optionContractIdentitySchema,
  optionsConnectionSchema,
  optionsEntryDecisionSchema,
  optionsEntryPolicySchema,
  optionsManualOrderReviewSchema,
  optionsManualOrderSourceSchema,
  optionsManualPaperAuthoritySchema,
  type OptionContractIdentity,
  type OptionsConnection,
  type OptionsEntryDecision,
  type OptionsEntryPolicy,
  type OptionsExecutionRecord,
  type OptionsManualOrderReview,
  type OptionsManualOrderSource,
  type OptionsManualPaperAuthority,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'
import { OptionsExecutionGateway, type ExecuteOptionsEntryInput } from './options-execution-gateway.ts'
import type { OptionsProviderAdapter, OptionsProviderOrderRequest } from './options-provider-adapter.ts'
import { FileOptionsDebitReservationStore } from './options-reservation-store.ts'

export type PrepareManualOptionsOrderInput = {
  connection: OptionsConnection
  authority: OptionsManualPaperAuthority
  operator_max_premium: string
  operator_confirmed: true
}

export class FileOptionsManualOrderCoordinator {
  private readonly reviewsDirectory: string

  constructor(
    root: string,
    private readonly reservations: FileOptionsDebitReservationStore,
    private readonly gateway: OptionsExecutionGateway,
    private readonly adapter: OptionsProviderAdapter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.reviewsDirectory = path.join(root, 'manual-order-reviews')
  }

  async prepare(input: PrepareManualOptionsOrderInput): Promise<OptionsManualOrderReview> {
    const connection = verifyChecksummed(optionsConnectionSchema.parse(input.connection))
    const authority = verifyChecksummed(optionsManualPaperAuthoritySchema.parse(input.authority))
    const preparedAt = this.now()
    this.assertAuthority(connection, authority, preparedAt)
    if (input.operator_confirmed !== true) throw new Error('Reviewing a paper order requires explicit operator confirmation.')

    const query = parseCanonicalContract(authority.allowed_contract_id)
    const contract = verifyChecksummed(optionContractIdentitySchema.parse(await this.adapter.resolveContract(query)))
    if (contract.canonical_id !== authority.allowed_contract_id
      || contract.provider_instrument_id !== authority.allowed_provider_instrument_id) {
      throw new Error('The broker no longer resolves the exact certified option contract.')
    }
    const quote = await this.adapter.quote(contract.canonical_id)
    const maxPremium = FixedDecimal.from(input.operator_max_premium)
    const ask = FixedDecimal.from(quote.ask)
    if (maxPremium.compare('0') <= 0 || ask.compare(maxPremium) > 0) {
      throw new Error('The live ask is above your maximum premium. No order was prepared.')
    }
    if (quote.market_data_mode !== 'realtime' || quote.delayed || quote.indicative || quote.halted
      || Date.parse(preparedAt) - Date.parse(quote.received_at) > 1_000) {
      throw new Error('A fresh realtime option quote is required before review.')
    }
    const validUntil = new Date(Math.min(
      Date.parse(authority.valid_until),
      Date.parse(preparedAt) + 30_000,
    )).toISOString()
    if (Date.parse(validUntil) <= Date.parse(preparedAt)) throw new Error('Manual paper permission expired before review.')

    const source = this.buildSource(connection, authority, contract, maxPremium, preparedAt, validUntil)
    const policy = this.buildPolicy(connection, authority, contract, preparedAt, validUntil)
    const preliminaryRequest: OptionsProviderOrderRequest = {
      account_id: connection.account_ref,
      canonical_contract_id: contract.canonical_id,
      provider_instrument_id: contract.provider_instrument_id,
      action: 'BUY_TO_OPEN', order_type: 'limit', limit_price: money(ask), quantity: 1,
      time_in_force: 'day', regular_hours_only: true,
      client_order_id: `tgopt-review-${sha256(source).slice(0, 20)}`,
    }
    const providerEstimate = await this.adapter.preview(preliminaryRequest)
    const maximumDebit = FixedDecimal.from(providerEstimate.buying_power_impact)
    if (FixedDecimal.from(providerEstimate.estimated_debit).compare(ask.multiplyInteger(100)) !== 0
      || maximumDebit.compare(ask.multiplyInteger(100).add(providerEstimate.estimated_fees)) !== 0
      || maximumDebit.compare(authority.max_debit_per_order) > 0) {
      throw new Error('The broker preview exceeds the exact manual debit permission.')
    }
    const decision = this.buildDecision(source, contract, quote, policy, connection, maxPremium, maximumDebit, preparedAt, validUntil)
    const snapshot = await this.adapter.snapshotAccount(connection.account_ref)
    const working = snapshot.orders.filter((order) => order.status === 'working' || order.status === 'partially-filled')
    if (snapshot.account_id !== connection.account_ref || snapshot.positions.length > 0 || working.length > 0) {
      throw new Error('The paper account must be flat with no working option orders before review.')
    }
    const reservationId = `options-reservation:${sha256({ decision: decision.content_checksum, authority: authority.content_checksum }).slice(0, 32)}`
    const reservation = await this.reservations.admit({
      reservation_id: reservationId,
      intent_id: decision.decision_id,
      connection_id: connection.connection_id,
      account_id: connection.account_ref,
      source_id: source.source_id,
      policy_id: policy.policy_id,
      policy_checksum: policy.content_checksum,
      mandate_id: authority.authority_id,
      mandate_checksum: authority.content_checksum,
      canonical_contract_id: contract.canonical_id,
      contract_checksum: contract.content_checksum,
      reserved_contracts: 1,
      limit_price: decision.limit_price!,
      multiplier: 100,
      estimated_fees: providerEstimate.estimated_fees,
      worst_case_debit: decision.maximum_debit,
      account_capacity_snapshot_checksum: sha256(snapshot),
      expires_at: validUntil,
    }, {
      max_aggregate_open_debit: authority.max_debit_per_order,
      max_daily_debit_initiated: authority.max_debit_per_order,
      max_open_positions: 1,
    })
    const executionInput = this.executionInput(connection, authority, source, contract, quote, policy, decision, reservation.reservation_id)
    let preview
    try {
      preview = await this.gateway.preview(executionInput)
    } catch (error) {
      await this.gateway.releasePrepared(reservation.reservation_id)
      throw error
    }
    const unsigned = {
      review_schema_version: OPTIONS_MANUAL_ORDER_REVIEW_SCHEMA_VERSION,
      review_id: `options-manual-review:${sha256({ decision: decision.content_checksum, preview: preview.content_checksum }).slice(0, 32)}`,
      source,
      connection_checksum: connection.content_checksum,
      authority_id: authority.authority_id,
      authority_checksum: authority.content_checksum,
      contract,
      quote,
      policy,
      decision,
      reservation,
      preview,
      prepared_at: preparedAt,
      expires_at: validUntil,
    }
    const review = optionsManualOrderReviewSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
    await this.writeImmutable(review)
    return review
  }

  async commit(input: {
    review_id: string
    review_checksum: string
    connection: OptionsConnection
    authority: OptionsManualPaperAuthority
    operator_confirmed: true
  }): Promise<OptionsExecutionRecord> {
    if (input.operator_confirmed !== true) throw new Error('Placing a paper order requires explicit final confirmation.')
    const review = await this.get(input.review_id)
    if (review.content_checksum !== input.review_checksum) throw new Error('The order review changed before confirmation.')
    const connection = verifyChecksummed(optionsConnectionSchema.parse(input.connection))
    const authority = verifyChecksummed(optionsManualPaperAuthoritySchema.parse(input.authority))
    this.assertAuthority(connection, authority, this.now())
    if (connection.content_checksum !== review.connection_checksum
      || authority.authority_id !== review.authority_id
      || authority.content_checksum !== review.authority_checksum
      || Date.parse(this.now()) >= Date.parse(review.expires_at)) {
      await this.gateway.releasePrepared(review.reservation.reservation_id)
      throw new Error('The order review expired or its paper permission changed. Review it again.')
    }
    const resolved = verifyChecksummed(optionContractIdentitySchema.parse(await this.adapter.resolveContract(parseCanonicalContract(review.contract.canonical_id))))
    if (!sameContractEconomics(resolved, review.contract)) {
      await this.gateway.releasePrepared(review.reservation.reservation_id)
      throw new Error('The broker contract changed after review. No order was sent.')
    }
    return this.gateway.execute(this.executionInput(
      connection, authority, review.source, review.contract, review.quote,
      review.policy, review.decision, review.reservation.reservation_id,
    ))
  }

  async cancel(reviewId: string): Promise<void> {
    const review = await this.get(reviewId)
    await this.gateway.releasePrepared(review.reservation.reservation_id)
  }

  async get(reviewId: string): Promise<OptionsManualOrderReview> {
    const file = this.file(reviewId)
    const parsed = optionsManualOrderReviewSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    return verifyChecksummed(parsed)
  }

  private executionInput(
    connection: OptionsConnection,
    authority: OptionsManualPaperAuthority,
    source: OptionsManualOrderSource,
    contract: OptionContractIdentity,
    quote: OptionsManualOrderReview['quote'],
    policy: OptionsEntryPolicy,
    decision: OptionsEntryDecision,
    reservationId: string,
  ): ExecuteOptionsEntryInput {
    return {
      signal: source, contract, quote, policy, decision, reservation_id: reservationId,
      mandate_id: authority.authority_id, mandate_checksum: authority.content_checksum,
      route_checksum: decision.route_checksum, account_checksum: connection.content_checksum,
      manual_authority: authority,
    }
  }

  private buildSource(
    connection: OptionsConnection,
    authority: OptionsManualPaperAuthority,
    contract: OptionContractIdentity,
    maxPremium: FixedDecimal,
    createdAt: string,
    validUntil: string,
  ): OptionsManualOrderSource {
    const unsigned = {
      source_schema_version: OPTIONS_MANUAL_ORDER_SOURCE_SCHEMA_VERSION,
      source_id: `options-manual-source:${sha256({ authority: authority.content_checksum, contract: contract.content_checksum, max: maxPremium.toString(), createdAt }).slice(0, 32)}`,
      source_kind: 'manual-operator' as const,
      connection_id: connection.connection_id,
      account_id: connection.account_ref,
      authority_id: authority.authority_id,
      authority_checksum: authority.content_checksum,
      canonical_contract_id: contract.canonical_id,
      operator_max_premium: money(maxPremium),
      created_at: createdAt,
      valid_until: validUntil,
    }
    return optionsManualOrderSourceSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private buildPolicy(
    connection: OptionsConnection,
    authority: OptionsManualPaperAuthority,
    contract: OptionContractIdentity,
    createdAt: string,
    validUntil: string,
  ): OptionsEntryPolicy {
    const custodySeed = sha256({ contract: contract.content_checksum, kind: 'manual-paper-custody-disabled' })
    const unsigned = {
      policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
      policy_id: `options-manual-policy:${authority.authority_id}`,
      revision: 1,
      max_signal_age_ms: 30_000, max_ingest_delay_ms: 1_000,
      regular_session_only: true as const,
      entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' as const },
      allowed_weekdays: [1, 2, 3, 4, 5], min_days_to_expiration: 1, max_days_to_expiration: 365,
      max_quote_age_ms: 1_000, min_bid_size: 0, min_ask_size: 1,
      max_spread_abs: '1000', max_spread_pct: '1000', spread_gate_mode: 'both' as const,
      max_chase_abs: '0', max_chase_pct: '0', max_favorable_retrace_pct: '100',
      tight_spread_action: 'marketable_limit' as const, wide_spread_action: 'skip' as const,
      passive_limit_offset_abs: '0', working_order_ttl_ms: 30_000,
      max_reprice_attempts: 0, reprice_interval_ms: 1_000, cancel_at_signal_expiry: true,
      sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 },
      max_contracts_per_order: 1, max_debit_per_trade: authority.max_debit_per_order,
      max_aggregate_open_debit: authority.max_debit_per_order,
      max_daily_debit_initiated: authority.max_debit_per_order,
      max_open_positions: 1 as const, max_active_positions_per_source: 1 as const,
      source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
      expiration_custody: {
        provider_calendar_checksum: custodySeed,
        account_exercise_setting_checksum: custodySeed,
        no_new_entry_minutes_before_close: 60,
        automatic_close_start_minutes_before_close: 45,
        operator_escalation_minutes_before_close: 30,
        do_not_exercise_mode: 'manual-required' as const,
        custody_certification_checksum: custodySeed,
      },
      environment: connection.environment,
      provider_slug: contract.provider,
      adapter_id: authority.adapter_id,
      required_certification: 'options-sandbox-entry-certified',
      certification_checksum: authority.certification_checksum,
      connection_id: connection.connection_id,
      account_id: connection.account_ref,
      source_route_id: `manual:${authority.authority_id}`,
      global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
      mandate_expires_at: validUntil,
      created_at: createdAt,
    }
    return optionsEntryPolicySchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private buildDecision(
    source: OptionsManualOrderSource,
    contract: OptionContractIdentity,
    quote: OptionsManualOrderReview['quote'],
    policy: OptionsEntryPolicy,
    connection: OptionsConnection,
    maxPremium: FixedDecimal,
    maximumDebit: FixedDecimal,
    decidedAt: string,
    validUntil: string,
  ): OptionsEntryDecision {
    const bid = FixedDecimal.from(quote.bid)
    const ask = FixedDecimal.from(quote.ask)
    const midpoint = bid.add(ask).divideInteger(2, 6)
    const spread = ask.subtract(bid)
    const spreadPct = midpoint.compare('0') === 0 ? FixedDecimal.from('0') : spread.multiply('100', 6).divide(midpoint, 6)
    const routeChecksum = sha256({ route: 'manual-operator', authority: source.authority_checksum })
    const unsigned = {
      decision_schema_version: OPTIONS_ENTRY_DECISION_SCHEMA_VERSION,
      decision_id: `options-manual-decision:${sha256({ source: source.content_checksum, quote: quote.content_checksum, policy: policy.content_checksum }).slice(0, 32)}`,
      signal_checksum: source.content_checksum,
      route_checksum: routeChecksum,
      account_checksum: connection.content_checksum,
      contract_checksum: contract.content_checksum,
      quote_checksum: quote.content_checksum,
      policy_checksum: policy.content_checksum,
      source_reference_price: money(maxPremium), bid: money(bid), ask: money(ask), midpoint: money(midpoint),
      spread_abs: money(spread), spread_pct: spreadPct.toString(),
      unfavorable_drift_abs: '0', unfavorable_drift_pct: '0', favorable_retrace_pct: '0',
      absolute_chase_cap: money(maxPremium), percentage_chase_cap: money(maxPremium), effective_chase_cap: money(maxPremium),
      action: 'marketable_limit' as const,
      limit_price: money(ask),
      planned_quantity: 1,
      maximum_debit: money(maximumDebit),
      reason_codes: ['MANUAL_OPERATOR_CONFIRMED'],
      decided_at: decidedAt,
      valid_until: validUntil,
    }
    return optionsEntryDecisionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  private assertAuthority(connection: OptionsConnection, authority: OptionsManualPaperAuthority, at: string): void {
    const descriptor = this.adapter.descriptor
    if (authority.connection_id !== connection.connection_id
      || authority.connection_checksum !== connection.content_checksum
      || authority.credential_generation !== connection.credential_generation
      || authority.account_ref !== connection.account_ref
      || authority.provider !== connection.provider
      || authority.environment !== connection.environment
      || authority.adapter_id !== descriptor.adapter_id
      || authority.adapter_version !== descriptor.adapter_version
      || authority.provider_contract_version !== descriptor.provider_contract_version
      || authority.credential_generation !== descriptor.credential_generation
      || Date.parse(at) < Date.parse(authority.valid_from)
      || Date.parse(at) >= Date.parse(authority.valid_until)) {
      throw new Error('Manual paper authority does not match the exact current account and adapter.')
    }
  }

  private async writeImmutable(review: OptionsManualOrderReview): Promise<void> {
    await mkdir(this.reviewsDirectory, { recursive: true })
    try {
      await writeFile(this.file(review.review_id), `${canonicalJson(review)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(review.review_id)
      if (existing.content_checksum !== review.content_checksum) throw new Error('Manual order review conflicts with retained evidence.')
    }
  }

  private file(reviewId: string): string {
    if (!reviewId || reviewId.length > 500) throw new Error('Manual order review ID is invalid.')
    return path.join(this.reviewsDirectory, `${sha256(reviewId)}.json`)
  }
}

function parseCanonicalContract(canonicalId: string): { underlying: string; expiration: string; right: 'call' | 'put'; strike: string } {
  const match = /^USOPT:([A-Z][A-Z0-9.]{0,14}):(\d{4}-\d{2}-\d{2}):([CP]):(.+)$/.exec(canonicalId)
  if (!match) throw new Error('Certified option contract identity is invalid.')
  return { underlying: match[1]!, expiration: match[2]!, right: match[3] === 'C' ? 'call' : 'put', strike: match[4]! }
}

function verifyChecksummed<T extends { content_checksum: string }>(value: T): T {
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) throw new Error('Options evidence checksum is invalid.')
  return value
}

function money(value: FixedDecimal): string {
  return value.toCanonicalString(2)
}

function sameContractEconomics(left: OptionContractIdentity, right: OptionContractIdentity): boolean {
  const withoutVolatile = (value: OptionContractIdentity) => {
    const { resolved_at: _resolvedAt, content_checksum: _checksum, ...economics } = value
    return economics
  }
  return sha256(withoutVolatile(left)) === sha256(withoutVolatile(right))
}
