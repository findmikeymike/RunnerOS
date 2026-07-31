import { describe, expect, test } from 'bun:test'

import {
  EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_COMMAND_SCHEMA_VERSION,
  EXECUTION_MANAGEMENT_COMMAND_SCHEMA_VERSION,
  EXECUTION_RECONCILIATION_SCHEMA_VERSION,
  ORDER_INTENT_SCHEMA_VERSION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type ExecutionAccountSnapshot,
  type ExecutionCommand,
  type ExecutionManagementCommand,
  type ExecutionManagementPayload,
  type ExecutionReconciliation,
  type OrderIntent,
  type TradingConnection,
} from '@trade-god/contracts'

import {
  ExecutionAdapterError,
  ExecutionGatewayError,
  TradovateApiAdapter,
  TradovateFetchClient,
  WealthChartsBrowserAdapter,
  WealthChartsCertifiedDriver,
  buildTradovateOsoBody,
  computeActionDigest,
  computeOrderIntentChecksum,
  type TradovateCredential,
  type TradovateFetch,
  type TradovateOrder,
  type TradovatePosition,
  type TradovateRestClient,
  type WealthChartsBrowserDriver,
  type WealthChartsNamedAutomationPort,
  type WealthChartsOrderTicket,
} from '../src/index.ts'

const NOW = '2026-07-30T15:05:00.000Z'
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
  modify_order: false,
  cancel_order: false,
  partial_close: false,
  flatten: false,
  streaming_events: false,
}

const connection = (
  platform: 'tradovate' | 'wealthcharts',
): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: `connection-${platform}-paper`,
  display_name: `${platform} paper`,
  firm: { slug: 'apex', name: 'Apex Trader Funding' },
  platform: {
    slug: platform,
    name: platform === 'tradovate' ? 'Tradovate' : 'WealthCharts',
  },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: platform === 'tradovate' ? 'api' : 'browser',
  account_ref: platform === 'tradovate' ? '123456' : 'wealth-account-1234',
  account_display: { label: 'APEX-1234', last4: '1234' },
  ...(platform === 'tradovate'
    ? { credential_ref: 'trade-credential-ref' }
    : { browser_session_ref: 'trade-browser-ref' }),
  risk_policy_ref: 'risk-policy-paper',
  authorization_basis_ref: 'authorization-basis-apex',
  approval_policy_ref: 'approval-policy-paper',
  state: 'ready',
  capabilities,
  certifications: ['paper-lifecycle-certified'],
  enabled: true,
  created_at: '2026-07-30T14:00:00.000Z',
  updated_at: '2026-07-30T14:00:00.000Z',
})

const intent = (
  targetConnection: TradingConnection,
  protectionType: 'price' | 'ticks' = 'price',
): OrderIntent => {
  const unsigned: Omit<OrderIntent, 'content_checksum'> = {
    intent_schema_version: ORDER_INTENT_SCHEMA_VERSION,
    intent_id: `intent-${targetConnection.platform.slug}-1`,
    source: { type: 'manual', source_id: 'manual-entry-1' },
    connection_id: targetConnection.connection_id,
    instrument: {
      canonical_id: 'CME:ESU6',
      symbol: 'ESU6',
      exchange: 'XCME',
      expiry: '2026-09',
    },
    side: 'buy',
    quantity: 1,
    entry: { type: 'limit', price: '5600' },
    protection: {
      stop_loss: {
        type: protectionType,
        value: protectionType === 'price' ? '5598' : '8',
      },
      take_profit: {
        type: protectionType,
        value: protectionType === 'price' ? '5603' : '12',
      },
    },
    time_in_force: 'day',
    created_at: NOW,
    valid_until: '2026-07-30T15:10:00.000Z',
  }
  return { ...unsigned, content_checksum: computeOrderIntentChecksum(unsigned) }
}

const command = (targetConnection: TradingConnection, targetIntent: OrderIntent): ExecutionCommand => ({
  command_schema_version: EXECUTION_COMMAND_SCHEMA_VERSION,
  command_id: `command-${targetConnection.platform.slug}-1`,
  intent_id: targetIntent.intent_id,
  claim_id: `claim-${targetConnection.platform.slug}-1`,
  connection_id: targetConnection.connection_id,
  adapter_id: `${targetConnection.platform.slug}-adapter`,
  adapter_version: '1.0.0',
  action_digest: 'a'.repeat(64),
  idempotency_key: 'b'.repeat(64),
  issued_at: NOW,
})

