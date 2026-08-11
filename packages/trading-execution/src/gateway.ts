import { randomUUID } from 'node:crypto'

import {
  EXECUTION_COMMAND_SCHEMA_VERSION,
  EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
  EXECUTION_MANAGEMENT_COMMAND_SCHEMA_VERSION,
  EXECUTION_RECEIPT_SCHEMA_VERSION,
  EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION,
  executionAccountSnapshotSchema,
  executionAuthorizationSchema,
  executionCommandSchema,
  executionManagementAcknowledgmentSchema,
  executionManagementCommandSchema,
  executionManagementPayloadSchema,
  executionReceiptSchema,
  executionNoExposureProofSchema,
  executionReconciliationSchema,
  executionSubmitAcknowledgmentSchema,
  mirrorDispatchGrantSchema,
  orderIntentSchema,
  riskDecisionSchema,
  tradingConnectionSchema,
  type ExecutionAuthorization,
  type ExecutionAccountSnapshot,
  type ExecutionLifecycleState,
  type ExecutionManagementAcknowledgment,
  type ExecutionManagementCommand,
  type ExecutionManagementPayload,
  type ExecutionReceipt,
  type ExecutionNoExposureProof,
  type ExecutionProtectionOrder,
  type ExecutionRecord,
  type ExecutionReconciliation,
  type OrderIntent,
  type MirrorDispatchGrant,
  type MirrorOwnershipReleaseJournal,
  type RiskDecision,
  type TradingConnection,
} from '@trade-god/contracts'

import type { ExecutionAdapter } from './adapter.ts'
import {
  computeActionDigest,
  computeExecutionReceiptChecksum,
  computeIdempotencyKey,
  computeManagementAcknowledgmentChecksum,
  computeManagementActionDigest,
  computeManagementCommandChecksum,
  computeOrderIntentChecksum,
  sha256,
} from './canonical.ts'
import { ExecutionAdapterError, ExecutionGatewayError } from './errors.ts'
import {
  resolveFuturesContractIdentity,
  resolveFuturesEconomicSpec,
} from './futures-contract.ts'
import { FileExecutionStore } from './store.ts'

export interface ExecutionGatewayOptions {
  store: FileExecutionStore
  resolveConnection(connectionId: string): Promise<TradingConnection>
  adapters: ExecutionAdapter[]
  resolveMirrorDispatchGrant?: (grantId: string) => Promise<MirrorDispatchGrant>
  allowFakeMirrorDispatch?: boolean
  now?: () => string
  maxAccountSnapshotAgeMs?: number
}

export interface ExecutionRecoveryResult {
  intent_id: string
  initial_state: ExecutionLifecycleState
  final_state?: ExecutionLifecycleState
  outcome: 'reconciled' | 'canceled-before-command' | 'skipped' | 'halted'
  error?: string
}

export class ExecutionGateway {
  private readonly now: () => string
  private readonly maxAccountSnapshotAgeMs: number
  private emergencyHalted = false

  constructor(private readonly options: ExecutionGatewayOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.maxAccountSnapshotAgeMs = options.maxAccountSnapshotAgeMs ?? 5_000
  }

  async registerIntent(input: OrderIntent, traceId = `trace-${randomUUID()}`): Promise<ExecutionRecord> {
    const intent = orderIntentSchema.parse(input)
    const expectedChecksum = computeOrderIntentChecksum(intent)
    if (intent.content_checksum !== expectedChecksum) {
      throw new ExecutionGatewayError(
        'INTENT_CHECKSUM_MISMATCH',
        'Order intent content checksum does not match its immutable fields.',
      )
    }
    if (Date.parse(intent.valid_until) <= Date.parse(this.now())) {
      throw new ExecutionGatewayError('INTENT_EXPIRED', 'Order intent has expired.')
    }
    return this.options.store.create(intent, traceId)
  }

  get(intentId: string): Promise<ExecutionRecord> {
    return this.options.store.get(intentId)
  }

  list(): Promise<ExecutionRecord[]> {
    return this.options.store.list()
  }

