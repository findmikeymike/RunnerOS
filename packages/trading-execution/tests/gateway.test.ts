import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
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
  capabilities,
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
      levels: ['paper-lifecycle-certified'],
    },
    {
      certification_id: 'cert-fake-browser',
      adapter_id: 'fake-browser',
      adapter_version: '1.0.0',
      provider_contract_version: 'fake-provider@1',
      transport: 'browser',
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
      capabilities,
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
) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-god-execution-'))
  roots.push(root)
  const store = new FileExecutionStore(root, () => NOW)
  await store.setGlobalKill(false)
  const gateway = new ExecutionGateway({
    store,
    adapters,
    resolveConnection: async () => connection,
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
  test('starts with the persistent global execution halt enabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-execution-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)

    expect(await store.readControl()).toMatchObject({ global_kill: true })
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

  test('does not inherit certification from another adapter version', async () => {
    const adapter = new FakeAdapter()
    const connection = makeConnection({
      adapter_certifications: [{
        certification_id: 'cert-old-api',
        adapter_id: 'fake-api',
        adapter_version: '0.9.0',
        provider_contract_version: 'fake-provider@1',
        transport: 'api',
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

    expect(await store.claimManagement(intent.intent_id, actionDigest, (record) => record))
      .toMatchObject({ claimed: true })
  })

  test('recovers an entry claim marker left by a dead process before journaling', async () => {
    const adapter = new FakeAdapter()
    const { root, gateway, connection } = await setup(makeConnection(), [adapter])
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

    expect(await gateway.execute(intent.intent_id)).toMatchObject({ state: 'protected' })
    expect(adapter.submitCount).toBe(1)
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
})