const managementCommand = (
  targetConnection: TradingConnection,
  targetIntent: OrderIntent,
  payload: ExecutionManagementPayload,
): ExecutionManagementCommand => ({
  management_command_schema_version: EXECUTION_MANAGEMENT_COMMAND_SCHEMA_VERSION,
  management_command_id: `management-${payload.operation}-1`,
  parent_command_id: command(targetConnection, targetIntent).command_id,
  intent_id: targetIntent.intent_id,
  claim_id: command(targetConnection, targetIntent).claim_id,
  connection_id: targetConnection.connection_id,
  adapter_id: 'tradovate-api',
  adapter_version: '1.0.0',
  payload,
  action_digest: 'c'.repeat(64),
  idempotency_key: 'd'.repeat(64),
  issued_at: NOW,
  content_checksum: 'e'.repeat(64),
})

const snapshot = (targetConnection: TradingConnection): ExecutionAccountSnapshot => ({
  account_snapshot_schema_version: EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  account_snapshot_id: 'snapshot-paper-1',
  connection_id: targetConnection.connection_id,
  account_ref: targetConnection.account_ref,
  environment: targetConnection.environment,
  captured_at: NOW,
  can_trade: true,
  balance: '50000',
  realized_pnl: '0',
  open_pnl: '0',
  positions: [],
  working_orders: [],
})

class TradovateClient implements TradovateRestClient {
  lastBody: Record<string, unknown> | null = null
  placeResult: Awaited<ReturnType<TradovateRestClient['placeOso']>> = {
    orderId: 100,
    oso1Id: 101,
    oso2Id: 102,
  }
  placeError?: Error
  orders: TradovateOrder[] = []
  positions: TradovatePosition[] = []

  async connect() {}
  async snapshot(targetConnection: TradingConnection) { return snapshot(targetConnection) }
  async placeOso(input: Parameters<TradovateRestClient['placeOso']>[0]) {
    this.lastBody = input.body
    if (this.placeError) throw this.placeError
    return this.placeResult
  }
  async manage() { return { providerCommandIds: [201] } }
  async listOrders() { return this.orders }
  async listPositions() { return this.positions }
}

class WealthChartsDriver implements WealthChartsBrowserDriver {
  submitCount = 0
  selectorBundle = 'wealthcharts-selectors@1'
  draftOverrides: Record<string, unknown> = {}
  confirmationVisible = true
  evidenceVisible = true

  async verifySession(targetConnection: TradingConnection) {
    return {
      origin: 'https://www.wealthcharts.com',
      connection_id: targetConnection.connection_id,
      account_ref: targetConnection.account_ref,
      environment: targetConnection.environment,
      authenticated: true,
      selector_bundle_version: this.selectorBundle,
    }
  }
  async readAccountSnapshot(targetConnection: TradingConnection) {
    return snapshot(targetConnection)
  }
  async prepareBracketDraft(input: Parameters<WealthChartsBrowserDriver['prepareBracketDraft']>[0]) {
    return {
      action_digest: input.command.action_digest,
      account_ref: input.connection.account_ref,
      environment: input.connection.environment,
      symbol: input.intent.instrument.symbol,
      side: input.intent.side,
      quantity: input.intent.quantity,
      entry_type: input.intent.entry.type,
      stop_loss: input.intent.protection.stop_loss.value,
      take_profit: input.intent.protection.take_profit?.value,
      ...this.draftOverrides,
    }
  }
  async submitOnce() {
    this.submitCount += 1
    return {
      confirmation_visible: this.confirmationVisible,
      provider_order_ids: this.confirmationVisible ? ['wealth-order-1'] : [],
      evidence_refs: this.confirmationVisible && this.evidenceVisible ? ['wealth-evidence-1'] : [],
    }
  }
  async reconcile(input: Parameters<WealthChartsBrowserDriver['reconcile']>[0]): Promise<ExecutionReconciliation> {
    return {
      reconciliation_schema_version: EXECUTION_RECONCILIATION_SCHEMA_VERSION,
      reconciliation_id: 'wealth-reconciliation-1',
      command_id: input.command.command_id,
      connection_id: input.connection.connection_id,
      status: 'working',
      provider_order_ids: ['wealth-order-1'],
      filled_quantity: 0,
      protection_verified: false,
      evidence_refs: ['wealth-evidence-1'],
      reconciled_at: NOW,
      reason: 'WealthCharts Orders tab reports Active.',
    }
  }
}

