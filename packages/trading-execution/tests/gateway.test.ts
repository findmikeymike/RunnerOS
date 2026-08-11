import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
  MIRROR_DISPATCH_GRANT_SCHEMA_VERSION,
  EXECUTION_RECONCILIATION_SCHEMA_VERSION,
  EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
  ORDER_INTENT_SCHEMA_VERSION,
  RISK_DECISION_SCHEMA_VERSION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type ExecutionAccountSnapshot,
  type ExecutionAuthorization,
  type ExecutionReconciliation,
  type ExecutionManagementAcknowledgment,
  type ExecutionSubmitAcknowledgment,
  type OrderIntent,
  type MirrorDispatchGrant,
  type RiskDecision,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  ExecutionAdapterError,
  ExecutionGateway,
  ExecutionGatewayError,
  FileExecutionStore,
  computeActionDigest,
  computeExecutionReceiptChecksum,
  computeManagementAcknowledgmentChecksum,
  computeOrderIntentChecksum,
  sha256,
  type ExecutionAdapter,
} from '../src/index.ts'

const NOW = '2026-07-30T15:05:00.000Z'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const capabilities = {
  read_accounts: true,
  read_orders: true,
  read_positions: true,
  read_executions: true,
  submit_market: true,
  submit_limit: true,
  submit_stop: true,
  submit_stop_limit: true,
  native_bracket: true,
  native_oco: true,
  native_multi_bracket: true,
  modify_order: true,
  cancel_order: true,
  partial_close: true,
  flatten: true,
  streaming_events: true,
}

const makeConnection = (
  overrides: Partial<TradingConnection> = {},
): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: 'connection-apex-paper',
  display_name: 'Apex Paper',
  firm: { slug: 'apex', name: 'Apex Trader Funding' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'auto',
  account_ref: 'account-apex-paper',
  account_display: { label: 'APEX-1234', last4: '1234' },
  credential_ref: 'credential-tradovate',
  browser_session_ref: 'session-wealthcharts',
  risk_policy_ref: 'risk-policy-paper',
  authorization_basis_ref: 'authorization-basis-apex',
  approval_policy_ref: 'approval-policy-paper',
  state: 'ready',
  capabilities: { ...capabilities },
  certifications: [
    'read-certified',
    'paper-entry-certified',
    'paper-lifecycle-certified',
  ],
  adapter_certifications: [
    {
      certification_id: 'cert-fake-api',
      adapter_id: 'fake-api',
      adapter_version: '1.0.0',
      provider_contract_version: 'fake-provider@1',
      transport: 'api',
      capabilities_checksum: sha256(capabilities),
      levels: ['paper-lifecycle-certified'],
    },
    {
      certification_id: 'cert-fake-browser',
      adapter_id: 'fake-browser',
      adapter_version: '1.0.0',
      provider_contract_version: 'fake-provider@1',
      transport: 'browser',
      capabilities_checksum: sha256(capabilities),
      levels: ['paper-lifecycle-certified'],
    },
  ],
  enabled: true,
  created_at: '2026-07-30T14:00:00.000Z',
  updated_at: '2026-07-30T14:00:00.000Z',
  ...overrides,
})

const makeIntent = (
  connection: TradingConnection,
  overrides: Partial<Omit<OrderIntent, 'content_checksum'>> = {},
): OrderIntent => {
  const unsigned: Omit<OrderIntent, 'content_checksum'> = {
    intent_schema_version: ORDER_INTENT_SCHEMA_VERSION,
    intent_id: 'intent-es-long-1',
    source: {
      type: 'discord',
      source_id: 'discord-message-123',
      author_id: 'discord-user-456',
    },
    connection_id: connection.connection_id,
    instrument: {
      canonical_id: 'CME:ESU6',
      symbol: 'ESU6',
      exchange: 'XCME',
      expiry: '2026-09',
      tick_size: '0.25',
      point_value_usd: '50',
    },
    side: 'buy',
    quantity: 1,
    entry: { type: 'market' },
    protection: {
      stop_loss: { type: 'ticks', value: '8' },
      take_profit: { type: 'ticks', value: '12' },
    },
    max_loss_usd: '100',
    time_in_force: 'day',
    created_at: '2026-07-30T15:04:00.000Z',
    valid_until: '2026-07-30T15:10:00.000Z',
    ...overrides,
  }
  return { ...unsigned, content_checksum: computeOrderIntentChecksum(unsigned) }
}

class FakeAdapter implements ExecutionAdapter {
  submitCount = 0
  connectCount = 0
  reconciliation: ExecutionReconciliation
  submitError?: Error
  manageError?: Error
  manageCount = 0
  snapshotOverrides: Partial<ExecutionAccountSnapshot> = {}
  reconcileStarted?: () => void
  reconcileGate?: Promise<void>

  readonly descriptor

  constructor(
    transport: 'api' | 'browser' = 'api',
    adapterId = `fake-${transport}`,
  ) {
    this.descriptor = {
      adapter_id: adapterId,
      adapter_version: '1.0.0',
      provider_contract_version: 'fake-provider@1',
      transport,
      capabilities: { ...capabilities },
    }
    this.reconciliation = {
      reconciliation_schema_version: EXECUTION_RECONCILIATION_SCHEMA_VERSION,
      reconciliation_id: 'reconciliation-1',
      command_id: 'pending-command',
      connection_id: 'connection-apex-paper',
      status: 'filled-protected',
      provider_order_ids: ['provider-order-1', 'provider-stop-1'],
      filled_quantity: 1,
      open_quantity: 1,
      average_fill_price: '5600.25',
      protection_verified: true,
      protection_orders: [{
        protection_order_schema_version: 'execution-protection-order@1',
        provider_order_id: 'provider-stop-1',
        role: 'stop-loss',
        quantity: 1,
        order_type: 'stop',
        time_in_force: 'day',
        stop_price: '5598',
        status: 'working',
      }],
      evidence_refs: ['evidence-fill-1'],
      reconciled_at: NOW,
      reason: 'Provider reports a protected fill.',
    }
  }

  supports(): boolean {
    return true
  }

  async connect(): Promise<void> {
    this.connectCount += 1
  }

  async snapshotAccount(connection: TradingConnection): Promise<ExecutionAccountSnapshot> {
    return {
      account_snapshot_schema_version: EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
      account_snapshot_id: 'snapshot-1',
      connection_id: connection.connection_id,
      account_ref: connection.account_ref,
      environment: connection.environment,
      captured_at: NOW,
      can_trade: true,
      balance: '50000',
      realized_pnl: '0',
      open_pnl: '0',
      positions: [],
      working_orders: [],
      ...this.snapshotOverrides,
    }
  }

  async submit(input: Parameters<ExecutionAdapter['submit']>[0]): Promise<ExecutionSubmitAcknowledgment> {
    this.submitCount += 1
    if (this.submitError) throw this.submitError
    return {
      submit_ack_schema_version: EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
      command_id: input.command.command_id,
      status: 'acknowledged',
      provider_order_ids: ['provider-order-1'],
      acknowledged_at: NOW,
    }
  }

