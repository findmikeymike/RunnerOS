import {
  MIRROR_CHILD_RISK_PROJECTION_SCHEMA_VERSION,
  MIRROR_CHILD_SOURCE_SCHEMA_VERSION,
  MIRROR_EXECUTION_SCHEMA_VERSION,
  ORDER_INTENT_SCHEMA_VERSION,
  mirrorChildRiskProjectionSchema,
  mirrorChildSourceSchema,
  mirrorExecutionSchema,
  orderIntentSchema,
  type DiscoTraderTicket,
  type ExecutionAuthorization,
  type ExecutionRecord,
  type MirrorChildRiskProjection,
  type MirrorChildSource,
  type MirrorExecution,
  type MirrorGroup,
  type MirrorGroupMember,
  type OrderIntent,
  type SourceExecutionBinding,
  type TradingConnection,
} from '@trade-god/contracts'

import { computeOrderIntentChecksum, sha256 } from './canonical.ts'
import { ExecutionGatewayError } from './errors.ts'
import type { FileMirrorExecutionStore } from './mirror-execution-store.ts'
import { providerAccountIdentityKey } from './mirror-group-store.ts'
import { convertDiscoTraderTicket, type DiscoTraderInstrumentRoute } from './sources/discotrader-intent-source.ts'

export interface MirrorRiskPolicy {
  policy_version: string
  fees_policy_version: string
  fee_per_contract_usd: string
}

export interface MirrorChildPlan {
  source: MirrorChildSource
  intent: OrderIntent
  provider_account_key: string
  adverse_entry_bound: { kind: 'maximum-price' | 'minimum-price'; price: string }
  protection: MirrorChildRiskProjection['valuation']['protection']
  tick_value_usd: string
  risk_policy_version: string
  fees_policy_version: string
}

export interface MirrorExecutionGateway {
  registerIntent(intent: OrderIntent, traceId?: string): Promise<ExecutionRecord>
  get(intentId: string): Promise<ExecutionRecord>
  evaluateAndApprove(intentId: string, authorization: ExecutionAuthorization): Promise<ExecutionRecord>
  execute(intentId: string, mirrorDispatchGrantId?: string): Promise<ExecutionRecord>
  reconcile(intentId: string): Promise<ExecutionRecord>
  reserveMirrorOwnership(intentIds: string[]): Promise<void>
  releaseMirrorOwnership(intentIds: string[]): Promise<void>
  revalidateMirrorAdmission(intentIds: string[]): Promise<void>
}