  async dismissPendingIntent(
    intentId: string,
    expectedRecordChecksum: string,
  ): Promise<ExecutionRecord> {
    return this.options.store.update(intentId, (record) => {
      if (sha256(record) !== expectedRecordChecksum) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Pending intent changed after operator review.',
        )
      }
      ensureState(record, ['created', 'approved'])
      return transition(
        record,
        'canceled',
        'Operator dismissed the pre-activation pending intent.',
        this.now(),
      )
    })
  }

  async captureFlatAccountSnapshot(connectionId: string): Promise<ExecutionAccountSnapshot> {
    const connection = tradingConnectionSchema.parse(await this.options.resolveConnection(connectionId))
    const adapter = this.resolveCertifiedAdapter(connection)
    return this.options.store.withProviderMutationLock(
      this.providerAccountKey(connection),
      `paper-activation-snapshot:${connectionId}`,
      () => this.captureFlatAccountSnapshotWithProviderLock(connection, adapter),
    )
  }

  async verifyNoExposure(intentId: string): Promise<ExecutionNoExposureProof> {
    const initial = await this.options.store.get(intentId)
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(initial.intent.connection_id),
    )
    return this.options.store.withProviderMutationLock(
      this.providerAccountKey(connection),
      `verify-no-exposure:${intentId}`,
      () => this.verifyNoExposureWithProviderLock(intentId, connection),
    )
  }

  async prepareStopMove(
    intentId: string,
    target: 'breakeven' | string,
  ): Promise<Omit<Extract<ExecutionManagementPayload, { operation: 'modify' }>, 'operation'>> {
    const record = await this.options.store.get(intentId)
    ensureState(record, ['protected'])
    const receipt = record.receipt
    if (!receipt?.protection_verified) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Stop movement requires provider-verified protection.',
      )
    }
    const stops = receipt.protection_orders?.filter(
      (order) => order.role === 'stop-loss' && isActiveProtectionOrder(order),
    ) ?? []
    if (stops.length !== 1) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Stop movement requires exactly one active provider stop order.',
      )
    }
    const stop = stops[0]!
    if (!receipt.open_quantity || stop.quantity !== receipt.open_quantity) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Stop movement requires protection sized to the confirmed open position.',
      )
    }
    const stopPrice = target === 'breakeven' ? receipt.average_fill_price : target
    if (!stopPrice) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Breakeven movement requires a verified average fill price.',
      )
    }
    const currentStop = stop.stop_price
    if (!currentStop) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Stop movement requires the provider current stop price.',
      )
    }
    const currentValue = Number(currentStop)
    const nextValue = Number(stopPrice)
    const widensRisk = record.intent.side === 'buy'
      ? nextValue < currentValue
      : nextValue > currentValue
    if (widensRisk) {
      throw new ExecutionGatewayError(
        'RISK_DENIED',
        'Stop movement cannot widen risk relative to the provider-verified current stop.',
      )
    }
    const prepared = executionManagementPayloadSchema.parse({
      operation: 'modify',
      provider_order_id: stop.provider_order_id,
      quantity: stop.quantity,
      order_type: stop.order_type,
      ...(stop.order_type === 'limit' || stop.order_type === 'stop-limit'
        ? { limit_price: stop.limit_price }
        : {}),
      ...(stop.order_type === 'stop' || stop.order_type === 'stop-limit'
        ? { stop_price: stopPrice }
        : {}),
      time_in_force: stop.time_in_force,
    })
    if (prepared.operation !== 'modify') {
      throw new ExecutionGatewayError('INVALID_STATE', 'Prepared stop command is not a modification.')
    }
    const { operation: _operation, ...input } = prepared
    return input
  }

  async approve(
    intentId: string,
    riskInput: RiskDecision,
    authorizationInput?: ExecutionAuthorization,
  ): Promise<ExecutionRecord> {
    const risk = riskDecisionSchema.parse(riskInput)
    const current = await this.options.store.get(intentId)
    this.assertState(current, ['created'])
    this.assertRisk(current.intent, risk)
    if (risk.result === 'deny') {
      return this.options.store.update(intentId, (record) => {
        this.assertState(record, ['created'])
        record.risk_decision = risk
        return transition(record, 'risk-denied', risk.reasons.join(' '), this.now())
      })
    }
    if (!authorizationInput) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Allowed risk decisions require execution authorization.',
      )
    }
    const authorization = executionAuthorizationSchema.parse(authorizationInput)
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(current.intent.connection_id),
    )
    const actionDigest = computeActionDigest(current.intent, connection)
    this.assertAuthorization(current.intent, authorization, actionDigest)

    return this.options.store.update(intentId, (record) => {
      record.risk_decision = risk
      record.authorization = authorization
      transition(record, 'awaiting-authorization', 'Risk decision allowed the intent.', this.now())
      return transition(record, 'approved', 'Execution authorization matched the intent.', this.now())
    })
  }

  async evaluateAndApprove(
    intentId: string,
    authorizationInput: ExecutionAuthorization,
  ): Promise<ExecutionRecord> {
    const record = await this.options.store.get(intentId)
    this.assertState(record, ['created'])
    const authorization = executionAuthorizationSchema.parse(authorizationInput)
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(record.intent.connection_id),
    )
    this.assertAuthorization(
      record.intent,
      authorization,
      computeActionDigest(record.intent, connection),
    )
    const adapter = this.resolveAdapter(connection, record.intent)
    await adapter.connect(connection)
    const snapshot = executionAccountSnapshotSchema.parse(
      await adapter.snapshotAccount(connection),
    )
    this.assertAccountSnapshot(connection, snapshot)

    let result: RiskDecision['result'] = 'allow'
    let reasons = ['Provider state and checksum-bound trade loss are within the authorized paper envelope.']
    try {
      this.assertNoUnownedExposure(snapshot)
      this.assertMonetaryRisk(record.intent, snapshot, authorization)
    } catch (error) {
      if (!(error instanceof ExecutionGatewayError)) throw error
      result = 'deny'
      reasons = [error.message]
    }
    const evaluatedAt = this.now()
    const validUntilMs = Math.min(
      Date.parse(evaluatedAt) + this.maxAccountSnapshotAgeMs,
      Date.parse(record.intent.valid_until),
      Date.parse(authorization.expires_at),
    )
    const risk = riskDecisionSchema.parse({
      risk_decision_schema_version: 'risk-decision@1',
      decision_id: `risk-${randomUUID()}`,
      intent_id: record.intent.intent_id,
      account_snapshot_id: snapshot.account_snapshot_id,
      risk_policy_version: '1.0.0',
      result,
      reasons,
      evaluated_at: evaluatedAt,
      valid_until: new Date(validUntilMs).toISOString(),
    })
    return this.approve(
      intentId,
      risk,
      result === 'allow' ? authorization : undefined,
    )
  }

  async execute(intentId: string, mirrorDispatchGrantId?: string): Promise<ExecutionRecord> {
    const record = await this.options.store.get(intentId)
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(record.intent.connection_id),
    )
    return this.options.store.withProviderMutationLock(
      this.providerAccountKey(connection),
      `entry:${intentId}`,
      () => this.executeWithProviderLock(intentId, mirrorDispatchGrantId),
    )
  }

  async reserveMirrorOwnership(intentIds: string[]): Promise<void> {
    if (intentIds.length < 2 || new Set(intentIds).size !== intentIds.length) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        'Mirror ownership reservation requires at least two unique child intents.',
      )
    }
    const leases = []
    let mirrorExecutionId: string | undefined
    for (const intentId of [...intentIds].sort()) {
      const record = await this.options.store.get(intentId)
      this.assertState(record, ['approved'])
      if (!record.intent.mirror_lineage) {
        throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Mirror ownership requires child lineage.')
      }
      mirrorExecutionId ??= record.intent.mirror_lineage.mirror_execution_id
      if (record.intent.mirror_lineage.mirror_execution_id !== mirrorExecutionId) {
        throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Mirror children do not share one parent.')
      }
      const connection = tradingConnectionSchema.parse(
        await this.options.resolveConnection(record.intent.connection_id),
      )
      leases.push({
        ownership_key: this.ownershipKey(connection, record.intent),
        intent_id: record.intent.intent_id,
        connection_id: connection.connection_id,
        provider_account_key: this.providerAccountKey(connection),
        instrument_id: record.intent.instrument.canonical_id,
      })
    }
    await this.options.store.acquireOwnershipSet(leases)
  }

  async releaseMirrorOwnership(intentIds: string[]): Promise<void> {
    const leases = []
    for (const intentId of [...new Set(intentIds)].sort()) {
      const record = await this.options.store.get(intentId)
      if (!record.intent.mirror_lineage) continue
      const connection = tradingConnectionSchema.parse(
        await this.options.resolveConnection(record.intent.connection_id),
      )
      leases.push({
        ownership_key: this.ownershipKey(connection, record.intent),
        intent_id: record.intent.intent_id,
      })
    }
    await this.options.store.releaseOwnershipSet(leases)
  }

  async proveAndReleaseMirrorOwnership(intentIds: string[]): Promise<MirrorOwnershipReleaseJournal> {
    const ids = [...new Set(intentIds)].sort()
    if (ids.length !== intentIds.length || ids.length < 2) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        'Mirror closure requires every unique frozen child intent.',
      )
    }
    const records = await Promise.all(ids.map((intentId) => this.options.store.get(intentId)))
    if (records.some((record) => !record.intent.mirror_lineage)) {
      throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Mirror closure requires child lineage.')
    }
    const mirrorExecutionIds = new Set(records.map(
      (record) => record.intent.mirror_lineage!.mirror_execution_id,
    ))
    if (mirrorExecutionIds.size !== 1) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Mirror closure children do not share one immutable parent.',
      )
    }
    const mirrorExecutionId = [...mirrorExecutionIds][0]!
    const completedJournal = await this.options.store.getMirrorOwnershipRelease(mirrorExecutionId)
    if (completedJournal?.state === 'released') {
      if (completedJournal.intent_ids.join('\n') !== ids.join('\n')) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Released Mirror ownership journal does not match the frozen child set.',
        )
      }
      return completedJournal
    }
    const entries = (await Promise.all(records.map(async (record) => {
      const intentId = record.intent.intent_id
      const connection = tradingConnectionSchema.parse(
        await this.options.resolveConnection(record.intent.connection_id),
      )
      return { intentId, record, connection, providerKey: this.providerAccountKey(connection) }
    }))).sort((left, right) => (
      left.providerKey.localeCompare(right.providerKey)
      || left.intentId.localeCompare(right.intentId)
    ))
    if (new Set(entries.map(({ providerKey }) => providerKey)).size !== entries.length) {
      throw new ExecutionGatewayError(
        'ACCOUNT_MISMATCH',
        'Mirror closure requires one independently owned provider account per child.',
      )
    }
    const owner = `prove-release-mirror:${sha256(ids).slice(0, 32)}`
    const withLocks = <T>(index: number, operation: () => Promise<T>): Promise<T> => {
      const entry = entries[index]
      return entry
        ? this.options.store.withProviderMutationLock(
            entry.providerKey,
            owner,
            () => withLocks(index + 1, operation),
          )
        : operation()
    }
    return withLocks(0, async () => {
      let journal = await this.options.store.getMirrorOwnershipRelease(mirrorExecutionId)
      if (journal?.state === 'released') return journal
      if (!journal || journal.state === 'prepared') {
        const proofs: ExecutionNoExposureProof[] = []
        for (const entry of entries) {
          proofs.push(await this.verifyNoExposureWithProviderLock(entry.intentId, entry.connection))
        }
        const proofByIntent = new Map(proofs.map((proof) => [proof.intent_id, proof]))
        journal = await this.options.store.prepareMirrorOwnershipRelease({
          mirror_execution_id: mirrorExecutionId,
          intent_ids: ids,
          proofs: ids.map((intentId) => proofByIntent.get(intentId)!),
        })
      }
      if (journal.intent_ids.join('\n') !== ids.join('\n')) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Mirror ownership release journal does not match the frozen child set.',
        )
      }
      await this.options.store.releaseOwnershipSet(entries.map(({ intentId, record, connection }) => ({
        ownership_key: this.ownershipKey(connection, record.intent),
        intent_id: intentId,
      })))
      return this.options.store.markMirrorOwnershipReleased(mirrorExecutionId)
    })
  }

  async revalidateMirrorAdmission(intentIds: string[]): Promise<void> {
    for (const intentId of [...intentIds].sort()) {
      const record = await this.options.store.get(intentId)
      this.assertState(record, ['approved'])
      if (!record.intent.mirror_lineage || !record.authorization || !record.risk_decision) {
        throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Mirror child admission is incomplete.')
      }
      const connection = tradingConnectionSchema.parse(
        await this.options.resolveConnection(record.intent.connection_id),
      )
      const ownershipKey = this.ownershipKey(connection, record.intent)
      const ownership = await this.options.store.readOwnership(ownershipKey)
      if (ownership?.intent_id !== record.intent.intent_id) {
        throw new ExecutionGatewayError('EXECUTION_BUSY', 'Mirror child does not hold exact ownership.')
      }
      await this.options.store.withProviderMutationLock(
        this.providerAccountKey(connection),
        `mirror-revalidate:${record.intent.intent_id}`,
        async () => {
          this.assertIntentCurrent(record.intent)
          this.assertRisk(record.intent, record.risk_decision!)
          this.assertAuthorization(
            record.intent,
            record.authorization!,
            computeActionDigest(record.intent, connection),
          )
          await this.assertExecutionAllowed(record.intent, connection)
          const adapter = this.resolveAdapter(connection, record.intent)
          await adapter.connect(connection)
          const snapshot = executionAccountSnapshotSchema.parse(await adapter.snapshotAccount(connection))
          this.assertAccountSnapshot(connection, snapshot)
          this.assertMonetaryRisk(record.intent, snapshot, record.authorization!)
          if (snapshot.account_snapshot_id !== record.risk_decision!.account_snapshot_id) {
            throw new ExecutionGatewayError(
              'STALE_RISK_DECISION',
              'Mirror child provider truth changed after account risk approval.',
            )
          }
          this.assertNoUnownedExposure(snapshot)
        },
      )
    }
  }

  private async executeWithProviderLock(
    intentId: string,
    mirrorDispatchGrantId?: string,
  ): Promise<ExecutionRecord> {
    const approved = await this.options.store.get(intentId)
    this.assertState(approved, ['approved'])
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(approved.intent.connection_id),
    )
    const risk = approved.risk_decision
    const authorization = approved.authorization
    if (!risk || !authorization) {
      throw new ExecutionGatewayError('INVALID_STATE', 'Approved execution is missing risk or authorization.')
    }
    this.assertIntentCurrent(approved.intent)
    this.assertRisk(approved.intent, risk)
    const actionDigest = computeActionDigest(approved.intent, connection)
    this.assertAuthorization(approved.intent, authorization, actionDigest)
    await this.assertMirrorDispatchGrant(approved.intent, mirrorDispatchGrantId)
    await this.assertExecutionAllowed(approved.intent, connection)
    const adapter = this.resolveAdapter(connection, approved.intent)
    const ownershipKey = this.ownershipKey(connection, approved.intent)
    await this.options.store.acquireOwnership({
      ownership_key: ownershipKey,
      intent_id: approved.intent.intent_id,
      connection_id: connection.connection_id,
      provider_account_key: this.providerAccountKey(connection),
      instrument_id: approved.intent.instrument.canonical_id,
    })

    let claimed: ExecutionRecord
    try {
      await adapter.connect(connection)
      const snapshot = executionAccountSnapshotSchema.parse(
        await adapter.snapshotAccount(connection),
      )
      this.assertAccountSnapshot(connection, snapshot)
      this.assertMonetaryRisk(approved.intent, snapshot, authorization)
      if (risk.account_snapshot_id !== snapshot.account_snapshot_id) {
        throw new ExecutionGatewayError(
          'STALE_RISK_DECISION',
          'Risk decision does not bind the current provider account state.',
          true,
        )
      }
      this.assertNoUnownedExposure(snapshot)
      claimed = await this.options.store.claim(intentId, (record) => {
        this.assertState(record, ['approved'])
        record.claim = {
          claim_id: `claim-${randomUUID()}`,
          claimed_at: this.now(),
        }
        return transition(record, 'claimed', 'Execution gateway atomically claimed the intent.', this.now())
      })
    } catch (error) {
      await this.options.store.releaseOwnership(ownershipKey, intentId)
      throw error
    }

    try {
      await this.assertExecutionAllowed(claimed.intent, connection)
    } catch (error) {
      await this.options.store.update(intentId, (record) => (
        transition(record, 'canceled', 'Execution was blocked after claim and before submission.', this.now())
      ))
      await this.options.store.releaseOwnership(ownershipKey, intentId)
      throw error
    }
    if (!claimed.claim) {
      throw new ExecutionGatewayError('INVALID_STATE', 'Claimed execution is missing its durable claim.')
    }
    const command = executionCommandSchema.parse({
      command_schema_version: EXECUTION_COMMAND_SCHEMA_VERSION,
      command_id: `command-${randomUUID()}`,
      intent_id: claimed.intent.intent_id,
      claim_id: claimed.claim.claim_id,
      connection_id: connection.connection_id,
      adapter_id: adapter.descriptor.adapter_id,
      adapter_version: adapter.descriptor.adapter_version,
      action_digest: actionDigest,
      idempotency_key: computeIdempotencyKey(
        claimed.intent,
        connection,
        authorization,
        actionDigest,
      ),
      issued_at: this.now(),
    })
    await this.options.store.update(intentId, (record) => {
      this.assertState(record, ['claimed'])
      record.command = command
      return transition(record, 'submitting', 'Execution command persisted before provider I/O.', this.now())
    })

    let acknowledgment
    try {
      acknowledgment = executionSubmitAcknowledgmentSchema.parse(await adapter.submit({
        connection,
        intent: claimed.intent,
        command,
      }))
    } catch (error) {
      if (error instanceof ExecutionAdapterError && error.submissionMayHaveOccurred) {
        return this.finishUncertain(intentId, connection, adapter, error.message)
      }
      await this.options.store.update(intentId, (record) => (
        transition(
          record,
          'error',
          error instanceof Error ? error.message : 'Provider submission failed before delivery.',
          this.now(),
        )
      ))
      await this.options.store.releaseOwnership(ownershipKey, intentId)
      throw error
    }

    if (acknowledgment.command_id !== command.command_id) {
      return this.finishUncertain(
        intentId,
        connection,
        adapter,
        'Provider acknowledgment did not match the execution command.',
      )
    }
    if (acknowledgment.status === 'rejected') {
      const rejected = await this.options.store.update(intentId, (record) => {
        transition(
          record,
          'rejected',
          `${acknowledgment.rejection_code}: ${acknowledgment.rejection_message}`,
          this.now(),
        )
        record.receipt = this.buildReceipt({
          record,
          connection,
          adapter,
          providerOrderIds: acknowledgment.provider_order_ids,
          result: 'rejected',
          filledQuantity: 0,
          protectionVerified: false,
          evidenceRefs: [],
        })
        return record
      })
      await this.options.store.releaseOwnership(ownershipKey, intentId)
      return rejected
    }

    await this.options.store.update(intentId, (record) => (
      transition(record, 'acknowledged', 'Provider acknowledged the order command.', this.now())
    ))
    return this.reconcileWithProviderLock(intentId)
  }

  private async assertMirrorDispatchGrant(
    intent: OrderIntent,
    grantId?: string,
  ): Promise<void> {
    if (!intent.mirror_lineage) {
      if (grantId) {
        throw new ExecutionGatewayError(
          'AUTHORIZATION_MISMATCH',
          'A Mirror dispatch grant cannot authorize a non-Mirror intent.',
        )
      }
      return
    }
    if (!grantId || !this.options.resolveMirrorDispatchGrant) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Mirror child execution requires a gateway-resolved dispatch grant.',
      )
    }
    const grant = mirrorDispatchGrantSchema.parse(
      await this.options.resolveMirrorDispatchGrant(grantId),
    )
    if (grant.dispatch_authority === 'fake-provider-test-only' && !this.options.allowFakeMirrorDispatch) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Stage 2 Mirror grants cannot authorize a real provider adapter.',
      )
    }
    const { content_checksum: _checksum, ...unsigned } = grant
    if (sha256(unsigned) !== grant.content_checksum) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        'Mirror dispatch grant failed integrity validation.',
      )
    }
    if (
      grant.grant_id !== grantId
      || grant.mirror_execution_id !== intent.mirror_lineage.mirror_execution_id
      || grant.intent_id !== intent.intent_id
      || grant.connection_id !== intent.connection_id
    ) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Mirror dispatch grant does not bind this exact child intent.',
      )
    }
    if (Date.parse(grant.expires_at) <= Date.parse(this.now())) {
      throw new ExecutionGatewayError('INTENT_EXPIRED', 'Mirror dispatch grant has expired.')
    }
  }

  async reconcile(intentId: string): Promise<ExecutionRecord> {
    const record = await this.options.store.get(intentId)
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(record.intent.connection_id),
    )
    return this.options.store.withProviderMutationLock(
      this.providerAccountKey(connection),
      `reconcile:${intentId}`,
      () => this.reconcileWithProviderLock(intentId),
    )
  }

  private async reconcileWithProviderLock(intentId: string): Promise<ExecutionRecord> {
    const record = await this.options.store.get(intentId)
    if (TERMINAL_STATES.has(record.state)) {
      throw new ExecutionGatewayError(
        'INVALID_STATE',
        `Cannot reconcile terminal execution state ${record.state}.`,
      )
    }
    if (!record.command) {
      throw new ExecutionGatewayError('INVALID_STATE', 'Cannot reconcile before an execution command exists.')
    }
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(record.intent.connection_id),
    )
    const adapter = this.options.adapters.find(
      (candidate) => (
        candidate.descriptor.adapter_id === record.command?.adapter_id
        && candidate.descriptor.adapter_version === record.command?.adapter_version
      ),
    )
    if (!adapter) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'The adapter version that issued this command is unavailable for reconciliation.',
      )
    }
    const result = executionReconciliationSchema.parse(await adapter.reconcile({
      connection,
      intent: record.intent,
      command: record.command,
      ...(record.management_actions.at(-1)?.command
        ? { managementCommand: record.management_actions.at(-1)!.command }
        : {}),
    }))
    if (
      result.command_id !== record.command.command_id
      || result.connection_id !== connection.connection_id
    ) {
      return this.finishReconciliationHalt(
        intentId,
        connection,
        adapter,
        result,
        'Reconciliation identity did not match the command and connection.',
      )
    }
    return this.applyReconciliation(intentId, connection, adapter, result)
  }

  cancelOrder(
    intentId: string,
    providerOrderIds: string[],
    requestId?: string,
  ): Promise<ExecutionRecord> {
    return this.manage(intentId, {
      operation: 'cancel',
      provider_order_ids: providerOrderIds,
    }, requestId)
  }

  modifyOrder(
    intentId: string,
    input: Omit<Extract<ExecutionManagementPayload, { operation: 'modify' }>, 'operation'>,
    requestId?: string,
  ): Promise<ExecutionRecord> {
    return this.manage(intentId, { operation: 'modify', ...input }, requestId)
  }

  closePosition(
    intentId: string,
    quantity: number,
    requestId?: string,
  ): Promise<ExecutionRecord> {
    return this.manage(intentId, { operation: 'partial-close', quantity }, requestId)
  }

  flatten(intentId: string, reason: string, requestId?: string): Promise<ExecutionRecord> {
    return this.manage(intentId, { operation: 'flatten', reason }, requestId)
  }

  private async manage(
    intentId: string,
    payloadInput: ExecutionManagementPayload,
    requestIdInput?: string,
  ): Promise<ExecutionRecord> {
    const parsedPayload = executionManagementPayloadSchema.parse(payloadInput)
    const payload: ExecutionManagementPayload = parsedPayload.operation === 'cancel'
      ? {
          operation: 'cancel',
          provider_order_ids: [...new Set(parsedPayload.provider_order_ids)].sort(),
        }
      : parsedPayload
    const requestId = requestIdInput ?? `management-semantic-${sha256(
      payload.operation === 'flatten' ? { operation: 'flatten' } : payload,
    ).slice(0, 32)}`
    const initial = await this.options.store.get(intentId)
    const initialConnection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(initial.intent.connection_id),
    )
    return this.options.store.withProviderMutationLock(
      this.providerAccountKey(initialConnection),
      `management:${intentId}:${requestId}`,
      () => this.manageWithProviderLock(intentId, payload, requestId),
    )
  }

  private async manageWithProviderLock(
    intentId: string,
    payload: ExecutionManagementPayload,
    requestId: string,
  ): Promise<ExecutionRecord> {
    const record = await this.options.store.get(intentId)
    if (!record.command || !record.claim) {
      throw new ExecutionGatewayError(
        'INVALID_STATE',
        'Management commands require a durably claimed entry command.',
      )
    }
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(record.intent.connection_id),
    )
    const actionDigest = computeManagementActionDigest({
      intent: record.intent,
      connection,
      parentCommandId: record.command.command_id,
      payload,
      requestId,
    })
    if (
      record.management_actions.some(
        (action) => action.command.action_digest === actionDigest,
      )
    ) {
      return record
    }
    this.assertManagementState(record, payload)
    const adapter = this.adapterForRecord(record)
    const capability = managementCapability(payload.operation)
    if (!adapter.descriptor.capabilities[capability]) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        `Adapter cannot perform ${payload.operation}.`,
      )
    }
    await adapter.connect(connection)
    const snapshot = executionAccountSnapshotSchema.parse(
      await adapter.snapshotAccount(connection),
    )
    this.assertAccountSnapshot(connection, snapshot, false)
    let issued: ExecutionManagementCommand | undefined
    const claim = await this.options.store.claimManagement(intentId, actionDigest, (current) => {
      const unsigned = {
        management_command_schema_version: EXECUTION_MANAGEMENT_COMMAND_SCHEMA_VERSION,
        management_command_id: `management-${randomUUID()}`,
        request_id: requestId,
        parent_command_id: current.command!.command_id,
        intent_id: current.intent.intent_id,
        claim_id: current.claim!.claim_id,
        connection_id: connection.connection_id,
        adapter_id: adapter.descriptor.adapter_id,
        adapter_version: adapter.descriptor.adapter_version,
        payload,
        action_digest: actionDigest,
        idempotency_key: sha256({
          parent_command_id: current.command!.command_id,
          action_digest: actionDigest,
        }),
        issued_at: this.now(),
      } satisfies Omit<ExecutionManagementCommand, 'content_checksum'>
      issued = executionManagementCommandSchema.parse({
        ...unsigned,
        content_checksum: computeManagementCommandChecksum(unsigned),
      })
      current.management_actions.push({ command: issued })
      if (
        (payload.operation === 'partial-close' || payload.operation === 'flatten')
        && current.state !== 'closing'
      ) {
        transition(current, 'closing', `${payload.operation} command persisted before provider I/O.`, this.now())
      }
      return current
    })
    if (!claim.claimed || !issued) return claim.record

    let acknowledgment: ExecutionManagementAcknowledgment
    try {
      acknowledgment = parseVerifiedManagementAcknowledgment(await adapter.manage({
        connection,
        intent: record.intent,
        command: record.command,
        managementCommand: issued,
      }))
    } catch (error) {
      if (error instanceof ExecutionAdapterError && error.submissionMayHaveOccurred) {
        acknowledgment = buildManagementAcknowledgment({
          management_ack_schema_version: EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
          management_command_id: issued.management_command_id,
          status: 'unknown',
          provider_command_ids: [],
          evidence_refs: [],
          acknowledged_at: this.now(),
          message: error.message,
        })
      } else if (error instanceof ExecutionGatewayError) {
        acknowledgment = buildManagementAcknowledgment({
          management_ack_schema_version: EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
          management_command_id: issued.management_command_id,
          status: 'rejected',
          provider_command_ids: [],
          evidence_refs: [],
          acknowledged_at: this.now(),
          message: error instanceof Error ? error.message : 'Management command failed before delivery.',
        })
      } else {
        acknowledgment = buildManagementAcknowledgment({
          management_ack_schema_version: EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
          management_command_id: issued.management_command_id,
          status: 'unknown',
          provider_command_ids: [],
          evidence_refs: [],
          acknowledged_at: this.now(),
          message: error instanceof Error ? error.message : 'Management result is uncertain.',
        })
      }
    }
    if (acknowledgment.management_command_id !== issued.management_command_id) {
      acknowledgment = buildManagementAcknowledgment({
        management_ack_schema_version: EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
        management_command_id: issued.management_command_id,
        status: 'unknown',
        provider_command_ids: [],
        evidence_refs: [],
        acknowledged_at: this.now(),
        message: 'Provider management acknowledgment did not match the command.',
      })
    }
    await this.options.store.update(intentId, (current) => {
      const action = current.management_actions.find(
        (candidate) => candidate.command.management_command_id === issued!.management_command_id,
      )
      if (!action) throw new ExecutionGatewayError('INVALID_STATE', 'Management command journal entry is missing.')
      action.acknowledgment = acknowledgment
      return current
    })
    if (acknowledgment.status === 'rejected') {
      return this.finishManagementHalt(
        intentId,
        connection,
        adapter,
        acknowledgment.message,
      )
    }
    return this.reconcileWithProviderLock(intentId)
  }

  async recoverNonTerminal(): Promise<ExecutionRecoveryResult[]> {
    const records = await this.options.store.list()
    const results: ExecutionRecoveryResult[] = []
    for (const record of records) {
      if (OWNERSHIP_RELEASE_STATES.has(record.state) || record.state === 'approved') {
        await this.releaseOwnershipForRecord(record)
      }
      if (TERMINAL_STATES.has(record.state) || record.state === 'approved') {
        results.push({
          intent_id: record.intent.intent_id,
          initial_state: record.state,
          final_state: record.state,
          outcome: 'skipped',
        })
        continue
      }
      if (record.state === 'claimed' && !record.command) {
        const canceled = await this.options.store.update(record.intent.intent_id, (current) => (
          transition(
            current,
            'canceled',
            'Restart recovery proved no command was persisted before provider I/O.',
            this.now(),
          )
        ))
        await this.releaseOwnershipForRecord(canceled)
        results.push({
          intent_id: record.intent.intent_id,
          initial_state: record.state,
          final_state: canceled.state,
          outcome: 'canceled-before-command',
        })
        continue
      }
      if (!record.command) {
        results.push({
          intent_id: record.intent.intent_id,
          initial_state: record.state,
          final_state: record.state,
          outcome: 'skipped',
        })
        continue
      }
      try {
        if (record.state === 'submitting') {
          await this.options.store.update(record.intent.intent_id, (current) => (
            transition(
              current,
              'submit-unknown',
              'Restart occurred after command persistence; submission is uncertain and will not be retried.',
              this.now(),
            )
          ))
        }
        const recovered = await this.reconcile(record.intent.intent_id)
        results.push({
          intent_id: record.intent.intent_id,
          initial_state: record.state,
          final_state: recovered.state,
          outcome: 'reconciled',
        })
      } catch (error) {
        results.push({
          intent_id: record.intent.intent_id,
          initial_state: record.state,
          outcome: 'halted',
          error: error instanceof Error ? error.message : 'Unknown recovery failure.',
        })
      }
    }
    return results
  }

  async setGlobalKill(enabled: boolean): Promise<void> {
    await this.options.store.setGlobalKill(enabled)
  }

  async commitPaperActivationRelease(input: {
    release_id: string
    state_checksum: string
    expected_control_checksum: string
    review_expires_at: string
    connection_ids: string[]
    assert_release_current: () => Promise<void>
    persist_release_evidence: (snapshots: ExecutionAccountSnapshot[]) => Promise<{
      release_event_id: string
      release_event_checksum: string
    }>
  }): Promise<ExecutionAccountSnapshot[]> {
    if (this.emergencyHalted) {
      throw new ExecutionGatewayError(
        'KILL_SWITCH_ENABLED',
        'The process-local emergency execution halt is active.',
      )
    }
    if (
      input.connection_ids.length === 0
      || new Set(input.connection_ids).size !== input.connection_ids.length
    ) {
      throw new ExecutionGatewayError(
        'INVALID_STATE',
        'Paper activation requires at least one unique reviewed connection.',
      )
    }
    const targets = await Promise.all(input.connection_ids.map(async (connectionId) => {
      const connection = tradingConnectionSchema.parse(await this.options.resolveConnection(connectionId))
      return {
        connection,
        adapter: this.resolveCertifiedAdapter(connection),
        providerAccountKey: this.providerAccountKey(connection),
      }
    }))
    targets.sort((left, right) => left.providerAccountKey.localeCompare(right.providerAccountKey))
    if (new Set(targets.map((target) => target.providerAccountKey)).size !== targets.length) {
      throw new ExecutionGatewayError(
        'ACCOUNT_MISMATCH',
        'Paper activation cannot review duplicate provider-account identities.',
      )
    }
    const withLocks = async (index: number): Promise<ExecutionAccountSnapshot[]> => {
      const target = targets[index]
      if (!target) {
        const snapshots: ExecutionAccountSnapshot[] = []
        for (const current of targets) {
          snapshots.push(await this.captureFlatAccountSnapshotWithProviderLock(
            current.connection,
            current.adapter,
          ))
        }
        const releaseEvidence = await input.persist_release_evidence(snapshots)
        await input.assert_release_current()
        if (Date.parse(this.now()) >= Date.parse(input.review_expires_at)) {
          throw new ExecutionGatewayError(
            'INTENT_EXPIRED',
            'Paper activation review expired before the atomic control release.',
          )
        }
        if (this.emergencyHalted) {
          throw new ExecutionGatewayError(
            'KILL_SWITCH_ENABLED',
            'The emergency halt activated during paper release review.',
          )
        }
        await this.options.store.commitPaperActivationRelease({
          release_id: input.release_id,
          release_event_id: releaseEvidence.release_event_id,
          release_event_checksum: releaseEvidence.release_event_checksum,
          state_checksum: input.state_checksum,
          expected_control_checksum: input.expected_control_checksum,
          connection_ids: input.connection_ids,
        })
        return snapshots
      }
      return this.options.store.withProviderMutationLock(
        target.providerAccountKey,
        `paper-activation-release:${input.release_id}:${target.connection.connection_id}`,
        () => withLocks(index + 1),
      )
    }
    return withLocks(0)
  }

  async activateEmergencyHalt(): Promise<void> {
    // Set the process-local latch before durable I/O. A storage failure may
    // prevent shutdown, but it cannot leave this process able to submit.
    this.emergencyHalted = true
    await this.options.store.setGlobalKill(true)
  }

  readControl() {
    return this.options.store.readControl()
  }

  async setConnectionKill(connectionId: string, enabled: boolean): Promise<void> {
    await this.options.store.setConnectionKill(connectionId, enabled)
  }

  async setSourceKill(sourceId: string, enabled: boolean): Promise<void> {
    await this.options.store.setSourceKill(sourceId, enabled)
  }

  private async assertExecutionAllowed(
    intent: OrderIntent,
    connection: TradingConnection,
  ): Promise<void> {
    if (this.emergencyHalted) {
      throw new ExecutionGatewayError('KILL_SWITCH_ENABLED', 'Execution is blocked by the emergency halt latch.')
    }
    const control = await this.options.store.readControl()
    if (
      control.global_kill
      || control.connection_kills.includes(connection.connection_id)
      || control.source_kills.includes(intent.source.source_id)
    ) {
      throw new ExecutionGatewayError('KILL_SWITCH_ENABLED', 'Execution is blocked by an active kill switch.')
    }
    if (!connection.enabled || connection.state !== 'ready') {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Trading connection is not ready.')
    }
    if (connection.environment === 'paper') {
      if (!connection.certifications.includes('paper-lifecycle-certified')) {
        throw new ExecutionGatewayError(
          'CERTIFICATION_REQUIRED',
          'Paper lifecycle certification is required.',
        )
      }
    } else {
      if (!connection.certifications.includes('consequential-lifecycle-certified')) {
        throw new ExecutionGatewayError(
          'CERTIFICATION_REQUIRED',
          'Consequential lifecycle certification is required.',
        )
      }
      if (
        !connection.consequential_enabled_until
        || Date.parse(connection.consequential_enabled_until) <= Date.parse(this.now())
      ) {
        throw new ExecutionGatewayError(
          'CERTIFICATION_REQUIRED',
          'Consequential execution enablement is absent or expired.',
        )
      }
    }
  }

  private resolveAdapter(connection: TradingConnection, intent: OrderIntent): ExecutionAdapter {
    const adapter = this.resolveCertifiedAdapter(connection)
    const capability = capabilityForEntry(intent.entry.type)
    if (!adapter.descriptor.capabilities[capability]) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        `Adapter cannot submit ${intent.entry.type} orders.`,
      )
    }
    if (!adapter.descriptor.capabilities.native_bracket) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'This execution slice requires a certified native protective bracket.',
      )
    }
    if (
      intent.protection.exit_legs
      && adapter.descriptor.capabilities.native_multi_bracket !== true
    ) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Multi-leg execution requires an explicitly certified native multi-bracket adapter.',
      )
    }
    return adapter
  }

  private resolveCertifiedAdapter(connection: TradingConnection): ExecutionAdapter {
    const candidates = this.options.adapters
      .filter((adapter) => adapter.supports(connection))
      .filter((adapter) => (
        connection.transport_preference === 'auto'
        || adapter.descriptor.transport === connection.transport_preference
      ))
      .filter((adapter) => {
        const requiredLevel = connection.environment === 'paper'
          ? 'paper-lifecycle-certified'
          : 'consequential-lifecycle-certified'
        return connection.adapter_certifications?.some((certification) => (
          certification.adapter_id === adapter.descriptor.adapter_id
          && certification.adapter_version === adapter.descriptor.adapter_version
          && certification.provider_contract_version
            === adapter.descriptor.provider_contract_version
          && certification.transport === adapter.descriptor.transport
          && certification.capabilities_checksum === sha256(adapter.descriptor.capabilities)
          && certification.levels.includes(requiredLevel)
        )) === true
      })
      .sort((left, right) => transportRank(left.descriptor.transport) - transportRank(right.descriptor.transport))
    const adapter = candidates[0]
    if (!adapter) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'No certified adapter supports this connection.')
    }
    return adapter
  }

  private async captureFlatAccountSnapshotWithProviderLock(
    connection: TradingConnection,
    adapter: ExecutionAdapter,
  ): Promise<ExecutionAccountSnapshot> {
    await adapter.connect(connection)
    const snapshot = executionAccountSnapshotSchema.parse(await adapter.snapshotAccount(connection))
    this.assertAccountSnapshot(connection, snapshot)
    this.assertNoUnownedExposure(snapshot)
    return snapshot
  }

  private adapterForRecord(record: ExecutionRecord): ExecutionAdapter {
    if (!record.command) {
      throw new ExecutionGatewayError('INVALID_STATE', 'Execution command is missing.')
    }
    const adapter = this.options.adapters.find(
      (candidate) => (
        candidate.descriptor.adapter_id === record.command?.adapter_id
        && candidate.descriptor.adapter_version === record.command?.adapter_version
      ),
    )
    if (!adapter) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'The exact adapter version that entered the position is unavailable.',
      )
    }
    return adapter
  }

  private assertManagementState(
    record: ExecutionRecord,
    payload: ExecutionManagementPayload,
  ): void {
    if (payload.operation === 'cancel' || payload.operation === 'modify') {
      ensureState(record, ['acknowledged', 'partially-filled', 'protected'])
      return
    }
    if (payload.operation === 'partial-close') {
      ensureState(record, ['protected'])
      const activeStops = record.receipt?.protection_orders?.filter(
        (order) => order.role === 'stop-loss' && isActiveProtectionOrder(order),
      ) ?? []
      const openQuantity = record.receipt?.open_quantity ?? 0
      if (activeStops.length !== 1 || activeStops[0]!.quantity !== openQuantity) {
        throw new ExecutionGatewayError(
          'RECONCILIATION_DIVERGENCE',
          'Partial close requires one stop sized to the confirmed open position.',
        )
      }
      if (payload.quantity >= openQuantity) {
        throw new ExecutionGatewayError(
          'CAPABILITY_UNAVAILABLE',
          'Partial close quantity must be smaller than the confirmed open quantity; use flatten for a full exit.',
        )
      }
      return
    }
    ensureState(record, [
      'partially-filled',
      'filled',
      'protecting',
      'protected',
      'protection-unknown',
      'closing',
    ])
  }

  private assertRisk(intent: OrderIntent, risk: RiskDecision): void {
    if (risk.intent_id !== intent.intent_id) {
      throw new ExecutionGatewayError('STALE_RISK_DECISION', 'Risk decision does not bind this intent.')
    }
    if (Date.parse(risk.valid_until) <= Date.parse(this.now())) {
      throw new ExecutionGatewayError('STALE_RISK_DECISION', 'Risk decision has expired.', true)
    }
    if (risk.result === 'deny') {
      return
    }
  }

  private assertIntentCurrent(intent: OrderIntent): void {
    if (Date.parse(intent.valid_until) <= Date.parse(this.now())) {
      throw new ExecutionGatewayError('INTENT_EXPIRED', 'Order intent has expired.')
    }
  }

  private assertAuthorization(
    intent: OrderIntent,
    authorization: ExecutionAuthorization,
    actionDigest: string,
  ): void {
    const now = Date.parse(this.now())
    if (authorization.connection_id !== intent.connection_id) {
      throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Authorization targets another connection.')
    }
    if (Date.parse(authorization.expires_at) <= now) {
      throw new ExecutionGatewayError('AUTHORIZATION_EXPIRED', 'Execution authorization has expired.')
    }
    if (
      now < Date.parse(authorization.scope.session_start)
      || now >= Date.parse(authorization.scope.session_end)
    ) {
      throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Intent falls outside the authorized session.')
    }
    if (authorization.mode === 'per-order') {
      if (authorization.intent_id !== intent.intent_id || authorization.action_digest !== actionDigest) {
        throw new ExecutionGatewayError(
          'AUTHORIZATION_MISMATCH',
          'Per-order authorization does not bind the exact action.',
        )
      }
    }
    if (
      !authorization.scope.symbols.includes(intent.instrument.symbol)
      || intent.quantity > authorization.scope.max_contracts
      || !authorization.scope.allowed_sides.includes(intent.side)
      || !authorization.scope.allowed_order_types.includes(intent.entry.type)
    ) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Intent exceeds the authorized symbol, quantity, side, or order-type scope.',
      )
    }
    if (
      Number(authorization.scope.max_daily_loss) <= 0
      || Number(authorization.scope.max_open_risk) <= 0
    ) {
      throw new ExecutionGatewayError(
        'AUTHORIZATION_MISMATCH',
        'Authorization monetary risk limits must be positive.',
      )
    }
  }

  private async verifyNoExposureWithProviderLock(
    intentId: string,
    connection: TradingConnection,
  ): Promise<ExecutionNoExposureProof> {
    const record = await this.options.store.get(intentId)
    const adapter = record.command
      ? this.options.adapters.find((candidate) => (
          candidate.descriptor.adapter_id === record.command?.adapter_id
          && candidate.descriptor.adapter_version === record.command?.adapter_version
          && candidate.supports(connection)
        ))
      : this.resolveAdapter(connection, record.intent)
    if (!adapter) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'The exact adapter needed to prove provider-flat state is unavailable.',
      )
    }
    await adapter.connect(connection)
    const snapshot = executionAccountSnapshotSchema.parse(await adapter.snapshotAccount(connection))
    this.assertAccountSnapshot(connection, snapshot, false)
    this.assertNoUnownedExposure(snapshot)
    const current = await this.options.store.get(intentId)
    const unsigned = {
      proof_schema_version: EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION,
      proof_id: `no-exposure-${sha256({
        intent_id: intentId,
        snapshot_id: snapshot.account_snapshot_id,
        snapshot_checksum: sha256(snapshot),
        record_checksum: sha256(current),
      }).slice(0, 32)}`,
      intent_id: intentId,
      connection_id: connection.connection_id,
      account_ref: connection.account_ref,
      account_snapshot_id: snapshot.account_snapshot_id,
      account_snapshot_checksum: sha256(snapshot),
      execution_record_checksum: sha256(current),
      positions_count: 0 as const,
      working_orders_count: 0 as const,
      captured_at: snapshot.captured_at,
      evidence_refs: [snapshot.account_snapshot_id],
    } satisfies Omit<ExecutionNoExposureProof, 'content_checksum'>
    return executionNoExposureProofSchema.parse({
      ...unsigned,
      content_checksum: sha256(unsigned),
    })
  }

  private assertAccountSnapshot(
    connection: TradingConnection,
    snapshot: ReturnType<typeof executionAccountSnapshotSchema.parse>,
    requireCanTrade = true,
  ): void {
    if (
      snapshot.connection_id !== connection.connection_id
      || snapshot.account_ref !== connection.account_ref
    ) {
      throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'Provider account does not match the connection.')
    }
    if (snapshot.environment !== connection.environment) {
      throw new ExecutionGatewayError('ENVIRONMENT_MISMATCH', 'Provider environment does not match the connection.')
    }
    if (requireCanTrade && !snapshot.can_trade) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Provider reports that the account cannot trade.')
    }
    const age = Date.parse(this.now()) - Date.parse(snapshot.captured_at)
    if (age < 0 || age > this.maxAccountSnapshotAgeMs) {
      throw new ExecutionGatewayError(
        'ACCOUNT_SNAPSHOT_STALE',
        'Provider account snapshot is stale or future-dated.',
        true,
      )
    }
  }

  private assertNoUnownedExposure(
    snapshot: ReturnType<typeof executionAccountSnapshotSchema.parse>,
  ): void {
    if (snapshot.positions.length > 0 || snapshot.working_orders.length > 0) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'New entry requires a provider-flat account with no unowned working orders.',
      )
    }
  }

  private assertMonetaryRisk(
    intent: OrderIntent,
    snapshot: ReturnType<typeof executionAccountSnapshotSchema.parse>,
    authorization: ExecutionAuthorization,
  ): void {
    const contract = resolveFuturesContractIdentity(
      intent.instrument.symbol,
      this.now(),
    )
    if (
      !intent.instrument.expiry
      || contract.expiry !== intent.instrument.expiry
      || contract.active !== true
    ) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Futures execution requires a non-expired symbol whose month/year matches its canonical expiry.',
      )
    }
    const economics = resolveFuturesEconomicSpec(contract.root)
    if (!economics) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        `Futures economic risk is not configured for ${contract.root}.`,
      )
    }
    if (
      intent.instrument.tick_size !== economics.tick_size
      || intent.instrument.point_value_usd !== economics.point_value_usd
    ) {
      throw new ExecutionGatewayError(
        'RISK_DENIED',
        'Intent instrument economics do not match the trusted futures risk specification.',
      )
    }
    if (!intent.max_loss_usd) {
      throw new ExecutionGatewayError(
        'RISK_DENIED',
        'Execution requires a checksum-bound maximum loss in USD.',
      )
    }
    const declaredRisk = Number(intent.max_loss_usd)
    const tickSize = Number(economics.tick_size)
    const pointValue = Number(economics.point_value_usd)
    const entryPrice = intent.entry.type === 'market'
      ? undefined
      : intent.entry.type === 'limit'
        ? Number(intent.entry.price)
        : intent.entry.type === 'stop'
          ? Number(intent.entry.stop_price)
          : Number(intent.entry.limit_price)
    let stopDistance: number
    if (intent.protection.stop_loss.type === 'ticks') {
      stopDistance = Number(intent.protection.stop_loss.value) * tickSize
    } else {
      if (entryPrice === undefined) {
        throw new ExecutionGatewayError(
          'RISK_DENIED',
          'An absolute stop requires a checksum-bound entry price to compute economic risk.',
        )
      }
      const stopPrice = Number(intent.protection.stop_loss.value)
      if (
        (intent.side === 'buy' && stopPrice >= entryPrice)
        || (intent.side === 'sell' && stopPrice <= entryPrice)
      ) {
        throw new ExecutionGatewayError(
          'RISK_DENIED',
          'Stop price must reduce risk on the protective side of the entry.',
        )
      }
      stopDistance = Math.abs(entryPrice - stopPrice)
    }
    const computedRisk = stopDistance * pointValue * intent.quantity
    const effectiveRisk = Math.max(declaredRisk, computedRisk)
    const maxOpenRisk = Number(authorization.scope.max_open_risk)
    const maxDailyLoss = Number(authorization.scope.max_daily_loss)
    const realizedLoss = Math.max(0, -Number(snapshot.realized_pnl))
    if (
      !Number.isFinite(declaredRisk)
      || declaredRisk <= 0
      || !Number.isFinite(computedRisk)
      || computedRisk <= 0
      || declaredRisk + 0.005 < computedRisk
      || effectiveRisk > maxOpenRisk
      || realizedLoss + effectiveRisk > maxDailyLoss
    ) {
      throw new ExecutionGatewayError(
        'RISK_DENIED',
        'Declared trade risk understates computed economic loss or exceeds the authorized risk budget.',
      )
    }
  }

  private providerAccountKey(connection: TradingConnection): string {
    return [
      connection.platform.slug,
      connection.environment,
      connection.account_ref,
    ].join(':')
  }

  private ownershipKey(connection: TradingConnection, _intent: OrderIntent): string {
    // One provider account admits only one unresolved execution at a time.
    // Portfolio-level concurrency requires a real account risk reservation ledger.
    return this.providerAccountKey(connection)
  }

  private async releaseOwnershipForRecord(record: ExecutionRecord): Promise<void> {
    const connection = tradingConnectionSchema.parse(
      await this.options.resolveConnection(record.intent.connection_id),
    )
    const ownershipKey = this.ownershipKey(connection, record.intent)
    const current = await this.options.store.readOwnership(ownershipKey)
    if (!current || current.intent_id !== record.intent.intent_id) return
    await this.options.store.releaseOwnership(ownershipKey, record.intent.intent_id)
  }

  private async finishUncertain(
    intentId: string,
    connection: TradingConnection,
    adapter: ExecutionAdapter,
    reason: string,
  ): Promise<ExecutionRecord> {
    await this.options.store.setConnectionKill(connection.connection_id, true)
    return this.options.store.update(intentId, (record) => {
      transition(record, 'submit-unknown', reason, this.now())
      record.receipt = this.buildReceipt({
        record,
        connection,
        adapter,
        providerOrderIds: [],
        result: 'submit-unknown',
        filledQuantity: 0,
        protectionVerified: false,
        evidenceRefs: [],
      })
      return record
    })
  }

  private async finishReconciliationHalt(
    intentId: string,
    connection: TradingConnection,
    adapter: ExecutionAdapter,
    result: ExecutionReconciliation,
    reason: string,
  ): Promise<ExecutionRecord> {
    await this.options.store.setConnectionKill(connection.connection_id, true)
    return this.options.store.update(intentId, (record) => {
      transition(record, 'reconcile-halted', reason, this.now())
      record.receipt = this.buildReceipt({
        record,
        connection,
        adapter,
        providerOrderIds: result.provider_order_ids,
        result: 'reconcile-halted',
        filledQuantity: result.filled_quantity,
        openQuantity: result.open_quantity,
        averageFillPrice: result.average_fill_price,
        protectionVerified: result.protection_verified,
        protectionOrders: result.protection_orders,
        evidenceRefs: result.evidence_refs,
      })
      return record
    })
  }

  private async finishManagementHalt(
    intentId: string,
    connection: TradingConnection,
    adapter: ExecutionAdapter,
    reason: string,
  ): Promise<ExecutionRecord> {
    await this.options.store.setConnectionKill(connection.connection_id, true)
    return this.options.store.update(intentId, (record) => {
      if (record.state !== 'reconcile-halted') {
        transition(record, 'reconcile-halted', reason, this.now())
      }
      record.receipt = this.buildReceipt({
        record,
        connection,
        adapter,
        providerOrderIds: record.receipt?.provider_order_ids ?? [],
        result: 'reconcile-halted',
        filledQuantity: record.receipt?.filled_quantity ?? 0,
        averageFillPrice: record.receipt?.average_fill_price,
        protectionVerified: false,
        evidenceRefs: record.receipt?.evidence_refs ?? [],
      })
      return record
    })
  }

  private async applyReconciliation(
    intentId: string,
    connection: TradingConnection,
    adapter: ExecutionAdapter,
    result: ExecutionReconciliation,
  ): Promise<ExecutionRecord> {
    if (result.status === 'divergent' || result.status === 'not-found') {
      return this.finishReconciliationHalt(intentId, connection, adapter, result, result.reason)
    }
    if (result.status === 'filled' && !result.protection_verified) {
      await this.options.store.update(intentId, (record) => {
        if (record.state !== 'protection-unknown') {
          if (record.state !== 'filled') transition(record, 'filled', result.reason, this.now())
          transition(record, 'protection-unknown', 'Filled position lacks verified protection.', this.now())
        }
        record.receipt = this.buildReceipt({
          record,
          connection,
          adapter,
          providerOrderIds: result.provider_order_ids,
          result: 'reconcile-halted',
          filledQuantity: result.filled_quantity,
          openQuantity: result.open_quantity,
          averageFillPrice: result.average_fill_price,
          protectionVerified: false,
          protectionOrders: result.protection_orders,
          evidenceRefs: result.evidence_refs,
        })
        return record
      })
      await this.options.store.setConnectionKill(connection.connection_id, true)
      if (!adapter.descriptor.capabilities.flatten) {
        return this.finishManagementHalt(
          intentId,
          connection,
          adapter,
          'Protection failed and the adapter has no certified flatten capability.',
        )
      }
      try {
        const emergencyPayload = executionManagementPayloadSchema.parse({
          operation: 'flatten',
          reason: 'Emergency flatten after required protection could not be verified.',
        })
        const emergencyRequestId = `management-semantic-${sha256({ operation: 'flatten' }).slice(0, 32)}`
        return await this.manageWithProviderLock(intentId, emergencyPayload, emergencyRequestId)
      } catch (error) {
        return this.finishManagementHalt(
          intentId,
          connection,
          adapter,
          error instanceof Error ? error.message : 'Emergency flatten failed.',
        )
      }
    }
    const updated = await this.options.store.update(intentId, (record) => {
      let receiptResult: ExecutionReceipt['result']
      if (result.status === 'working') {
        ensureState(record, ['acknowledged', 'submit-unknown', 'closing'])
        if (record.state === 'submit-unknown') {
          transition(record, 'acknowledged', 'Reconciliation adopted the provider working order.', this.now())
        }
        receiptResult = 'working'
      } else if (result.status === 'partially-filled') {
        transition(record, 'partially-filled', result.reason, this.now())
        receiptResult = 'partially-filled'
      } else if (result.status === 'filled-protected') {
        if (record.state === 'protecting') {
          transition(record, 'protected', 'Provider-native protection is verified.', this.now())
        } else if (record.state === 'closing') {
          transition(record, 'protected', 'Remaining position protection is verified after partial close.', this.now())
        } else if (record.state !== 'protected') {
          if (record.state !== 'filled') transition(record, 'filled', result.reason, this.now())
          transition(record, 'protecting', 'Verifying provider-native protection.', this.now())
          transition(record, 'protected', 'Provider-native protection is verified.', this.now())
        }
        receiptResult = 'filled-protected'
      } else if (result.status === 'closing') {
        if (record.state !== 'closing') transition(record, 'closing', result.reason, this.now())
        receiptResult = 'working'
      } else if (result.status === 'closed') {
        if (record.state !== 'closing') transition(record, 'closing', result.reason, this.now())
        transition(record, 'closed', 'Provider position is flat and no working order can reopen it.', this.now())
        receiptResult = 'closed'
      } else if (result.status === 'canceled') {
        transition(record, 'canceled', result.reason, this.now())
        receiptResult = 'canceled'
      } else {
        receiptResult = 'reconcile-halted'
      }
      record.receipt = this.buildReceipt({
        record,
        connection,
        adapter,
        providerOrderIds: result.provider_order_ids,
        result: receiptResult,
        filledQuantity: result.filled_quantity,
        openQuantity: result.open_quantity,
        averageFillPrice: result.average_fill_price,
        protectionVerified: result.protection_verified,
        protectionOrders: result.protection_orders,
        evidenceRefs: result.evidence_refs,
      })
      return record
    })
    if (updated.state === 'closed' || updated.state === 'canceled') {
      await this.options.store.releaseOwnership(
        this.ownershipKey(connection, updated.intent),
        updated.intent.intent_id,
      )
    }
    return updated
  }

  private buildReceipt(input: {
    record: ExecutionRecord
    connection: TradingConnection
    adapter: ExecutionAdapter
    providerOrderIds: string[]
    result: ExecutionReceipt['result']
    filledQuantity: number
    openQuantity?: number
    averageFillPrice?: string
    protectionVerified: boolean
    protectionOrders?: ExecutionProtectionOrder[]
    evidenceRefs: string[]
  }): ExecutionReceipt {
    const unsigned = {
      receipt_schema_version: EXECUTION_RECEIPT_SCHEMA_VERSION,
      receipt_id: `receipt-${randomUUID()}`,
      trace_id: input.record.trace_id,
      intent_id: input.record.intent.intent_id,
      connection_id: input.connection.connection_id,
      transport: input.adapter.descriptor.transport,
      adapter: {
        id: input.adapter.descriptor.adapter_id,
        version: input.adapter.descriptor.adapter_version,
      },
      provider_order_ids: input.providerOrderIds,
      result: input.result,
      filled_quantity: input.filledQuantity,
      ...(input.openQuantity !== undefined ? { open_quantity: input.openQuantity } : {}),
      ...(input.averageFillPrice ? { average_fill_price: input.averageFillPrice } : {}),
      protection_verified: input.protectionVerified,
      ...(input.protectionOrders ? { protection_orders: input.protectionOrders } : {}),
      evidence_refs: input.evidenceRefs,
      completed_at: this.now(),
    } satisfies Omit<ExecutionReceipt, 'content_checksum'>
    return executionReceiptSchema.parse({
      ...unsigned,
      content_checksum: computeExecutionReceiptChecksum(unsigned),
    })
  }

  private assertState(record: ExecutionRecord, allowed: ExecutionLifecycleState[]): void {
    ensureState(record, allowed)
  }
}