  async manage(
    input: Parameters<ExecutionAdapter['manage']>[0],
  ): Promise<ExecutionManagementAcknowledgment> {
    this.manageCount += 1
    if (this.manageError) throw this.manageError
    if (input.managementCommand.payload.operation === 'flatten') {
      this.reconciliation = {
        ...this.reconciliation,
        status: 'closed',
        open_quantity: 0,
        protection_verified: false,
        reason: 'Fake provider is flat after emergency liquidation.',
      }
    } else if (input.managementCommand.payload.operation === 'partial-close') {
      const remaining = Math.max(
        0,
        (this.reconciliation.open_quantity ?? 0) - input.managementCommand.payload.quantity,
      )
      this.reconciliation = {
        ...this.reconciliation,
        open_quantity: remaining,
        protection_verified: remaining > 0,
        protection_orders: this.reconciliation.protection_orders?.map((order) => ({
          ...order,
          quantity: remaining,
        })),
        reason: 'Fake provider reduced and re-protected the position.',
      }
    }
    const unsigned = {
      management_ack_schema_version: EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
      management_command_id: input.managementCommand.management_command_id,
      status: 'acknowledged',
      provider_command_ids: [`provider-${input.managementCommand.payload.operation}-1`],
      evidence_refs: [`evidence-${input.managementCommand.payload.operation}-1`],
      acknowledged_at: NOW,
      message: 'Fake provider acknowledged management command.',
    } satisfies Omit<ExecutionManagementAcknowledgment, 'content_checksum'>
    return {
      ...unsigned,
      content_checksum: computeManagementAcknowledgmentChecksum(unsigned),
    }
  }

  async reconcile(input: Parameters<ExecutionAdapter['reconcile']>[0]) {
    this.reconcileStarted?.()
    await this.reconcileGate
    return {
      ...this.reconciliation,
      command_id: input.command.command_id,
      connection_id: input.connection.connection_id,
    }
  }
}

const setup = async (
  connection = makeConnection(),
  adapters: ExecutionAdapter[] = [new FakeAdapter()],
  resolveMirrorDispatchGrant?: (grantId: string) => Promise<MirrorDispatchGrant>,
  allowFakeMirrorDispatch = Boolean(resolveMirrorDispatchGrant),
) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-god-execution-'))
  roots.push(root)
  const store = new FileExecutionStore(root, () => NOW)
  await store.setGlobalKill(false)
  const gateway = new ExecutionGateway({
    store,
    adapters,
    resolveConnection: async () => connection,
    ...(resolveMirrorDispatchGrant ? { resolveMirrorDispatchGrant } : {}),
    allowFakeMirrorDispatch,
    now: () => NOW,
  })
  return { root, store, gateway, connection }
}

const authorizationFor = (
  connection: TradingConnection,
  intent: OrderIntent,
): ExecutionAuthorization => ({
    authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: `authorization-${intent.intent_id}`,
    connection_id: connection.connection_id,
    mode: 'per-order' as const,
    intent_id: intent.intent_id,
    action_digest: computeActionDigest(intent, connection),
    scope: {
      symbols: [intent.instrument.symbol],
      max_contracts: intent.quantity,
      allowed_sides: [intent.side],
      allowed_order_types: [intent.entry.type],
      session_start: '2026-07-30T15:00:00.000Z',
      session_end: '2026-07-30T16:00:00.000Z',
      max_daily_loss: '500',
      max_open_risk: '200',
    },
    issued_by: 'operator-michael',
    issued_at: NOW,
    expires_at: '2026-07-30T15:09:00.000Z',
  })

const approve = async (
  gateway: ExecutionGateway,
  connection: TradingConnection,
  intent: OrderIntent,
) => {
  const risk: RiskDecision = {
    risk_decision_schema_version: RISK_DECISION_SCHEMA_VERSION,
    decision_id: `risk-${intent.intent_id}`,
    intent_id: intent.intent_id,
    account_snapshot_id: 'snapshot-1',
    risk_policy_version: '1.0.0',
    result: 'allow' as const,
    reasons: ['Intent is within the paper risk envelope.'],
    evaluated_at: NOW,
    valid_until: '2026-07-30T15:09:00.000Z',
  }
  const authorization = authorizationFor(connection, intent)
  await gateway.registerIntent(intent)
  return gateway.approve(intent.intent_id, risk, authorization)
}