export class MirrorExecutionCoordinator {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: {
    store: FileMirrorExecutionStore
    gateway: MirrorExecutionGateway
    resolveConnection(connectionId: string): Promise<TradingConnection>
    resolveAuthorization(connectionId: string): Promise<ExecutionAuthorization | null>
    now?: () => string
    riskPolicy: MirrorRiskPolicy
  }) {}

  coordinate(input: {
    ticket: DiscoTraderTicket
    binding: SourceExecutionBinding
    group: MirrorGroup
    instrument: DiscoTraderInstrumentRoute
    dispatch: boolean
  }): Promise<MirrorExecution> {
    return this.withLock(() => this.coordinateLocked(input))
  }

  private async coordinateLocked(input: {
    ticket: DiscoTraderTicket
    binding: SourceExecutionBinding
    group: MirrorGroup
    instrument: DiscoTraderInstrumentRoute
    dispatch: boolean
  }): Promise<MirrorExecution> {
    const now = this.options.now ?? (() => new Date().toISOString())
    if (
      input.binding.target.type !== 'mirror-group'
      || input.binding.target.mirror_group_id !== input.group.mirror_group_id
      || input.binding.target.mirror_group_revision !== input.group.revision
      || input.binding.target.group_snapshot_checksum !== input.group.content_checksum
    ) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror binding and group revision disagree.')
    }
    if (input.group.state !== 'active' || input.group.environment !== 'paper') {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Mirror orchestration is active-paper only.')
    }
    const connections = new Map<string, TradingConnection>()
    for (const member of input.group.members.filter((candidate) => candidate.enabled)) {
      connections.set(member.connection_id, await this.options.resolveConnection(member.connection_id))
    }
    const plans = input.group.members.filter((member) => member.enabled).map((member) => (
      buildMirrorChildPlan({
        ticket: input.ticket,
        binding: input.binding,
        group: input.group,
        member,
        connection: connections.get(member.connection_id)!,
        instrument: input.instrument,
        riskPolicy: this.options.riskPolicy,
      })
    ))
    if (plans.length < 2) {
      throw new ExecutionGatewayError('RISK_DENIED', 'Mirror execution requires at least two enabled children.')
    }
    let parent = await this.options.store.createParent(
      buildPlanningParent(input, plans, input.binding.received_at),
    )
    if (['blocked', 'active', 'partial', 'closed', 'halted'].includes(parent.state)) return parent

    if (parent.state === 'planning') try {
      const projections: MirrorChildRiskProjection[] = []
      for (const plan of plans) {
        await this.options.store.persistChildSource(plan.source)
        const registered = await this.options.gateway.registerIntent(plan.intent, parent.trace_id)
        const authorization = await this.options.resolveAuthorization(plan.intent.connection_id)
        if (!authorization) {
          throw new ExecutionGatewayError(
            'AUTHORIZATION_MISMATCH',
            `Mirror child ${plan.intent.connection_id} has no active standing paper mandate.`,
          )
        }
        const approved = registered.state === 'created'
          ? await this.options.gateway.evaluateAndApprove(plan.intent.intent_id, authorization)
          : registered
        if (approved.state !== 'approved' || !approved.risk_decision) {
          throw new ExecutionGatewayError(
            'RISK_DENIED',
            `Mirror child ${plan.intent.connection_id} did not pass exact account risk admission.`,
          )
        }
        if (Date.parse(approved.risk_decision.valid_until) <= Date.parse(now())) {
          throw new ExecutionGatewayError('STALE_RISK_DECISION', 'Mirror child risk admission expired.')
        }
        const projection = buildRiskProjection(plan, approved, now())
        await this.options.store.persistProjection(projection)
        projections.push(projection)
      }
      const reservation = await this.options.store.reserve({ parent, group: input.group, projections })
      await this.options.gateway.reserveMirrorOwnership(plans.map((plan) => plan.intent.intent_id))
      await this.revalidateChildren(plans)
      parent = await this.options.store.updateParent(parent.mirror_execution_id, (current) => {
        const timestamp = now()
        return withoutChecksum({
          ...current,
          state: 'admitted',
          reservation_id: reservation.reservation_id,
          children: current.children.map((child) => ({ ...child, state: 'admitted' as const })),
          transitions: [...current.transitions, {
            from: current.state, to: 'admitted',
            reason: 'Every child passed exact account admission and aggregate risk was reserved.',
            at: timestamp,
          }],
          updated_at: timestamp,
        })
      })
    } catch (error) {
      await this.options.gateway.releaseMirrorOwnership(
        plans.map((plan) => plan.intent.intent_id),
      ).catch(() => undefined)
      await this.options.store.cancelReservation(parent.mirror_execution_id).catch(() => undefined)
      return this.options.store.updateParent(parent.mirror_execution_id, (current) => {
        if (current.state !== 'planning') return withoutChecksum(current)
        const timestamp = now()
        return withoutChecksum({
          ...current,
          state: 'blocked',
          children: current.children.map((child) => ({
            ...child, state: 'blocked' as const, error_code: errorCode(error),
          })),
          transitions: [...current.transitions, {
            from: current.state, to: 'blocked',
            reason: error instanceof Error ? error.message : 'Mirror admission failed.',
            at: timestamp,
          }],
          updated_at: timestamp,
        })
      })
    }

    if (!input.dispatch) return parent
    let grants
    if (parent.state === 'admitted') {
      try {
        await this.revalidateChildren(plans)
        const projections = await this.options.store.getProjectionsForParent(parent)
        const validUntil = new Date(Math.min(
          ...projections.map((projection) => Date.parse(projection.valid_until)),
        )).toISOString()
        if (Date.parse(validUntil) <= Date.parse(now())) {
          throw new ExecutionGatewayError('STALE_RISK_DECISION', 'Mirror dispatch evidence expired.')
        }
        grants = await this.options.store.issueGrants({ parent, expires_at: validUntil })
      } catch (error) {
        await this.options.gateway.releaseMirrorOwnership(plans.map((plan) => plan.intent.intent_id))
          .catch(() => undefined)
        await this.options.store.cancelReservation(parent.mirror_execution_id).catch(() => undefined)
        return this.options.store.updateParent(parent.mirror_execution_id, (current) => {
          const timestamp = now()
          return withoutChecksum({
            ...current,
            state: 'blocked',
            children: current.children.map((child) => ({
              ...child, state: 'blocked' as const, error_code: errorCode(error),
            })),
            transitions: [...current.transitions, {
              from: current.state, to: 'blocked',
              reason: error instanceof Error ? error.message : 'Mirror dispatch revalidation failed.',
              at: timestamp,
            }],
            updated_at: timestamp,
          })
        })
      }
      parent = await this.options.store.updateParent(parent.mirror_execution_id, (current) => {
        const timestamp = now()
        return withoutChecksum({
          ...current,
          state: 'dispatching',
          order_mutation_io_started_at: timestamp,
          children: current.children.map((child) => ({ ...child, state: 'dispatching' as const })),
          transitions: [...current.transitions, {
            from: current.state, to: 'dispatching',
            reason: 'Complete child grants were persisted before bounded dispatch.',
            at: timestamp,
          }],
          updated_at: timestamp,
        })
      })
    } else if (parent.state === 'dispatching') {
      try {
        await this.revalidateChildren(plans)
        grants = await this.options.store.getGrantsForParent(parent.mirror_execution_id)
      } catch (error) {
        const records = new Map(await Promise.all(plans.map(async (plan) => [
          plan.intent.intent_id,
          await this.options.gateway.get(plan.intent.intent_id),
        ] as const)))
        return this.options.store.updateParent(parent.mirror_execution_id, (current) => {
          const timestamp = now()
          const children = current.children.map((child) => {
            const record = records.get(child.intent_id)!
            return {
              ...child,
              state: record.state === 'protected'
                ? 'protected' as const
                : TERMINAL_EXECUTION_STATES.has(record.state)
                  ? 'terminal' as const
                  : 'blocked' as const,
              execution_record_checksum: sha256(record),
              ...(record.state === 'protected' ? {} : { error_code: errorCode(error) }),
            }
          })
          const state: MirrorExecution['state'] = children.some((child) => child.state === 'protected')
            ? 'partial'
            : 'halted'
          return withoutChecksum({
            ...current,
            state,
            children,
            transitions: [...current.transitions, {
              from: current.state, to: state,
              reason: error instanceof Error ? error.message : 'Mirror recovery revalidation failed.',
              at: timestamp,
            }],
            updated_at: timestamp,
          })
        })
      }
    } else {
      return parent
    }

    const results = await mapLimit(grants, input.group.dispatch_policy.max_concurrency, async (grant) => {
      try {
        const current = await this.options.gateway.get(grant.intent_id)
        const record = current.state === 'approved'
          ? await this.options.gateway.execute(grant.intent_id, grant.grant_id)
          : current.state === 'protected'
            ? current
            : TERMINAL_EXECUTION_STATES.has(current.state)
              ? current
            : await this.options.gateway.reconcile(grant.intent_id)
        return { grant, record }
      } catch (error) {
        return { grant, error }
      }
    })
    return this.options.store.updateParent(parent.mirror_execution_id, (current) => {
      const timestamp = now()
      const children = current.children.map((child) => {
        const result = results.find(({ grant }) => grant.intent_id === child.intent_id)!
        if (result.error) return { ...child, state: 'unknown' as const, error_code: errorCode(result.error) }
        const record = result.record!
        return {
          ...child,
          state: record.state === 'protected'
            ? 'protected' as const
            : TERMINAL_EXECUTION_STATES.has(record.state)
              ? 'terminal' as const
              : 'divergent' as const,
          execution_record_checksum: sha256(record),
          ...(record.state === 'protected'
            ? {}
            : { error_code: `MIRROR_CHILD_${record.state.toUpperCase().replaceAll('-', '_')}` }),
        }
      })
      const protectedCount = children.filter((child) => child.state === 'protected').length
      const state: MirrorExecution['state'] = protectedCount === children.length
        ? 'active'
        : protectedCount > 0
          ? 'partial'
          : 'halted'
      return withoutChecksum({
        ...current,
        state,
        children,
        transitions: [...current.transitions, {
          from: current.state, to: state,
          reason: state === 'active'
            ? 'Every child is provider-confirmed protected.'
            : 'One or more child outcomes require operator reconciliation.',
          at: timestamp,
        }],
        updated_at: timestamp,
      })
    })
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }

  private async revalidateChildren(plans: MirrorChildPlan[]): Promise<void> {
    const approvedIntentIds: string[] = []
    for (const plan of plans) {
      const record = await this.options.gateway.get(plan.intent.intent_id)
      if (record.state !== 'approved') continue
      const currentAuthorization = await this.options.resolveAuthorization(plan.intent.connection_id)
      if (
        !currentAuthorization
        || !record.authorization
        || sha256(currentAuthorization) !== sha256(record.authorization)
      ) {
        throw new ExecutionGatewayError(
          'AUTHORIZATION_MISMATCH',
          `Mirror child ${plan.intent.connection_id} mandate changed after approval.`,
        )
      }
      approvedIntentIds.push(plan.intent.intent_id)
    }
    if (approvedIntentIds.length > 0) {
      await this.options.gateway.revalidateMirrorAdmission(approvedIntentIds)
    }
  }
}