const ensureState = (record: ExecutionRecord, allowed: ExecutionLifecycleState[]): void => {
  if (!allowed.includes(record.state)) {
    throw new ExecutionGatewayError(
      'INVALID_STATE',
      `Execution ${record.intent.intent_id} is ${record.state}; expected ${allowed.join(' or ')}.`,
    )
  }
}

const isActiveProtectionOrder = (order: ExecutionProtectionOrder): boolean => (
  order.status === 'pending'
  || order.status === 'working'
  || order.status === 'partially-filled'
)

const transition = (
  record: ExecutionRecord,
  to: ExecutionLifecycleState,
  reason: string,
  occurredAt: string,
): ExecutionRecord => {
  const from = record.state
  if (from === to) return record
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ExecutionGatewayError(
      'INVALID_STATE',
      `Execution cannot transition from ${from} to ${to}.`,
    )
  }
  record.state = to
  record.updated_at = occurredAt
  record.transitions.push({
    transition_id: `transition-${randomUUID()}`,
    from,
    to,
    occurred_at: occurredAt,
    reason,
  })
  return record
}

const ALLOWED_TRANSITIONS: Record<ExecutionLifecycleState, ExecutionLifecycleState[]> = {
  created: ['risk-denied', 'awaiting-authorization', 'canceled', 'expired', 'error'],
  'risk-denied': [],
  'awaiting-authorization': ['approved', 'expired', 'error'],
  approved: ['claimed', 'canceled', 'expired', 'error'],
  claimed: ['submitting', 'canceled', 'error'],
  submitting: ['acknowledged', 'submit-unknown', 'rejected', 'error'],
  acknowledged: ['partially-filled', 'filled', 'closing', 'reconcile-halted', 'canceled', 'error'],
  'partially-filled': ['filled', 'closing', 'reconcile-halted', 'canceled', 'error'],
  filled: ['protecting', 'protection-unknown', 'closing', 'reconcile-halted', 'error'],
  protecting: ['protected', 'protection-unknown', 'closing', 'reconcile-halted', 'error'],
  protected: ['closing', 'reconcile-halted', 'error'],
  closing: ['protected', 'closed', 'reconcile-halted', 'error'],
  closed: [],
  'submit-unknown': [
    'acknowledged',
    'partially-filled',
    'filled',
    'closing',
    'reconcile-halted',
    'canceled',
    'error',
  ],
  'protection-unknown': ['closing', 'closed', 'reconcile-halted', 'error'],
  'reconcile-halted': [],
  rejected: [],
  canceled: [],
  expired: [],
  error: [],
}