describe('execution gateway', () => {
  test('re-latches global halt whenever the installed adapter contract changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-adapter-binding-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)
    const tradovate = {
      adapter_id: 'tradovate-api', adapter_version: '1.0.0',
      provider_contract_version: 'tradovate-demo-rest-2026-07', transport: 'api',
    }

    expect((await store.bindAdapterSet([])).changed).toBe(true)
    await store.setGlobalKill(false)
    expect((await store.bindAdapterSet([])).changed).toBe(false)
    expect((await store.readControl()).global_kill).toBe(false)
    expect((await store.bindAdapterSet([tradovate])).changed).toBe(true)
    expect((await store.readControl()).global_kill).toBe(true)
    await store.setGlobalKill(false)
    expect((await store.bindAdapterSet([{
      ...tradovate,
      capabilities: { ...capabilities, native_multi_bracket: false },
    }])).changed).toBe(true)
    expect((await store.readControl()).global_kill).toBe(true)
  })

  test('keeps changed adapters quarantined across every restart while work is nonterminal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-adapter-quarantine-'))
    roots.push(root)
    const first = new FileExecutionStore(root, () => NOW)
    await first.bindAdapterSet([])
    const target = makeConnection()
    await first.create(makeIntent(target), 'trace-adapter-quarantine')
    const tradovate = [{
      adapter_id: 'tradovate-api', adapter_version: '1.0.0',
      provider_contract_version: 'tradovate-demo-rest-2026-07', transport: 'api',
    }]

    await expect(first.bindAdapterSet(tradovate)).rejects.toThrow('operator recovery review')
    const restarted = new FileExecutionStore(root, () => NOW)
    await expect(restarted.bindAdapterSet(tradovate)).rejects.toThrow('operator recovery review')
    expect((await restarted.readControl()).global_kill).toBe(true)
  })

  test('starts with the persistent global execution halt enabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-execution-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)

    expect(await store.readControl()).toMatchObject({ global_kill: true })
  })

  test('requires a fresh gateway-resolved parent grant for every Mirror child submit', async () => {
    const adapter = new FakeAdapter()
    let grant: MirrorDispatchGrant | undefined
    const { gateway, connection } = await setup(
      makeConnection(),
      [adapter],
      async (grantId) => {
        if (!grant || grant.grant_id !== grantId) throw new Error('missing grant')
        return grant
      },
    )
    const intent = makeIntent(connection, {
      intent_id: 'intent-mirror-grant-one',
      mirror_lineage: {
        mirror_execution_id: 'mirror-parent-one',
        mirror_group_id: 'mirror-group-one',
        mirror_group_revision: 1,
        member_id: 'mirror-member-one',
        mirror_child_source_id: 'mirror-child-source-one',
        mirror_child_source_checksum: 'a'.repeat(64),
      },
    })
    await approve(gateway, connection, intent)
    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'AUTHORIZATION_MISMATCH',
    })
    expect(adapter.submitCount).toBe(0)
    const grantFor = (overrides: Partial<Omit<MirrorDispatchGrant, 'content_checksum'>> = {}) => {
      const unsigned: Omit<MirrorDispatchGrant, 'content_checksum'> = {
      mirror_dispatch_grant_schema_version: MIRROR_DISPATCH_GRANT_SCHEMA_VERSION,
      grant_id: 'mirror-grant-one', mirror_execution_id: 'mirror-parent-one',
      intent_id: intent.intent_id, connection_id: connection.connection_id,
      admitted_parent_checksum: 'b'.repeat(64), complete_child_set_checksum: 'c'.repeat(64),
      reservation_id: 'mirror-reservation-one', reservation_checksum: 'e'.repeat(64),
      projection_set_checksum: 'f'.repeat(64), dispatch_authority: 'fake-provider-test-only',
      issued_at: NOW, expires_at: '2026-07-30T15:06:00.000Z',
        ...overrides,
      }
      return { ...unsigned, content_checksum: sha256(unsigned) }
    }
    grant = grantFor({ connection_id: 'wrong-connection' })
    await expect(gateway.execute(intent.intent_id, grant.grant_id)).rejects.toMatchObject({
      code: 'AUTHORIZATION_MISMATCH',
    })
    expect(adapter.submitCount).toBe(0)
    grant = grantFor({
      issued_at: '2026-07-30T15:04:00.000Z',
      expires_at: '2026-07-30T15:05:00.000Z',
    })
    await expect(gateway.execute(intent.intent_id, grant.grant_id)).rejects.toMatchObject({
      code: 'INTENT_EXPIRED',
    })
    expect(adapter.submitCount).toBe(0)
    grant = { ...grantFor(), content_checksum: 'd'.repeat(64) }
    await expect(gateway.execute(intent.intent_id, grant.grant_id)).rejects.toMatchObject({
      code: 'RECORD_INTEGRITY_FAILURE',
    })
    expect(adapter.submitCount).toBe(0)
    grant = grantFor()
    expect((await gateway.execute(intent.intent_id, grant.grant_id)).state).toBe('protected')
    expect(adapter.submitCount).toBe(1)
  })

  test('refuses fake-only Mirror grants unless the gateway explicitly enables test dispatch', async () => {
    const adapter = new FakeAdapter()
    let grant!: MirrorDispatchGrant
    const { gateway, connection } = await setup(
      makeConnection(),
      [adapter],
      async () => grant,
      false,
    )
    const intent = makeIntent(connection, {
      intent_id: 'intent-mirror-fake-only',
      mirror_lineage: {
        mirror_execution_id: 'mirror-parent-fake-only', mirror_group_id: 'mirror-group-one',
        mirror_group_revision: 1, member_id: 'mirror-member-one',
        mirror_child_source_id: 'mirror-child-source-one',
        mirror_child_source_checksum: 'a'.repeat(64),
      },
    })
    await approve(gateway, connection, intent)
    const unsigned: Omit<MirrorDispatchGrant, 'content_checksum'> = {
      mirror_dispatch_grant_schema_version: MIRROR_DISPATCH_GRANT_SCHEMA_VERSION,
      grant_id: 'mirror-grant-fake-only', mirror_execution_id: 'mirror-parent-fake-only',
      intent_id: intent.intent_id, connection_id: connection.connection_id,
      admitted_parent_checksum: 'b'.repeat(64), complete_child_set_checksum: 'c'.repeat(64),
      reservation_id: 'mirror-reservation-one', reservation_checksum: 'e'.repeat(64),
      projection_set_checksum: 'f'.repeat(64), dispatch_authority: 'fake-provider-test-only',
      issued_at: NOW, expires_at: '2026-07-30T15:06:00.000Z',
    }
    grant = { ...unsigned, content_checksum: sha256(unsigned) }

    await expect(gateway.execute(intent.intent_id, grant.grant_id)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    })
    expect(adapter.submitCount).toBe(0)
  })

  test('holds every Mirror ownership lease before the fresh all-child provider barrier', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-mirror-barrier-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)
    await store.setGlobalKill(false)
    const left = makeConnection({
      connection_id: 'connection-mirror-left', account_ref: 'account-mirror-left',
    })
    const right = makeConnection({
      connection_id: 'connection-mirror-right', account_ref: 'account-mirror-right',
    })
    const connections = new Map([[left.connection_id, left], [right.connection_id, right]])
    const adapter = new FakeAdapter()
    const gateway = new ExecutionGateway({
      store, adapters: [adapter], now: () => NOW,
      resolveConnection: async (id) => connections.get(id)!,
    })
    const intents = [left, right].map((connection, index) => makeIntent(connection, {
      intent_id: `intent-mirror-barrier-${index}`,
      mirror_lineage: {
        mirror_execution_id: 'mirror-parent-barrier', mirror_group_id: 'mirror-group-barrier',
        mirror_group_revision: 1, member_id: `mirror-member-${index}`,
        mirror_child_source_id: `mirror-child-source-${index}`,
        mirror_child_source_checksum: `${index + 1}`.repeat(64),
      },
    }))
    for (const intent of intents) await approve(gateway, connections.get(intent.connection_id)!, intent)

    await gateway.reserveMirrorOwnership(intents.map((intent) => intent.intent_id))
    await gateway.revalidateMirrorAdmission(intents.map((intent) => intent.intent_id))
    expect(adapter.connectCount).toBe(2)
    adapter.snapshotOverrides = {
      positions: [{
        instrument_id: 'CME:NQU6', symbol: 'NQU6', side: 'buy',
        quantity: 1, average_price: '20000',
      }],
    }
    await expect(gateway.revalidateMirrorAdmission(
      intents.map((intent) => intent.intent_id),
    )).rejects.toMatchObject({ code: 'RECONCILIATION_DIVERGENCE' })
    expect(adapter.submitCount).toBe(0)
  })

  test('proves every Mirror account flat while holding provider locks, then releases ownership', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-mirror-release-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)
    await store.setGlobalKill(false)
    const left = makeConnection({ connection_id: 'connection-release-left', account_ref: 'account-release-left' })
    const right = makeConnection({ connection_id: 'connection-release-right', account_ref: 'account-release-right' })
    const connections = new Map([[left.connection_id, left], [right.connection_id, right]])
    const adapter = new FakeAdapter()
    const gateway = new ExecutionGateway({
      store, adapters: [adapter], now: () => NOW,
      resolveConnection: async (id) => connections.get(id)!,
    })
    const intents = [left, right].map((connection, index) => makeIntent(connection, {
      intent_id: `intent-mirror-release-${index}`,
      mirror_lineage: {
        mirror_execution_id: 'mirror-parent-release', mirror_group_id: 'mirror-group-release',
        mirror_group_revision: 1, member_id: `mirror-release-member-${index}`,
        mirror_child_source_id: `mirror-release-source-${index}`,
        mirror_child_source_checksum: `${index + 7}`.repeat(64),
      },
    }))
    for (const intent of intents) await approve(gateway, connections.get(intent.connection_id)!, intent)
    const ids = intents.map((intent) => intent.intent_id)
    await gateway.reserveMirrorOwnership(ids)

    const preparedProofs = await Promise.all(ids.map((intentId) => gateway.verifyNoExposure(intentId)))
    const prepared = await store.prepareMirrorOwnershipRelease({
      mirror_execution_id: 'mirror-parent-release',
      intent_ids: [...ids].sort(),
      proofs: [...preparedProofs].sort((left, right) => left.intent_id.localeCompare(right.intent_id)),
    })

    adapter.snapshotOverrides = {
      positions: [{
        instrument_id: 'CME:ESU6', symbol: 'ESU6', side: 'buy', quantity: 1, average_price: '5600',
      }],
    }
    await expect(gateway.proveAndReleaseMirrorOwnership(ids)).rejects.toMatchObject({
      code: 'RECONCILIATION_DIVERGENCE',
    })
    expect((await store.getMirrorOwnershipRelease('mirror-parent-release'))?.state).toBe('prepared')
    adapter.snapshotOverrides = {}

    const ownershipDirectory = path.join(root, 'ownership')
    const leaseFiles = (await readdir(ownershipDirectory)).filter((file) => (
      file.endsWith('.json') && !file.startsWith('_')
    ))
    await unlink(path.join(ownershipDirectory, leaseFiles[0]!))
    await writeFile(path.join(ownershipDirectory, '_ownership-set.lock.json'), JSON.stringify({
      ownership_set_lock_schema_version: 'ownership-set-lock@1',
      process_id: 2_147_483_647,
      operation_id: 'crashed-partial-release',
      leases: [],
      acquired_at: NOW,
    }))
    await store.recoverStaleLocks()

    const journal = await gateway.proveAndReleaseMirrorOwnership(ids)
    const proofs = journal.proofs

    expect(journal.state).toBe('released')
    expect(journal.journal_id).toBe(prepared.journal_id)
    expect(journal.proofs).toEqual(prepared.proofs)
    expect(proofs.map((proof) => proof.intent_id).sort()).toEqual([...ids].sort())
    expect(proofs.every((proof) => proof.positions_count === 0 && proof.working_orders_count === 0)).toBe(true)
    expect((await store.getMirrorOwnershipRelease('mirror-parent-release'))?.content_checksum)
      .toBe(journal.content_checksum)

    const nextIntents = [left, right].map((connection, index) => makeIntent(connection, {
      intent_id: `intent-mirror-next-${index}`,
      mirror_lineage: {
        mirror_execution_id: 'mirror-parent-next', mirror_group_id: 'mirror-group-release',
        mirror_group_revision: 1, member_id: `mirror-next-member-${index}`,
        mirror_child_source_id: `mirror-next-source-${index}`,
        mirror_child_source_checksum: (index === 0 ? '9' : 'a').repeat(64),
      },
    }))
    for (const intent of nextIntents) await approve(gateway, connections.get(intent.connection_id)!, intent)
    const nextIds = nextIntents.map((intent) => intent.intent_id)
    await gateway.reserveMirrorOwnership(nextIds)
    expect(await gateway.proveAndReleaseMirrorOwnership(ids)).toEqual(journal)
    const restartedWithoutConnections = new ExecutionGateway({
      store, adapters: [adapter], now: () => NOW,
      resolveConnection: async () => { throw new Error('Connection was archived after release.') },
    })
    expect(await restartedWithoutConnections.proveAndReleaseMirrorOwnership(ids)).toEqual(journal)
    await expect(gateway.reserveMirrorOwnership(nextIds)).resolves.toBeUndefined()
  })

  test('persists one paper lifecycle through a protected fill and valid receipt', async () => {
    const adapter = new FakeAdapter()
    const { root, store, gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    const result = await gateway.execute(intent.intent_id)

    expect(result.state).toBe('protected')
    expect(adapter.submitCount).toBe(1)
    expect(result.command?.adapter_id).toBe('fake-api')
    expect(result.receipt?.result).toBe('filled-protected')
    if (!result.receipt) throw new Error('Expected execution receipt.')
    expect(computeExecutionReceiptChecksum(result.receipt)).toBe(result.receipt.content_checksum)

    const reloaded = await new FileExecutionStore(root, () => NOW).get(intent.intent_id)
    expect(reloaded.state).toBe('protected')
    expect(reloaded.command?.idempotency_key).toBe(result.command?.idempotency_key)
  })

  test('issues a provider-bound deterministic risk decision before approval', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection, { intent_id: 'intent-provider-risk' })
    await gateway.registerIntent(intent)

    const approved = await gateway.evaluateAndApprove(
      intent.intent_id,
      authorizationFor(connection, intent),
    )
    expect(approved).toMatchObject({
      state: 'approved',
      risk_decision: { result: 'allow', account_snapshot_id: 'snapshot-1' },
    })
    expect((await gateway.execute(intent.intent_id)).state).toBe('protected')
  })

  test('persists a provider-bound denial when deterministic loss exceeds authorization', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection, {
      intent_id: 'intent-provider-risk-denied',
      max_loss_usd: '250',
    })
    await gateway.registerIntent(intent)

    const denied = await gateway.evaluateAndApprove(
      intent.intent_id,
      authorizationFor(connection, intent),
    )
    expect(denied).toMatchObject({ state: 'risk-denied', risk_decision: { result: 'deny' } })
    expect(adapter.submitCount).toBe(0)
  })

  test('denies an upstream ticket that understates independently computed futures loss', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection, {
      intent_id: 'intent-underreported-risk',
      max_loss_usd: '1',
    })
    await gateway.registerIntent(intent)

    const denied = await gateway.evaluateAndApprove(
      intent.intent_id,
      authorizationFor(connection, intent),
    )

    expect(denied).toMatchObject({ state: 'risk-denied', risk_decision: { result: 'deny' } })
    expect(denied.risk_decision?.reasons[0]).toContain('understates computed economic loss')
    expect(adapter.submitCount).toBe(0)
  })

  test('persists one flatten command before I/O and suppresses a concurrent duplicate', async () => {
    const adapter = new FakeAdapter()
    const { root, store, gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    expect((await gateway.execute(intent.intent_id)).state).toBe('protected')
    const secondGateway = new ExecutionGateway({
      store: new FileExecutionStore(root, () => NOW),
      adapters: [adapter],
      resolveConnection: async () => connection,
      now: () => NOW,
    })

    const outcomes = await Promise.all([
      gateway.flatten(intent.intent_id, 'Operator requested flat.'),
      secondGateway.flatten(intent.intent_id, 'Same flatten, differently worded.'),
    ])

    expect(adapter.manageCount).toBe(1)
    expect(outcomes.some((record) => record.state === 'closed')).toBe(true)
    const final = await gateway.get(intent.intent_id)
    expect(final.state).toBe('closed')
    expect(final.management_actions).toHaveLength(1)
    expect(final.management_actions[0]).toMatchObject({
      command: { payload: { operation: 'flatten' } },
      acknowledgment: { status: 'acknowledged' },
    })
    expect((await gateway.flatten(intent.intent_id, 'Retry after completion.')).state).toBe('closed')
    expect(adapter.manageCount).toBe(1)
  })

  test('prepares breakeven only from the single reconciled provider stop', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    await gateway.execute(intent.intent_id)

    expect(await gateway.prepareStopMove(intent.intent_id, 'breakeven')).toEqual({
      provider_order_id: 'provider-stop-1',
      quantity: 1,
      order_type: 'stop',
      stop_price: '5600.25',
      time_in_force: 'day',
    })
    await expect(gateway.prepareStopMove(intent.intent_id, '5597.75')).rejects.toMatchObject({
      code: 'RISK_DENIED',
    })

    adapter.reconciliation = {
      ...adapter.reconciliation,
      protection_orders: [
        ...adapter.reconciliation.protection_orders!,
        {
          ...adapter.reconciliation.protection_orders![0]!,
          provider_order_id: 'provider-stop-2',
        },
      ],
    }
    await expect(gateway.reconcile(intent.intent_id)).rejects.toThrow(
      'Filled-protected reconciliation requires one stop sized to the confirmed open position',
    )
  })

  test('distinguishes two requested partial closes while replaying each exactly once', async () => {
    const adapter = new FakeAdapter()
    adapter.reconciliation = {
      ...adapter.reconciliation,
      filled_quantity: 3,
      open_quantity: 3,
      protection_orders: adapter.reconciliation.protection_orders?.map((order) => ({
        ...order,
        quantity: 3,
      })),
    }
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection, {
      quantity: 3,
      protection: {
        stop_loss: { type: 'ticks', value: '4' },
        take_profit: { type: 'ticks', value: '12' },
      },
      max_loss_usd: '150',
    })
    await approve(gateway, connection, intent)
    expect((await gateway.execute(intent.intent_id)).state).toBe('protected')

    await gateway.closePosition(intent.intent_id, 1, 'discord-partial-one')
    await gateway.closePosition(intent.intent_id, 1, 'discord-partial-one')
    const final = await gateway.closePosition(intent.intent_id, 1, 'discord-partial-two')

    expect(adapter.manageCount).toBe(2)
    expect(final.receipt?.open_quantity).toBe(1)
    expect(final.management_actions.map(({ command }) => command.request_id))
      .toEqual(['discord-partial-one', 'discord-partial-two'])
  })

  test('kills new entry and automatically flattens an unprotected fill', async () => {
    const adapter = new FakeAdapter()
    adapter.reconciliation = {
      ...adapter.reconciliation,
      status: 'filled',
      protection_verified: false,
      reason: 'Provider reports a fill without a working stop.',
    }
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    const result = await gateway.execute(intent.intent_id)

    expect(result.state).toBe('closed')
    expect(adapter.submitCount).toBe(1)
    expect(adapter.manageCount).toBe(1)
    expect(result.management_actions[0]?.command.payload.operation).toBe('flatten')
    expect((await store.readControl()).connection_kills).toContain(connection.connection_id)
  })

  test('auto selects API before browser and never submits through both', async () => {
    const browser = new FakeAdapter('browser')
    const api = new FakeAdapter('api')
    const connection = makeConnection({ transport_preference: 'auto' })
    const { gateway } = await setup(connection, [browser, api])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await gateway.execute(intent.intent_id)

    expect(api.submitCount).toBe(1)
    expect(browser.submitCount).toBe(0)
  })

  test('blocks multi-leg intents unless the exact adapter advertises native multi-bracket', async () => {
    const adapter = new FakeAdapter()
    adapter.descriptor.capabilities.native_multi_bracket = false
    const certifiedWithoutMultiBracket = makeConnection({
      adapter_certifications: [{
        certification_id: 'cert-fake-api-no-multi',
        adapter_id: 'fake-api',
        adapter_version: '1.0.0',
        provider_contract_version: 'fake-provider@1',
        transport: 'api',
        capabilities_checksum: sha256(adapter.descriptor.capabilities),
        levels: ['paper-lifecycle-certified'],
      }],
    })
    const { gateway, connection } = await setup(certifiedWithoutMultiBracket, [adapter])
    const intent = makeIntent(connection, {
      quantity: 2,
      protection: {
        stop_loss: { type: 'ticks', value: '4' },
        exit_legs: [
          { leg_id: 'tp-one', quantity: 1, take_profit: { type: 'ticks', value: '8' } },
          { leg_id: 'tp-two', quantity: 1, take_profit: { type: 'ticks', value: '12' } },
        ],
      },
      max_loss_usd: '100',
    })
    await approve(gateway, connection, intent)
    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    })
    expect(adapter.submitCount).toBe(0)
  })

  test('does not inherit certification after an adapter capability change', async () => {
    const adapter = new FakeAdapter()
    adapter.descriptor.capabilities.native_multi_bracket = false
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'CONNECTION_UNAVAILABLE',
    })
    expect(adapter.submitCount).toBe(0)
  })

  test('does not inherit certification from another adapter version', async () => {
    const adapter = new FakeAdapter()
    const connection = makeConnection({
      adapter_certifications: [{
        certification_id: 'cert-old-api',
        adapter_id: 'fake-api',
        adapter_version: '0.9.0',
        provider_contract_version: 'fake-provider@1',
        transport: 'api',
        capabilities_checksum: sha256(capabilities),
        levels: ['paper-lifecycle-certified'],
      }],
    })
    const { gateway } = await setup(connection, [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'CONNECTION_UNAVAILABLE',
    })
    expect(adapter.submitCount).toBe(0)
  })

  test('atomically permits only one submit under concurrent execution', async () => {
    const adapter = new FakeAdapter()
    const { root, gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    const secondGateway = new ExecutionGateway({
      store: new FileExecutionStore(root, () => NOW),
      adapters: [adapter],
      resolveConnection: async () => connection,
      now: () => NOW,
    })

    const outcomes = await Promise.allSettled([
      gateway.execute(intent.intent_id),
      secondGateway.execute(intent.intent_id),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(adapter.submitCount).toBe(1)
  })

  test('blocks a killed source before claim and leaves the approved intent retryable', async () => {
    const adapter = new FakeAdapter()
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    await gateway.setSourceKill(intent.source.source_id, true)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'KILL_SWITCH_ENABLED',
    })
    expect((await store.get(intent.intent_id)).state).toBe('approved')
    expect(adapter.connectCount).toBe(0)
    expect(adapter.submitCount).toBe(0)
  })

  test('recovers a management claim marker left by a dead process before journaling', async () => {
    const { root, store, gateway, connection } = await setup()
    const intent = makeIntent(connection)
    await gateway.registerIntent(intent)
    const actionDigest = 'e'.repeat(64)
    await writeFile(
      path.join(root, 'records', `${intent.intent_id}.management.${actionDigest}.claim.json`),
      `${JSON.stringify({
        intent_id: intent.intent_id,
        action_digest: actionDigest,
        claimed_at: NOW,
        process_id: 2_147_483_647,
      })}\n`,
      'utf8',
    )
    await store.recoverStaleLocks()

    expect(await store.claimManagement(intent.intent_id, actionDigest, (record) => record))
      .toMatchObject({ claimed: true })
  })

  test('recovers an entry claim marker left by a dead process before journaling', async () => {
    const adapter = new FakeAdapter()
    const { root, store, gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    await writeFile(
      path.join(root, 'records', `${intent.intent_id}.claim.json`),
      `${JSON.stringify({
        intent_id: intent.intent_id,
        claim_id: 'claim-from-dead-process',
        claimed_at: NOW,
        process_id: 2_147_483_647,
      })}\n`,
      'utf8',
    )
    await store.recoverStaleLocks()

    expect(await gateway.execute(intent.intent_id)).toMatchObject({ state: 'protected' })
    expect(adapter.submitCount).toBe(1)
  })

  test('never performs concurrent stale takeover of a provider mutation lock', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-stale-provider-lock-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)
    const providerKey = 'tradovate:paper:account-apex-paper'
    const digest = createHash('sha256').update(providerKey, 'utf8').digest('hex')
    const directory = path.join(root, 'provider-mutations')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, `${digest}.lock.json`), JSON.stringify({
      mutation_lock_schema_version: 'provider-mutation-lock@1',
      provider_account_key: providerKey,
      operation_id: 'dead-provider-mutation',
      process_id: 2_147_483_647,
      acquired_at: NOW,
    }))

    const attempts = await Promise.allSettled([
      store.withProviderMutationLock(providerKey, 'contender-a', async () => 'a'),
      store.withProviderMutationLock(providerKey, 'contender-b', async () => 'b'),
    ])
    expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true)

    expect(await store.recoverStaleLocks()).toBe(1)
    await expect(store.withProviderMutationLock(providerKey, 'startup-owner', async () => 'safe'))
      .resolves.toBe('safe')
  })

  test('repairs a crashed app-instance lock even when its PID has been reused', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-reused-pid-lock-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW, 'current-app-instance')
    const providerKey = 'tradovate:paper:account-reused-pid'
    const digest = createHash('sha256').update(providerKey, 'utf8').digest('hex')
    const directory = path.join(root, 'provider-mutations')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, `${digest}.lock.json`), JSON.stringify({
      mutation_lock_schema_version: 'provider-mutation-lock@1',
      provider_account_key: providerKey,
      operation_id: 'crashed-app-mutation',
      process_id: process.pid,
      process_instance_id: 'crashed-app-instance',
      acquired_at: NOW,
    }))

    expect(await store.recoverStaleLocks()).toBe(1)
    await expect(store.withProviderMutationLock(providerKey, 'current-operation', async () => 'safe'))
      .resolves.toBe('safe')
  })

  test('halts an uncertain submit without retry and later adopts broker truth', async () => {
    const adapter = new FakeAdapter()
    adapter.submitError = new ExecutionAdapterError(
      'NETWORK_AFTER_SEND',
      'Connection dropped after bytes may have been sent.',
      true,
    )
    adapter.reconciliation = {
      ...adapter.reconciliation,
      status: 'working',
      filled_quantity: 0,
      open_quantity: 0,
      average_fill_price: undefined,
      protection_verified: false,
      reason: 'Provider reports the original order working.',
    }
    const { root, store, gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    expect((await gateway.execute(intent.intent_id)).state).toBe('submit-unknown')
    expect((await store.readControl()).connection_kills).toContain(connection.connection_id)
    expect(adapter.submitCount).toBe(1)
    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect(adapter.submitCount).toBe(1)
    const restarted = new ExecutionGateway({
      store: new FileExecutionStore(root, () => NOW),
      adapters: [adapter],
      resolveConnection: async () => connection,
      now: () => NOW,
    })
    expect(await restarted.recoverNonTerminal()).toMatchObject([{
      intent_id: intent.intent_id,
      initial_state: 'submit-unknown',
      final_state: 'acknowledged',
      outcome: 'reconciled',
    }])
    expect(adapter.submitCount).toBe(1)
  })

  test('does not claim or submit when the provider account identity is wrong', async () => {
    const adapter = new FakeAdapter()
    adapter.snapshotOverrides = { account_ref: 'wrong-account' }
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' })
    expect((await store.get(intent.intent_id)).state).toBe('approved')
    expect(adapter.submitCount).toBe(0)
  })

  test('does not execute a risk decision against a different provider snapshot', async () => {
    const adapter = new FakeAdapter()
    adapter.snapshotOverrides = { account_snapshot_id: 'snapshot-newer' }
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'STALE_RISK_DECISION',
      retryable: true,
    })
    expect((await store.get(intent.intent_id)).state).toBe('approved')
    expect(adapter.submitCount).toBe(0)
  })

  test('blocks a new entry when provider truth contains unowned exposure', async () => {
    const adapter = new FakeAdapter()
    adapter.snapshotOverrides = {
      positions: [{
        instrument_id: 'tradovate-contract-9001',
        symbol: 'ESU6',
        side: 'buy',
        quantity: 1,
        average_price: '5600',
      }],
    }
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'RECONCILIATION_DIVERGENCE',
    })
    expect((await store.get(intent.intent_id)).state).toBe('approved')
    expect(adapter.submitCount).toBe(0)
  })

  test('enforces checksum-bound trade risk against open and daily loss budgets', async () => {
    const adapter = new FakeAdapter()
    adapter.snapshotOverrides = { realized_pnl: '-450' }
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection, {
      intent_id: 'intent-over-daily-budget',
      max_loss_usd: '100',
    })
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({ code: 'RISK_DENIED' })
    expect((await store.get(intent.intent_id)).state).toBe('approved')
    expect(adapter.submitCount).toBe(0)
  })

  test('refuses futures execution without exact expiry or declared maximum loss', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const noExpiry = makeIntent(connection, {
      intent_id: 'intent-no-expiry',
      instrument: { canonical_id: 'CME:ES', symbol: 'ES', exchange: 'XCME' },
    })
    const noRisk = makeIntent(connection, {
      intent_id: 'intent-no-risk',
      max_loss_usd: undefined,
    })
    const mismatchedExpiry = makeIntent(connection, {
      intent_id: 'intent-mismatched-expiry',
      instrument: {
        canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2027-09',
      },
    })
    await approve(gateway, connection, noExpiry)
    await approve(gateway, connection, noRisk)
    await approve(gateway, connection, mismatchedExpiry)

    await expect(gateway.execute(noExpiry.intent_id)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    })
    await expect(gateway.execute(noRisk.intent_id)).rejects.toMatchObject({ code: 'RISK_DENIED' })
    await expect(gateway.execute(mismatchedExpiry.intent_id)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    })
    expect(adapter.submitCount).toBe(0)
  })

  test('gives one intent durable ownership across duplicate connection records', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-execution-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)
    await store.setGlobalKill(false)
    const firstConnection = makeConnection({ connection_id: 'connection-apex-paper-a' })
    const secondConnection = makeConnection({ connection_id: 'connection-apex-paper-b' })
    const connections = new Map([
      [firstConnection.connection_id, firstConnection],
      [secondConnection.connection_id, secondConnection],
    ])
    const adapter = new FakeAdapter()
    const gateway = new ExecutionGateway({
      store,
      adapters: [adapter],
      resolveConnection: async (connectionId) => connections.get(connectionId)!,
      now: () => NOW,
    })
    const first = makeIntent(firstConnection, { intent_id: 'intent-es-owner-a' })
    const second = makeIntent(secondConnection, { intent_id: 'intent-es-owner-b' })
    await approve(gateway, firstConnection, first)
    await approve(gateway, secondConnection, second)

    expect((await gateway.execute(first.intent_id)).state).toBe('protected')
    await expect(gateway.execute(second.intent_id)).rejects.toMatchObject({
      code: 'EXECUTION_BUSY',
    })
    expect(adapter.submitCount).toBe(1)

    expect((await gateway.flatten(first.intent_id, 'Release provider ownership.')).state).toBe('closed')
    expect((await gateway.execute(second.intent_id)).state).toBe('closed')
    expect(adapter.submitCount).toBe(2)
  })

  test('serializes admission across different instruments on one provider account', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const es = makeIntent(connection, { intent_id: 'intent-account-owner-es' })
    const nq = makeIntent(connection, {
      intent_id: 'intent-account-owner-nq',
      instrument: {
        canonical_id: 'CME:NQU6', symbol: 'NQU6', exchange: 'XCME', expiry: '2026-09',
        tick_size: '0.25', point_value_usd: '20',
      },
    })
    await approve(gateway, connection, es)
    await approve(gateway, connection, nq)

    expect((await gateway.execute(es.intent_id)).state).toBe('protected')
    await expect(gateway.execute(nq.intent_id)).rejects.toMatchObject({ code: 'EXECUTION_BUSY' })
    expect(adapter.submitCount).toBe(1)
  })

  test('restart recovery ignores an old closed record while a newer intent owns the account', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const first = makeIntent(connection, { intent_id: 'intent-old-closed' })
    const second = makeIntent(connection, { intent_id: 'intent-new-live' })
    await approve(gateway, connection, first)
    await approve(gateway, connection, second)
    await gateway.execute(first.intent_id)
    await gateway.flatten(first.intent_id, 'Close first owner.')
    adapter.reconciliation = {
      ...adapter.reconciliation,
      status: 'filled-protected',
      open_quantity: 1,
      protection_verified: true,
      reason: 'New intent is protected.',
    }
    expect((await gateway.execute(second.intent_id)).state).toBe('protected')

    const recovery = await gateway.recoverNonTerminal()
    expect(recovery.find(({ intent_id }) => intent_id === first.intent_id)?.outcome).toBe('skipped')
    expect(recovery.find(({ intent_id }) => intent_id === second.intent_id)?.outcome).toBe('reconciled')
  })

  test('serializes restart emergency reconciliation with concurrent account management', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection, { intent_id: 'intent-recovery-lock' })
    await approve(gateway, connection, intent)
    expect((await gateway.execute(intent.intent_id)).state).toBe('protected')

    adapter.reconciliation = {
      ...adapter.reconciliation,
      status: 'filled',
      protection_verified: false,
      protection_orders: [],
      reason: 'Provider reports an unprotected fill after restart.',
    }
    let releaseReconcile!: () => void
    adapter.reconcileGate = new Promise<void>((resolve) => { releaseReconcile = resolve })
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    adapter.reconcileStarted = markStarted

    const recovery = gateway.recoverNonTerminal()
    await started
    const concurrentFlatten = gateway.flatten(intent.intent_id, 'Concurrent operator flatten.')
    await Promise.resolve()
    expect(adapter.manageCount).toBe(0)
    releaseReconcile()

    const [recoveryResult, flattenResult] = await Promise.allSettled([
      recovery,
      concurrentFlatten,
    ])
    expect(recoveryResult.status).toBe('fulfilled')
    expect(flattenResult.status).toBe('fulfilled')
    expect(adapter.manageCount).toBe(1)
    expect((await gateway.get(intent.intent_id)).state).toBe('closed')
  })

  test('refuses an expired explicit futures contract even when expiry metadata matches', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const expired = makeIntent(connection, {
      intent_id: 'intent-expired-contract',
      instrument: {
        canonical_id: 'CME:ESM6',
        symbol: 'ESM6',
        exchange: 'XCME',
        expiry: '2026-06',
        tick_size: '0.25',
        point_value_usd: '50',
      },
    })
    await approve(gateway, connection, expired)

    await expect(gateway.execute(expired.intent_id)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    })
    expect(adapter.submitCount).toBe(0)
  })

  test('emergency halt stays latched in process when durable control storage fails', async () => {
    const adapter = new FakeAdapter()
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const originalSetGlobalKill = store.setGlobalKill.bind(store)
    store.setGlobalKill = async () => { throw new Error('disk unavailable') }
    await expect(gateway.activateEmergencyHalt()).rejects.toThrow('disk unavailable')
    store.setGlobalKill = originalSetGlobalKill
    const intent = makeIntent(connection, { intent_id: 'intent-after-emergency-halt' })
    await approve(gateway, connection, intent)
    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({ code: 'KILL_SWITCH_ENABLED' })
    expect(adapter.submitCount).toBe(0)
  })

  test('requires consequential certification and expiring activation', async () => {
    const adapter = new FakeAdapter()
    const connection = makeConnection({
      environment: 'evaluation',
      environment_class: 'consequential',
      certifications: ['read-certified', 'paper-lifecycle-certified'],
      consequential_enabled_until: undefined,
    })
    const { gateway, store } = await setup(connection, [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)

    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'CERTIFICATION_REQUIRED',
    })
    expect((await store.get(intent.intent_id)).state).toBe('approved')
    expect(adapter.submitCount).toBe(0)
  })

  test('records a denied risk decision without demanding authorization', async () => {
    const { gateway, connection } = await setup()
    const intent = makeIntent(connection)
    await gateway.registerIntent(intent)

    const result = await gateway.approve(intent.intent_id, {
      risk_decision_schema_version: RISK_DECISION_SCHEMA_VERSION,
      decision_id: 'risk-deny-1',
      intent_id: intent.intent_id,
      account_snapshot_id: 'snapshot-1',
      risk_policy_version: '1.0.0',
      result: 'deny',
      reasons: ['Daily loss limit reached.'],
      evaluated_at: NOW,
      valid_until: '2026-07-30T15:09:00.000Z',
    })

    expect(result.state).toBe('risk-denied')
    expect(result.authorization).toBeUndefined()
  })

  test('detects persisted intent tampering before returning execution truth', async () => {
    const { root, gateway, store, connection } = await setup()
    const intent = makeIntent(connection)
    await gateway.registerIntent(intent)
    const recordFile = path.join(root, 'records', `${intent.intent_id}.json`)
    const record = JSON.parse(await readFile(recordFile, 'utf8'))
    record.intent.quantity = 2
    await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`)

    await expect(store.get(intent.intent_id)).rejects.toBeInstanceOf(ExecutionGatewayError)
    await expect(store.get(intent.intent_id)).rejects.toMatchObject({
      code: 'RECORD_INTEGRITY_FAILURE',
    })
  })

  test('detects persisted management command tampering', async () => {
    const adapter = new FakeAdapter()
    const { root, gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    await gateway.execute(intent.intent_id)
    await gateway.flatten(intent.intent_id, 'Operator requested flat.')

    const recordFile = path.join(root, 'records', `${intent.intent_id}.json`)
    const record = JSON.parse(await readFile(recordFile, 'utf8'))
    record.management_actions[0].command.payload.reason = 'Tampered reason.'
    await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`)

    await expect(store.get(intent.intent_id)).rejects.toMatchObject({
      code: 'RECORD_INTEGRITY_FAILURE',
    })
  })

  test('detects persisted management acknowledgment tampering', async () => {
    const adapter = new FakeAdapter()
    const { root, gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    await gateway.execute(intent.intent_id)
    await gateway.flatten(intent.intent_id, 'Operator requested flat.')

    const recordFile = path.join(root, 'records', `${intent.intent_id}.json`)
    const record = JSON.parse(await readFile(recordFile, 'utf8'))
    record.management_actions[0].acknowledgment.message = 'Tampered acknowledgment.'
    await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`)

    await expect(store.get(intent.intent_id)).rejects.toMatchObject({
      code: 'RECORD_INTEGRITY_FAILURE',
    })
  })

  test('creates a checksum-bound no-exposure proof from a fresh provider snapshot', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await gateway.registerIntent(intent)

    const proof = await gateway.verifyNoExposure(intent.intent_id)

    expect(proof.intent_id).toBe(intent.intent_id)
    expect(proof.positions_count).toBe(0)
    expect(proof.working_orders_count).toBe(0)
    const { content_checksum: _checksum, ...unsigned } = proof
    expect(proof.content_checksum).toBe(sha256(unsigned))
  })

  test('refuses no-exposure proof while the provider reports any account exposure', async () => {
    const adapter = new FakeAdapter()
    adapter.snapshotOverrides = {
      positions: [{
        instrument_id: 'contract-esu6', symbol: 'ESU6', side: 'buy',
        quantity: 1, average_price: '5600',
      }],
    }
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await gateway.registerIntent(intent)

    await expect(gateway.verifyNoExposure(intent.intent_id)).rejects.toMatchObject({
      code: 'RECONCILIATION_DIVERGENCE',
    })
  })

  test('cancels only the exact reviewed pending record', async () => {
    const { gateway, connection } = await setup()
    const intent = makeIntent(connection)
    const created = await gateway.registerIntent(intent)

    await expect(gateway.dismissPendingIntent(intent.intent_id, 'f'.repeat(64)))
      .rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
    const canceled = await gateway.dismissPendingIntent(intent.intent_id, sha256(created))
    expect(canceled.state).toBe('canceled')
    await expect(gateway.dismissPendingIntent(intent.intent_id, sha256(canceled)))
      .rejects.toMatchObject({ code: 'INVALID_STATE' })
  })

  test('captures exact flat account truth and refuses any provider exposure', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const flat = await gateway.captureFlatAccountSnapshot(connection.connection_id)
    expect(flat).toMatchObject({ positions: [], working_orders: [] })

    adapter.snapshotOverrides = {
      working_orders: [{
        provider_order_id: 'manual-order-1',
        instrument_id: 'contract-esu6',
        side: 'buy',
        quantity: 1,
        order_type: 'limit',
        status: 'working',
      }],
    }
    await expect(gateway.captureFlatAccountSnapshot(connection.connection_id))
      .rejects.toMatchObject({ code: 'RECONCILIATION_DIVERGENCE' })
  })

  test('marks account truth fresh only when every provider position and order is Trade God-owned', async () => {
    const adapter = new FakeAdapter()
    const { gateway, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    await gateway.execute(intent.intent_id)
    adapter.snapshotOverrides = {
      positions: [{
        instrument_id: 'contract-esu6', symbol: 'ESU6', side: 'buy',
        quantity: 1, average_price: '5600.25',
      }],
      working_orders: [{
        provider_order_id: 'provider-stop-1',
        instrument_id: 'contract-esu6',
        side: 'sell',
        quantity: 1,
        order_type: 'stop',
        status: 'working',
      }],
    }

    await expect(gateway.verifyConnectionAccountCoverage(connection.connection_id)).resolves.toBeDefined()

    adapter.snapshotOverrides = {
      ...adapter.snapshotOverrides,
      positions: [
        ...adapter.snapshotOverrides.positions!,
        {
          instrument_id: 'contract-nqu6', symbol: 'NQU6', side: 'buy',
          quantity: 1, average_price: '20100',
        },
      ],
      working_orders: [
        ...adapter.snapshotOverrides.working_orders!,
        {
          provider_order_id: 'manual-nq-stop',
          instrument_id: 'contract-nqu6',
          side: 'sell',
          quantity: 1,
          order_type: 'stop',
          status: 'working',
        },
      ],
    }
    await expect(gateway.verifyConnectionAccountCoverage(connection.connection_id))
      .rejects.toMatchObject({ code: 'RECONCILIATION_DIVERGENCE' })
  })

  test('latches an account halt in process before its durable control write completes', async () => {
    const adapter = new FakeAdapter()
    const { gateway, store, connection } = await setup(makeConnection(), [adapter])
    const intent = makeIntent(connection)
    await approve(gateway, connection, intent)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const originalSetConnectionKill = store.setConnectionKill.bind(store)
    store.setConnectionKill = async () => blocked

    const halt = gateway.setConnectionKill(connection.connection_id, true)
    await expect(gateway.execute(intent.intent_id)).rejects.toMatchObject({
      code: 'KILL_SWITCH_ENABLED',
    })
    expect(adapter.submitCount).toBe(0)

    release()
    await halt
    store.setConnectionKill = originalSetConnectionKill
  })

  test('refuses every direct attempt to release an account halt outside activation review', async () => {
    const { gateway, store, connection } = await setup()
    await gateway.setConnectionKill(connection.connection_id, true)

    await expect(gateway.setConnectionKill(connection.connection_id, false))
      .rejects.toMatchObject({ code: 'KILL_SWITCH_ENABLED' })
    expect((await store.readControl()).connection_kills).toContain(connection.connection_id)
  })

  test('atomically binds a reviewed release and never overrides the emergency latch', async () => {
    const { gateway, store, connection } = await setup()
    await store.setGlobalKill(true)
    await gateway.setConnectionKill(connection.connection_id, true)
    const reviewedControlChecksum = sha256(await store.readControl())
    await gateway.commitPaperActivationRelease({
      release_id: 'release-paper-one',
      state_checksum: 'b'.repeat(64),
      expected_control_checksum: reviewedControlChecksum,
      review_expires_at: '2099-01-01T00:00:00.000Z',
      connection_ids: [connection.connection_id],
      expected_connection_halt_epochs: {
        [connection.connection_id]: gateway.connectionHaltEpoch(connection.connection_id),
      },
      assert_release_current: async () => {},
      persist_release_evidence: async () => ({
        release_event_id: 'event-dismissed-one',
        release_event_checksum: 'a'.repeat(64),
      }),
    })
    expect(await store.readControl()).toMatchObject({
      global_kill: false,
      connection_kills: [],
      activation_release: {
        release_id: 'release-paper-one',
        release_event_id: 'event-dismissed-one',
      },
    })
    const postReleaseIntent = makeIntent(connection)
    await approve(gateway, connection, postReleaseIntent)
    expect((await gateway.execute(postReleaseIntent.intent_id)).state).toBe('protected')

    await gateway.activateEmergencyHalt()
    await expect(gateway.commitPaperActivationRelease({
      release_id: 'release-paper-two',
      state_checksum: 'd'.repeat(64),
      expected_control_checksum: sha256(await store.readControl()),
      review_expires_at: '2099-01-01T00:00:00.000Z',
      connection_ids: [connection.connection_id],
      expected_connection_halt_epochs: {
        [connection.connection_id]: gateway.connectionHaltEpoch(connection.connection_id),
      },
      assert_release_current: async () => {},
      persist_release_evidence: async () => ({
        release_event_id: 'event-dismissed-two',
        release_event_checksum: 'c'.repeat(64),
      }),
    })).rejects.toMatchObject({ code: 'KILL_SWITCH_ENABLED' })
    expect((await store.readControl()).global_kill).toBe(true)
  })

  test('never clears a halt added after the operator reviewed execution control', async () => {
    const { gateway, store, connection } = await setup()
    await store.setGlobalKill(true)
    const reviewedControlChecksum = sha256(await store.readControl())
    await store.setConnectionKill(connection.connection_id, true)

    await expect(gateway.commitPaperActivationRelease({
      release_id: 'release-control-drift',
      state_checksum: 'd'.repeat(64),
      expected_control_checksum: reviewedControlChecksum,
      review_expires_at: '2099-01-01T00:00:00.000Z',
      connection_ids: [connection.connection_id],
      expected_connection_halt_epochs: {
        [connection.connection_id]: gateway.connectionHaltEpoch(connection.connection_id),
      },
      assert_release_current: async () => {},
      persist_release_evidence: async () => ({
        release_event_id: 'event-control-drift',
        release_event_checksum: 'e'.repeat(64),
      }),
    })).rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
    expect(await store.readControl()).toMatchObject({
      global_kill: true,
      connection_kills: [connection.connection_id],
    })
  })

  test('retains a newer account halt while its durable write races activation release', async () => {
    const { gateway, store, connection } = await setup()
    await store.setGlobalKill(true)
    await gateway.setConnectionKill(connection.connection_id, true)
    const expectedEpoch = gateway.connectionHaltEpoch(connection.connection_id)
    const reviewedControlChecksum = sha256(await store.readControl())
    const originalSetConnectionKill = store.setConnectionKill.bind(store)
    let releaseWrite!: () => void
    const blockedWrite = new Promise<void>((resolve) => { releaseWrite = resolve })
    let racingHalt: Promise<void> | undefined
    store.setConnectionKill = async () => blockedWrite

    await expect(gateway.commitPaperActivationRelease({
      release_id: 'release-racing-account-halt',
      state_checksum: 'f'.repeat(64),
      expected_control_checksum: reviewedControlChecksum,
      review_expires_at: '2099-01-01T00:00:00.000Z',
      connection_ids: [connection.connection_id],
      expected_connection_halt_epochs: {
        [connection.connection_id]: expectedEpoch,
      },
      assert_release_current: async () => {},
      persist_release_evidence: async () => {
        racingHalt = gateway.setConnectionKill(connection.connection_id, true)
        return {
          release_event_id: 'event-racing-account-halt',
          release_event_checksum: '1'.repeat(64),
        }
      },
    })).rejects.toMatchObject({ code: 'KILL_SWITCH_ENABLED' })

    expect(gateway.connectionHaltEpoch(connection.connection_id)).toBe(expectedEpoch + 1)
    expect((await store.readControl()).global_kill).toBe(true)
    releaseWrite()
    await racingHalt
    store.setConnectionKill = originalSetConnectionKill
  })
})