export const buildMirrorChildPlan = (input: {
  ticket: DiscoTraderTicket
  binding: SourceExecutionBinding
  group: MirrorGroup
  member: MirrorGroupMember
  connection: TradingConnection
  instrument: DiscoTraderInstrumentRoute
  riskPolicy: MirrorRiskPolicy
}): MirrorChildPlan => {
  if (input.binding.target.type !== 'mirror-group') {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror child planning requires a group binding.')
  }
  if (input.ticket.entry === undefined) {
    throw new ExecutionGatewayError(
      'RISK_DENIED',
      'Stage 2 Mirror admission requires a checksum-bound limit entry price.',
    )
  }
  const plannedQuantity = input.member.quantity_rule.mode === 'source-quantity'
    ? input.ticket.contracts
    : input.member.quantity_rule.contracts
  if (plannedQuantity > input.member.quantity_rule.max_contracts) {
    throw new ExecutionGatewayError('RISK_DENIED', 'Mirror child quantity exceeds its frozen member cap.')
  }
  const base = convertDiscoTraderTicket(input.ticket, {
    connection_id: input.connection.connection_id,
    source_id: input.binding.route_id,
    instrument: input.instrument,
    valid_for_ms: 5 * 60_000,
  }, input.binding.received_at)
  if (base.intent.entry.type !== 'limit') {
    throw new ExecutionGatewayError('RISK_DENIED', 'Stage 2 supports limit-entry risk bounds only.')
  }
  const risk = computeChildRiskUpperBound({
    intent: base.intent,
    quantity: plannedQuantity,
    feePerContractUsd: input.riskPolicy.fee_per_contract_usd,
  })
  const childIntentId = `intent-mirror-${sha256({
    ticket_id: input.ticket.id,
    message_id: input.ticket.provenance.messageId,
    mirror_group_id: input.group.mirror_group_id,
    mirror_group_revision: input.group.revision,
    member_id: input.member.member_id,
    connection_id: input.connection.connection_id,
  }).slice(0, 40)}`
  const sourceId = `mirror-child-source-${sha256(childIntentId).slice(0, 32)}`
  const exitLegs = scaleExitLegs(
    base.intent.protection.exit_legs,
    input.ticket.contracts,
    plannedQuantity,
  )
  const sourceUnsigned: Omit<MirrorChildSource, 'content_checksum'> = {
    mirror_child_source_schema_version: MIRROR_CHILD_SOURCE_SCHEMA_VERSION,
    mirror_child_source_id: sourceId,
    mirror_execution_id: input.binding.target.mirror_execution_id,
    mirror_group_id: input.group.mirror_group_id,
    mirror_group_revision: input.group.revision,
    group_snapshot_checksum: input.group.content_checksum,
    source_binding_id: input.binding.binding_id,
    source_binding_checksum: sourceBindingEvidenceChecksum(input.binding),
    route_id: input.binding.route_id,
    member_id: input.member.member_id,
    connection_id: input.connection.connection_id,
    ticket_id: input.ticket.id,
    ticket_checksum: input.binding.ticket_checksum,
    instrument: input.binding.instrument,
    side: base.intent.side,
    entry_order_type: base.intent.entry.type,
    entry_price: base.intent.entry.price,
    stop_loss: base.intent.protection.stop_loss,
    target_prices: input.ticket.targets.map(String),
    ...(exitLegs ? { exit_legs: exitLegs } : {}),
    source_quantity: input.ticket.contracts,
    planned_quantity: plannedQuantity,
    quantity_rule_snapshot: input.member.quantity_rule,
    derived_initial_risk_upper_bound_usd: risk.initialRiskUsd,
    derivation_version: '2.0.0',
    created_at: input.binding.received_at,
  }
  const source = mirrorChildSourceSchema.parse({
    ...sourceUnsigned,
    content_checksum: sha256(sourceUnsigned),
  })
  const { content_checksum: _baseChecksum, ...baseUnsigned } = base.intent
  const intentUnsigned: Omit<OrderIntent, 'content_checksum'> = {
    ...baseUnsigned,
    intent_schema_version: ORDER_INTENT_SCHEMA_VERSION,
    intent_id: childIntentId,
    source: { ...base.intent.source, source_id: source.mirror_child_source_id },
    mirror_lineage: {
      mirror_execution_id: source.mirror_execution_id,
      mirror_group_id: source.mirror_group_id,
      mirror_group_revision: source.mirror_group_revision,
      member_id: source.member_id,
      mirror_child_source_id: source.mirror_child_source_id,
      mirror_child_source_checksum: source.content_checksum,
    },
    quantity: plannedQuantity,
    protection: {
      ...base.intent.protection,
      ...(exitLegs ? { exit_legs: exitLegs } : {}),
    },
    max_loss_usd: risk.initialRiskUsd,
  }
  const intent = orderIntentSchema.parse({
    ...intentUnsigned,
    content_checksum: computeOrderIntentChecksum(intentUnsigned),
  })
  return {
    source,
    intent,
    provider_account_key: providerAccountIdentityKey(input.connection),
    adverse_entry_bound: {
      kind: intent.side === 'buy' ? 'maximum-price' : 'minimum-price',
      price: intent.entry.type === 'limit' ? intent.entry.price : '0',
    },
    protection: intent.protection.stop_loss.type === 'price'
      ? { kind: 'absolute-price', stop_price: intent.protection.stop_loss.value }
      : {
          kind: 'tick-distance',
          ticks: Number(intent.protection.stop_loss.value),
          tick_size: intent.instrument.tick_size!,
        },
    tick_value_usd: risk.tickValueUsd,
    risk_policy_version: input.riskPolicy.policy_version,
    fees_policy_version: input.riskPolicy.fees_policy_version,
  }
}