describe('Tradovate API adapter', () => {
  test('builds a native OCO strategy with automation and idempotency fields', async () => {
    const targetConnection = connection('tradovate')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)
    const body = buildTradovateOsoBody(targetConnection, targetIntent, targetCommand)

    expect(body).toMatchObject({
      accountId: 123456,
      accountSpec: 'APEX-1234',
      action: 'Buy',
      orderType: 'Limit',
      price: 5600,
      isAutomated: true,
      bracket1: { action: 'Sell', orderType: 'Stop', stopPrice: 5598 },
      bracket2: { action: 'Sell', orderType: 'Limit', price: 5603 },
    })
    expect(String(body.clOrdId)).toHaveLength(59)
  })

  test('rejects uncertified tick-offset translation before provider I/O', async () => {
    const client = new TradovateClient()
    const adapter = new TradovateApiAdapter(client, () => NOW)
    const targetConnection = connection('tradovate')
    const targetIntent = intent(targetConnection, 'ticks')

    await expect(adapter.submit({
      connection: targetConnection,
      intent: targetIntent,
      command: command(targetConnection, targetIntent),
    })).rejects.toBeInstanceOf(ExecutionGatewayError)
    expect(client.lastBody).toBeNull()
  })

  test('rejects prices outside the provider numeric range before provider I/O', () => {
    const targetConnection = connection('tradovate')
    const targetIntent = {
      ...intent(targetConnection),
      entry: { type: 'limit' as const, price: '9'.repeat(400) },
    }

    expect(() => buildTradovateOsoBody(
      targetConnection,
      targetIntent,
      command(targetConnection, targetIntent),
    )).toThrow('outside the certified numeric range')
  })

  test('normalizes provider rejection and treats transport failure as uncertain', async () => {
    const targetConnection = connection('tradovate')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)
    const client = new TradovateClient()
    const adapter = new TradovateApiAdapter(client, () => NOW)
    client.placeResult = { failureReason: 'Account Closed', failureText: 'Account is closed.' }

    expect(await adapter.submit({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).toMatchObject({
      status: 'rejected',
      rejection_code: 'Account-Closed',
    })

    client.placeError = new Error('socket closed')
    await expect(adapter.submit({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).rejects.toMatchObject({
      submissionMayHaveOccurred: true,
    })
  })

  test('reconciles entry, child orders, fill, and active native protection', async () => {
    const targetConnection = connection('tradovate')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)
    const client = new TradovateClient()
    const adapter = new TradovateApiAdapter(client, () => NOW)
    const clOrdId = String(buildTradovateOsoBody(targetConnection, targetIntent, targetCommand).clOrdId)
    client.orders = [
      {
        id: 100,
        accountId: 123456,
        contractId: 9001,
        clOrdId,
        ordStatus: 'Filled',
        orderType: 'Limit',
        action: 'Buy',
        symbol: 'ESU6',
        orderQty: 1,
        filledQty: 1,
        avgPrice: 5600,
      },
      {
        id: 101,
        accountId: 123456,
        contractId: 9001,
        parentId: 100,
        ordStatus: 'Working',
        orderType: 'Stop',
        action: 'Sell',
        symbol: 'ESU6',
        orderQty: 1,
      },
      {
        id: 102,
        accountId: 123456,
        contractId: 9001,
        parentId: 100,
        ordStatus: 'Working',
        orderType: 'Limit',
        action: 'Sell',
        symbol: 'ESU6',
        orderQty: 1,
      },
    ]

    expect(await adapter.reconcile({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).toMatchObject({
      status: 'filled-protected',
      provider_order_ids: ['100', '101', '102'],
      filled_quantity: 1,
      protection_verified: true,
    })
  })

  test('uses the demo REST API, verifies exact account identity, and joins provider truth', async () => {
    const targetConnection = connection('tradovate')
    const fixture = new TradovateFetchFixture()
    const client = new TradovateFetchClient({
      resolveCredential: async () => fixture.credential,
      fetch: fixture.fetch,
      now: () => NOW,
    })

    await client.connect(targetConnection)
    const accountSnapshot = await client.snapshot(targetConnection)
    const orders = await client.listOrders(targetConnection)

    expect(accountSnapshot).toMatchObject({
      connection_id: targetConnection.connection_id,
      account_ref: '123456',
      environment: 'paper',
      can_trade: true,
      balance: '50250',
      realized_pnl: '250',
      open_pnl: '125',
      positions: [{
        instrument_id: 'tradovate-contract-9001',
        symbol: 'ESU6',
        side: 'buy',
        quantity: 1,
      }],
      working_orders: [{
        provider_order_id: '100',
        instrument_id: 'tradovate-contract-9001',
        order_type: 'limit',
        status: 'partially-filled',
      }],
    })
    expect(orders).toMatchObject([{
      id: 100,
      clOrdId: 'tg-provider-command',
      parentId: undefined,
      ordStatus: 'PartiallyFilled',
      orderType: 'Limit',
      orderQty: 2,
      filledQty: 1,
      avgPrice: 5600,
    }])
    expect(fixture.calls.every((call) => (
      call.url.startsWith('https://demo.tradovateapi.com/v1/')
    ))).toBe(true)
    expect(fixture.calls.every((call) => (
      call.authorization === 'Bearer test-access-token'
    ))).toBe(true)
  })

  test('submits placeOSO once and marks an HTTP failure as uncertain', async () => {
    const targetConnection = connection('tradovate')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)
    const fixture = new TradovateFetchFixture()
    const client = new TradovateFetchClient({
      resolveCredential: async () => fixture.credential,
      fetch: fixture.fetch,
      now: () => NOW,
    })
    const body = buildTradovateOsoBody(targetConnection, targetIntent, targetCommand)

    expect(await client.placeOso({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
      body,
    })).toMatchObject({ orderId: 100, oso1Id: 101, oso2Id: 102 })
    expect(fixture.calls.filter((call) => call.url.endsWith('/order/placeoso'))).toHaveLength(1)

    fixture.placeStatus = 503
    await expect(client.placeOso({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
      body,
    })).rejects.toMatchObject({
      code: 'TRADOVATE_HTTP_ERROR',
      submissionMayHaveOccurred: true,
    })
  })

  test('uses only official cancel, modify, and liquidate endpoints with exact account targets', async () => {
    const targetConnection = connection('tradovate')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)
    const fixture = new TradovateFetchFixture()
    const client = new TradovateFetchClient({
      resolveCredential: async () => fixture.credential,
      fetch: fixture.fetch,
      now: () => NOW,
    })

    expect(await client.manage({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
      managementCommand: managementCommand(targetConnection, targetIntent, {
        operation: 'cancel',
        provider_order_ids: ['100'],
      }),
    })).toMatchObject({ providerCommandIds: [601] })
    expect(await client.manage({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
      managementCommand: managementCommand(targetConnection, targetIntent, {
        operation: 'modify',
        provider_order_id: '100',
        quantity: 1,
        order_type: 'limit',
        limit_price: '5599.75',
        time_in_force: 'day',
      }),
    })).toMatchObject({ providerCommandIds: [602] })
    expect(await client.manage({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
      managementCommand: managementCommand(targetConnection, targetIntent, {
        operation: 'flatten',
        reason: 'Emergency protection failure.',
      }),
    })).toMatchObject({ providerCommandIds: [701] })

    expect(fixture.calls.filter((call) => call.url.endsWith('/order/cancelorder'))).toHaveLength(1)
    expect(fixture.calls.filter((call) => call.url.endsWith('/order/modifyorder'))).toHaveLength(1)
    expect(fixture.calls.filter((call) => call.url.endsWith('/order/liquidateposition'))).toHaveLength(1)
    expect(fixture.calls.find((call) => call.url.endsWith('/order/cancelorder'))?.body)
      .toMatchObject({ orderId: 100, isAutomated: true })
    expect(fixture.calls.find((call) => call.url.endsWith('/order/modifyorder'))?.body)
      .toMatchObject({ orderId: 100, orderQty: 1, price: 5599.75, isAutomated: true })
    expect(fixture.calls.find((call) => call.url.endsWith('/order/liquidateposition'))?.body)
      .toMatchObject({ accountId: 123456, contractId: 9001, admin: false })
  })
})

class TradovateFetchFixture {
  readonly credential: TradovateCredential = {
    access_token: 'test-access-token',
    account_id: 123456,
    account_spec: 'APEX-1234',
    expires_at: '2026-07-30T16:00:00.000Z',
  }
  readonly calls: Array<{
    url: string
    method: string
    authorization: string | null
    body?: Record<string, unknown>
  }> = []
  placeStatus = 200

  readonly fetch: TradovateFetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    this.calls.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
      ...(typeof init?.body === 'string'
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    })
    const path = new URL(url).pathname.replace('/v1', '')
    const payloads: Record<string, unknown> = {
      '/account/list': [{
        id: 123456,
        name: 'APEX-1234',
        active: true,
        readonly: false,
      }],
      '/cashBalance/getcashbalancesnapshot': {
        totalCashValue: 50_000,
        netLiq: 50_250,
        openPnL: 125,
        realizedPnL: 250,
      },
      '/order/list': [{
        id: 100,
        accountId: 123456,
        contractId: 9001,
        action: 'Buy',
        ordStatus: 'Working',
      }],
      '/orderVersion/list': [{
        id: 201,
        orderId: 100,
        orderQty: 2,
        orderType: 'Limit',
      }],
      '/command/list': [{
        id: 301,
        orderId: 100,
        clOrdId: 'tg-provider-command',
      }, {
        id: 302,
        orderId: 100,
      }],
      '/executionReport/list': [{
        id: 401,
        orderId: 100,
        ordStatus: 'PartiallyFilled',
        cumQty: 1,
        avgPx: 5600,
      }],
      '/contract/list': [{ id: 9001, name: 'ESU6' }],
      '/position/list': [{
        id: 501,
        accountId: 123456,
        contractId: 9001,
        netPos: 1,
        netPrice: 5600,
      }],
      '/order/placeoso': {
        orderId: 100,
        oso1Id: 101,
        oso2Id: 102,
      },
      '/order/cancelorder': { commandId: 601 },
      '/order/modifyorder': { commandId: 602 },
      '/order/liquidateposition': { orderId: 701 },
    }
    const status = path === '/order/placeoso' ? this.placeStatus : 200
    return new Response(JSON.stringify(payloads[path] ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

class WealthChartsFixturePort implements WealthChartsNamedAutomationPort {
  ticket: WealthChartsOrderTicket | null = null
  clickCount = 0
  visibleQuantityOverride?: number

  async inspectSession(targetConnection: TradingConnection) {
    return {
      origin: 'https://www.wealthcharts.com/trading',
      connection_id: targetConnection.connection_id,
      account_ref: targetConnection.account_ref,
      environment: targetConnection.environment,
      authenticated: true,
      selector_bundle_version: 'wealthcharts-selectors@1',
    }
  }

  async readAccountSnapshot(targetConnection: TradingConnection) {
    return snapshot(targetConnection)
  }

  async writeOrderTicket(input: Parameters<WealthChartsNamedAutomationPort['writeOrderTicket']>[0]) {
    this.ticket = structuredClone(input.ticket)
  }

  async readVisibleOrderTicket() {
    if (!this.ticket) throw new Error('ticket missing')
    return {
      ...structuredClone(this.ticket),
      quantity: this.visibleQuantityOverride ?? this.ticket.quantity,
    }
  }

  async clickOrderSubmitOnce() {
    this.clickCount += 1
  }

  async readSubmissionEvidence() {
    return {
      confirmation_visible: true,
      provider_order_ids: ['wealth-provider-order-1'],
      evidence_refs: ['wealth-screenshot-1'],
    }
  }

  async readReconciliation(
    input: Parameters<WealthChartsNamedAutomationPort['readReconciliation']>[0],
  ): Promise<ExecutionReconciliation> {
    return {
      reconciliation_schema_version: EXECUTION_RECONCILIATION_SCHEMA_VERSION,
      reconciliation_id: 'wealth-fixture-reconciliation-1',
      command_id: input.command.command_id,
      connection_id: input.connection.connection_id,
      status: 'working' as const,
      provider_order_ids: ['wealth-provider-order-1'],
      filled_quantity: 0,
      protection_verified: false,
      evidence_refs: ['wealth-screenshot-1'],
      reconciled_at: NOW,
      reason: 'Deterministic WealthCharts fixture shows an active order.',
    }
  }
}

describe('WealthCharts browser adapter', () => {
  test('uses only a versioned named driver and verifies the visible draft before one click', async () => {
    const driver = new WealthChartsDriver()
    const adapter = new WealthChartsBrowserAdapter(driver, () => NOW)
    const targetConnection = connection('wealthcharts')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)

    await adapter.connect(targetConnection)
    expect(await adapter.submit({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).toMatchObject({
      status: 'acknowledged',
      provider_order_ids: ['wealth-order-1'],
    })
    expect(driver.submitCount).toBe(1)
  })

  test('stops before click on selector drift or a mismatched visible draft', async () => {
    const targetConnection = connection('wealthcharts')
    const targetIntent = intent(targetConnection)
    const targetCommand = command(targetConnection, targetIntent)
    const drifted = new WealthChartsDriver()
    drifted.selectorBundle = 'wealthcharts-selectors@2'
    await expect(new WealthChartsBrowserAdapter(drifted).connect(targetConnection))
      .rejects.toMatchObject({ code: 'CERTIFICATION_REQUIRED' })

    const mismatched = new WealthChartsDriver()
    mismatched.draftOverrides = { quantity: 10 }
    await expect(new WealthChartsBrowserAdapter(mismatched).submit({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).rejects.toMatchObject({
      code: 'WEALTHCHARTS_DRAFT_MISMATCH',
      submissionMayHaveOccurred: false,
    })
    expect(mismatched.submitCount).toBe(0)
  })

  test('treats a click without exact visible confirmation as submit-unknown', async () => {
    const driver = new WealthChartsDriver()
    driver.confirmationVisible = false
    const targetConnection = connection('wealthcharts')
    const targetIntent = intent(targetConnection)

    await expect(new WealthChartsBrowserAdapter(driver).submit({
      connection: targetConnection,
      intent: targetIntent,
      command: command(targetConnection, targetIntent),
    })).rejects.toBeInstanceOf(ExecutionAdapterError)
    expect(driver.submitCount).toBe(1)
  })

  test('treats visible confirmation without captured evidence as submit-unknown', async () => {
    const driver = new WealthChartsDriver()
    driver.evidenceVisible = false
    const targetConnection = connection('wealthcharts')
    const targetIntent = intent(targetConnection)

    await expect(new WealthChartsBrowserAdapter(driver).submit({
      connection: targetConnection,
      intent: targetIntent,
      command: command(targetConnection, targetIntent),
    })).rejects.toMatchObject({
      code: 'WEALTHCHARTS_SUBMIT_UNKNOWN',
      submissionMayHaveOccurred: true,
    })
    expect(driver.submitCount).toBe(1)
  })

  test('certified driver writes a named ticket, re-reads it, and submits exactly once', async () => {
    const targetConnection = connection('wealthcharts')
    const targetIntent = intent(targetConnection)
    const targetCommand = {
      ...command(targetConnection, targetIntent),
      action_digest: computeActionDigest(targetIntent, targetConnection),
    }
    const port = new WealthChartsFixturePort()
    const adapter = new WealthChartsBrowserAdapter(
      new WealthChartsCertifiedDriver(port),
      () => NOW,
    )

    await adapter.connect(targetConnection)
    expect(await adapter.submit({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).toMatchObject({
      status: 'acknowledged',
      provider_order_ids: ['wealth-provider-order-1'],
    })
    expect(port.ticket).toMatchObject({
      account_ref: targetConnection.account_ref,
      symbol: 'ESU6',
      side: 'buy',
      quantity: 1,
      protection: {
        stop_loss: { type: 'price', value: '5598' },
        take_profit: { type: 'price', value: '5603' },
      },
    })
    expect(port.clickCount).toBe(1)
  })

  test('certified driver refuses a changed visible ticket without arming a click', async () => {
    const targetConnection = connection('wealthcharts')
    const targetIntent = intent(targetConnection)
    const targetCommand = {
      ...command(targetConnection, targetIntent),
      action_digest: computeActionDigest(targetIntent, targetConnection),
    }
    const port = new WealthChartsFixturePort()
    port.visibleQuantityOverride = 2
    const driver = new WealthChartsCertifiedDriver(port)
    const adapter = new WealthChartsBrowserAdapter(driver, () => NOW)

    await expect(adapter.submit({
      connection: targetConnection,
      intent: targetIntent,
      command: targetCommand,
    })).rejects.toMatchObject({
      code: 'WEALTHCHARTS_DRAFT_MISMATCH',
      submissionMayHaveOccurred: false,
    })
    await expect(driver.submitOnce({
      connection: targetConnection,
      command: targetCommand,
    })).rejects.toMatchObject({
      code: 'WEALTHCHARTS_NOT_PREPARED',
      submissionMayHaveOccurred: false,
    })
    expect(port.clickCount).toBe(0)
  })
})