const TERMINAL_STATES = new Set<ExecutionLifecycleState>([
  'risk-denied',
  'closed',
  'reconcile-halted',
  'rejected',
  'canceled',
  'expired',
  'error',
])

const OWNERSHIP_RELEASE_STATES = new Set<ExecutionLifecycleState>([
  'risk-denied',
  'closed',
  'rejected',
  'canceled',
  'expired',
  'error',
])

const transportRank = (transport: 'api' | 'browser'): number => (
  transport === 'api' ? 0 : 1
)

const capabilityForEntry = (
  orderType: OrderIntent['entry']['type'],
): 'submit_market' | 'submit_limit' | 'submit_stop' | 'submit_stop_limit' => {
  if (orderType === 'market') return 'submit_market'
  if (orderType === 'limit') return 'submit_limit'
  if (orderType === 'stop') return 'submit_stop'
  return 'submit_stop_limit'
}

const managementCapability = (
  operation: ExecutionManagementPayload['operation'],
): 'cancel_order' | 'modify_order' | 'partial_close' | 'flatten' => {
  if (operation === 'cancel') return 'cancel_order'
  if (operation === 'modify') return 'modify_order'
  if (operation === 'partial-close') return 'partial_close'
  return 'flatten'
}

const buildManagementAcknowledgment = (
  input: Omit<ExecutionManagementAcknowledgment, 'content_checksum'>,
): ExecutionManagementAcknowledgment => executionManagementAcknowledgmentSchema.parse({
  ...input,
  content_checksum: computeManagementAcknowledgmentChecksum(input),
})

const parseVerifiedManagementAcknowledgment = (
  input: unknown,
): ExecutionManagementAcknowledgment => {
  const acknowledgment = executionManagementAcknowledgmentSchema.parse(input)
  if (
    computeManagementAcknowledgmentChecksum(acknowledgment)
    !== acknowledgment.content_checksum
  ) {
    throw new Error('Management acknowledgment checksum is invalid.')
  }
  return acknowledgment
}