const scaleExitLegs = (
  legs: OrderIntent['protection']['exit_legs'],
  sourceQuantity: number,
  plannedQuantity: number,
): OrderIntent['protection']['exit_legs'] => {
  if (!legs) return undefined
  const scaled = legs.map((leg) => {
    const numerator = leg.quantity * plannedQuantity
    if (numerator % sourceQuantity !== 0 || numerator / sourceQuantity < 1) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Mirror quantity cannot preserve every immutable exit leg as a positive whole-contract allocation.',
      )
    }
    return { ...leg, quantity: numerator / sourceQuantity }
  })
  if (scaled.reduce((total, leg) => total + leg.quantity, 0) !== plannedQuantity) {
    throw new ExecutionGatewayError(
      'RECORD_INTEGRITY_FAILURE',
      'Scaled Mirror exit legs do not cover the planned child quantity.',
    )
  }
  return scaled
}

const buildRiskProjection = (
  plan: MirrorChildPlan,
  record: ExecutionRecord,
  evaluatedAt: string,
): MirrorChildRiskProjection => {
  if (!record.risk_decision || record.risk_decision.result !== 'allow') {
    throw new ExecutionGatewayError('RISK_DENIED', 'Mirror child lacks an allowed risk decision.')
  }
  const validUntil = new Date(Math.min(
    Date.parse(record.risk_decision.valid_until),
    Date.parse(record.intent.valid_until),
  )).toISOString()
  const unsigned: Omit<MirrorChildRiskProjection, 'content_checksum'> = {
    mirror_child_risk_projection_schema_version: MIRROR_CHILD_RISK_PROJECTION_SCHEMA_VERSION,
    projection_id: `mirror-projection-${sha256(record.intent.intent_id).slice(0, 32)}`,
    mirror_execution_id: plan.source.mirror_execution_id,
    intent_id: record.intent.intent_id,
    connection_id: record.intent.connection_id,
    provider_account_key: plan.provider_account_key,
    account_snapshot_id: record.risk_decision.account_snapshot_id,
    risk_decision_id: record.risk_decision.decision_id,
    mirror_child_source_checksum: plan.source.content_checksum,
    instrument_canonical_id: record.intent.instrument.canonical_id,
    planned_quantity: record.intent.quantity,
    valuation: {
      currency: 'USD',
      side: record.intent.side,
      entry_order_type: record.intent.entry.type,
      adverse_entry_bound: plan.adverse_entry_bound,
      protection: plan.protection,
      tick_value_usd: plan.tick_value_usd,
      instrument_value_version: 'trade-god-futures-economics@1',
      slippage_policy_version: 'limit-price-bound@1',
      risk_policy_version: plan.risk_policy_version,
      fees_policy_version: plan.fees_policy_version,
      risk_model_authority: 'planning-stop-distance-with-fees',
    },
    initial_risk_upper_bound_usd: record.intent.max_loss_usd!,
    evaluated_at: evaluatedAt,
    valid_until: validUntil,
  }
  return mirrorChildRiskProjectionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}

const buildPlanningParent = (
  input: {
    ticket: DiscoTraderTicket
    binding: SourceExecutionBinding
    group: MirrorGroup
  },
  plans: MirrorChildPlan[],
  timestamp: string,
): MirrorExecution => {
  const target = input.binding.target
  if (target.type !== 'mirror-group') throw new Error('Mirror binding required')
  const unsigned: Omit<MirrorExecution, 'content_checksum'> = {
    mirror_execution_schema_version: MIRROR_EXECUTION_SCHEMA_VERSION,
    mirror_execution_id: target.mirror_execution_id,
    trace_id: `trace-mirror-${sha256(target.mirror_execution_id).slice(0, 32)}`,
    route_id: input.binding.route_id,
    mirror_group_id: input.group.mirror_group_id,
    mirror_group_revision: input.group.revision,
    group_snapshot_checksum: input.group.content_checksum,
    source: {
      ticket_id: input.ticket.id,
      message_id: input.binding.message_id,
      author_id: input.binding.author_id,
      server_id: input.binding.server_id,
      channel_id: input.binding.channel_id,
      ticket_checksum: input.binding.ticket_checksum,
      instrument_canonical_id: input.binding.instrument.canonical_id,
    },
    state: 'planning',
    children: plans.map((plan) => ({
      member_id: plan.source.member_id,
      connection_id: plan.source.connection_id,
      intent_id: plan.intent.intent_id,
      planned_quantity: plan.intent.quantity,
      quantity_rule_snapshot: plan.source.quantity_rule_snapshot,
      state: 'planned',
    })),
    transitions: [{ to: 'planning', reason: 'Frozen Mirror child plan created.', at: timestamp }],
    created_at: timestamp,
    updated_at: timestamp,
  }
  return mirrorExecutionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}

const computeChildRiskUpperBound = (input: {
  intent: OrderIntent
  quantity: number
  feePerContractUsd: string
}): { initialRiskUsd: string; tickValueUsd: string } => {
  if (input.intent.entry.type !== 'limit') throw new Error('Limit entry required')
  const tickSize = input.intent.instrument.tick_size
  const pointValue = input.intent.instrument.point_value_usd
  if (!tickSize || !pointValue) throw new Error('Instrument economics required')
  const entry = decimal(input.intent.entry.price)
  let distance: Fraction
  if (input.intent.protection.stop_loss.type === 'ticks') {
    distance = multiply(decimal(input.intent.protection.stop_loss.value), decimal(tickSize))
  } else {
    const stop = decimal(input.intent.protection.stop_loss.value)
    const compare = compareFraction(entry, stop)
    if (
      (input.intent.side === 'buy' && compare <= 0)
      || (input.intent.side === 'sell' && compare >= 0)
    ) throw new ExecutionGatewayError('RISK_DENIED', 'Mirror stop is not protective relative to entry.')
    distance = absolute(subtract(entry, stop))
  }
  const gross = multiply(multiply(distance, decimal(pointValue)), decimal(String(input.quantity)))
  const fees = multiply(decimal(input.feePerContractUsd), decimal(String(input.quantity)))
  return {
    initialRiskUsd: formatFractionCentsUp(add(gross, fees)),
    tickValueUsd: formatFraction(multiply(decimal(tickSize), decimal(pointValue))),
  }
}

interface Fraction { numerator: bigint; scale: bigint }
const decimal = (value: string): Fraction => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('Invalid decimal')
  const [whole, decimals = ''] = value.split('.')
  return { numerator: BigInt(`${whole}${decimals}`), scale: 10n ** BigInt(decimals.length) }
}
const multiply = (a: Fraction, b: Fraction): Fraction => ({ numerator: a.numerator * b.numerator, scale: a.scale * b.scale })
const add = (a: Fraction, b: Fraction): Fraction => ({ numerator: a.numerator * b.scale + b.numerator * a.scale, scale: a.scale * b.scale })
const subtract = (a: Fraction, b: Fraction): Fraction => ({ numerator: a.numerator * b.scale - b.numerator * a.scale, scale: a.scale * b.scale })
const absolute = (a: Fraction): Fraction => ({ numerator: a.numerator < 0n ? -a.numerator : a.numerator, scale: a.scale })
const compareFraction = (a: Fraction, b: Fraction): number => {
  const difference = a.numerator * b.scale - b.numerator * a.scale
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}
const formatFractionCentsUp = (value: Fraction): string => {
  const cents = (value.numerator * 100n + value.scale - 1n) / value.scale
  const whole = cents / 100n
  const remainder = cents % 100n
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, '0')}`
}
const formatFraction = (value: Fraction): string => {
  if (value.numerator % value.scale === 0n) return (value.numerator / value.scale).toString()
  const precision = 12n
  const scaled = value.numerator * (10n ** precision) / value.scale
  const text = `${scaled / (10n ** precision)}.${(scaled % (10n ** precision)).toString().padStart(Number(precision), '0')}`
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

const sourceBindingEvidenceChecksum = (binding: SourceExecutionBinding): string => sha256({
  binding_id: binding.binding_id,
  server_id: binding.server_id,
  channel_id: binding.channel_id,
  author_id: binding.author_id,
  message_id: binding.message_id,
  ticket_id: binding.ticket_id,
  ticket_checksum: binding.ticket_checksum,
  route_id: binding.route_id,
  instrument: binding.instrument,
  received_at: binding.received_at,
  target: binding.target,
  created_at: binding.created_at,
})

const withoutChecksum = <T extends { content_checksum: string }>(value: T): Omit<T, 'content_checksum'> => {
  const { content_checksum: _checksum, ...unsigned } = value
  return unsigned
}

const errorCode = (error: unknown): string => error instanceof ExecutionGatewayError
  ? error.code
  : 'MIRROR_COORDINATION_FAILURE'

const TERMINAL_EXECUTION_STATES = new Set([
  'risk-denied', 'closed', 'reconcile-halted', 'rejected', 'canceled', 'expired', 'error',
])

const mapLimit = async <T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await operation(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
