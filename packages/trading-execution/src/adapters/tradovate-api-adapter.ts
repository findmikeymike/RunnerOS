import {
  EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_RECONCILIATION_SCHEMA_VERSION,
  EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
  executionAccountSnapshotSchema,
  executionReconciliationSchema,
  executionSubmitAcknowledgmentSchema,
  type ExecutionAccountSnapshot,
  type ExecutionCommand,
  type ExecutionReconciliation,
  type OrderIntent,
  type TradingConnection,
} from '@trade-god/contracts'

import type { ExecutionAdapter } from '../adapter.ts'
import { ExecutionAdapterError, ExecutionGatewayError } from '../errors.ts'

export interface TradovateCredential {
  access_token: string
  account_id: number
  account_spec: string
  expires_at?: string
}

export interface TradovateOrder {
  id: number
  accountId: number
  contractId: number
  clOrdId?: string
  parentId?: number
  ordStatus: string
  orderType: string
  action: string
  symbol?: string
  orderQty: number
  filledQty?: number
  avgPrice?: number
}

export interface TradovatePosition {
  id: number
  accountId: number
  contractId: number
  netPos: number
  netPrice: number
  symbol?: string
}

export interface TradovateRestClient {
  connect(connection: TradingConnection): Promise<void>
  snapshot(connection: TradingConnection): Promise<ExecutionAccountSnapshot>
  placeOso(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    body: Record<string, unknown>
  }): Promise<{
    orderId?: number
    oso1Id?: number
    oso2Id?: number
    failureReason?: string
    failureText?: string
  }>
  listOrders(connection: TradingConnection): Promise<TradovateOrder[]>
  listPositions(connection: TradingConnection): Promise<TradovatePosition[]>
}

export type TradovateCredentialResolver = (
  credentialRef: string,
) => Promise<TradovateCredential | null>

export type TradovateFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface TradovateFetchClientOptions {
  resolveCredential: TradovateCredentialResolver
  fetch?: TradovateFetch
  now?: () => string
  timeoutMs?: number
}

interface TradovateAccount {
  id: number
  name: string
  active: boolean
  readonly?: boolean
}

interface TradovateCashSnapshot {
  errorText?: string
  totalCashValue?: number
  totalPnL?: number
  netLiq?: number
  openPnL?: number
  realizedPnL?: number
}

interface TradovateRawOrder {
  id: number
  accountId: number
  contractId: number
  action: string
  ordStatus: string
  parentId?: number
}

interface TradovateOrderVersion {
  id: number
  orderId: number
  orderQty: number
  orderType: string
}

interface TradovateCommand {
  id: number
  orderId: number
  clOrdId?: string
  timestamp?: string
}

interface TradovateExecutionReport {
  id: number
  orderId: number
  ordStatus: string
  cumQty: number
  avgPx?: number
  timestamp?: string
}

interface TradovateContract {
  id: number
  name: string
}

export class TradovateFetchClient implements TradovateRestClient {
  private readonly fetchImpl: TradovateFetch
  private readonly now: () => string
  private readonly timeoutMs: number

  constructor(private readonly options: TradovateFetchClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date().toISOString())
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000)
  }

  async connect(connection: TradingConnection): Promise<void> {
    const credential = await this.credential(connection)
    const accounts = await this.requestJson<TradovateAccount[]>(
      credential,
      '/account/list',
      { method: 'GET' },
      false,
    )
    const account = accounts.find((candidate) => candidate.id === credential.account_id)
    if (!account || String(account.id) !== connection.account_ref) {
      throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'Tradovate credential does not expose the configured account.')
    }
    if (account.name !== credential.account_spec || account.name !== connection.account_display.label) {
      throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'Tradovate account name does not match the configured account.')
    }
    if (!account.active || account.readonly === true) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate account is inactive or read-only.')
    }
  }

  async snapshot(connection: TradingConnection): Promise<ExecutionAccountSnapshot> {
    const credential = await this.credential(connection)
    const accountId = parsePositiveAccountId(connection.account_ref)
    const [accounts, cash, orders, positions, contracts] = await Promise.all([
      this.requestJson<TradovateAccount[]>(credential, '/account/list', { method: 'GET' }, false),
      this.requestJson<TradovateCashSnapshot>(
        credential,
        '/cashBalance/getcashbalancesnapshot',
        { method: 'POST', body: JSON.stringify({ accountId }) },
        false,
      ),
      this.listOrders(connection),
      this.listPositions(connection),
      this.requestJson<TradovateContract[]>(credential, '/contract/list', { method: 'GET' }, false),
    ])
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account || account.name !== credential.account_spec || String(account.id) !== connection.account_ref) {
      throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'Tradovate snapshot returned the wrong account.')
    }
    if (cash.errorText) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', `Tradovate cash snapshot failed: ${cash.errorText}`)
    }
    const contractNames = new Map(contracts.map((contract) => [contract.id, contract.name]))
    const normalizedPositions = positions
      .filter((position) => position.accountId === accountId && position.netPos !== 0)
      .map((position) => ({
        instrument_id: `tradovate-contract-${position.contractId}`,
        symbol: requiredContractName(contractNames, position.contractId),
        side: position.netPos > 0 ? 'buy' as const : 'sell' as const,
        quantity: Math.abs(Math.trunc(position.netPos)),
        average_price: String(position.netPrice),
      }))
    const workingOrders = orders
      .filter((order) => order.accountId === accountId && isWorking(order.ordStatus))
      .map((order) => ({
        provider_order_id: String(order.id),
        instrument_id: `tradovate-contract-${order.contractId}`,
        side: order.action === 'Buy' ? 'buy' as const : 'sell' as const,
        quantity: Math.max(1, Math.trunc(order.orderQty)),
        order_type: normalizedOrderType(order.orderType),
        status: order.ordStatus === 'PartiallyFilled'
          ? 'partially-filled' as const
          : order.ordStatus.startsWith('Pending')
            ? 'pending' as const
            : 'working' as const,
      }))
    const capturedAt = this.now()
    return buildTradovateAccountSnapshot({
      connection,
      capturedAt,
      balance: requireFiniteNumber(cash.netLiq ?? cash.totalCashValue, 'Tradovate net liquidation value'),
      realizedPnl: requireFiniteNumber(cash.realizedPnL, 'Tradovate realized P&L'),
      openPnl: requireFiniteNumber(cash.openPnL ?? cash.totalPnL, 'Tradovate open P&L'),
      canTrade: account.active && account.readonly !== true,
      positions: normalizedPositions,
      workingOrders,
    })
  }

  async placeOso(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    body: Record<string, unknown>
  }) {
    const credential = await this.credential(input.connection)
    if (
      input.body.accountId !== credential.account_id
      || input.body.accountSpec !== credential.account_spec
      || input.body.isAutomated !== true
    ) {
      throw new ExecutionAdapterError(
        'TRADOVATE_COMMAND_ACCOUNT_MISMATCH',
        'Tradovate order body does not match the resolved credential and automation policy.',
        false,
      )
    }
    return this.requestJson<{
      orderId?: number
      oso1Id?: number
      oso2Id?: number
      failureReason?: string
      failureText?: string
    }>(
      credential,
      '/order/placeoso',
      { method: 'POST', body: JSON.stringify(input.body) },
      true,
    )
  }

  async listOrders(connection: TradingConnection): Promise<TradovateOrder[]> {
    const credential = await this.credential(connection)
    const [orders, versions, commands, reports, contracts] = await Promise.all([
      this.requestJson<TradovateRawOrder[]>(credential, '/order/list', { method: 'GET' }, false),
      this.requestJson<TradovateOrderVersion[]>(credential, '/orderVersion/list', { method: 'GET' }, false),
      this.requestJson<TradovateCommand[]>(credential, '/command/list', { method: 'GET' }, false),
      this.requestJson<TradovateExecutionReport[]>(credential, '/executionReport/list', { method: 'GET' }, false),
      this.requestJson<TradovateContract[]>(credential, '/contract/list', { method: 'GET' }, false),
    ])
    const accountId = parsePositiveAccountId(connection.account_ref)
    const latestVersion = latestBy(versions, (value) => value.orderId)
    const latestCommand = latestBy(
      commands.filter((command) => Boolean(command.clOrdId)),
      (value) => value.orderId,
    )
    const latestReport = latestBy(reports, (value) => value.orderId)
    const contractNames = new Map(contracts.map((contract) => [contract.id, contract.name]))
    return orders
      .filter((order) => order.accountId === accountId)
      .map((order) => {
        const version = latestVersion.get(order.id)
        if (!version) {
          throw new ExecutionGatewayError(
            'RECONCILIATION_DIVERGENCE',
            `Tradovate order ${order.id} has no order-version truth.`,
          )
        }
        const report = latestReport.get(order.id)
        return {
          id: order.id,
          accountId: order.accountId,
          contractId: order.contractId,
          clOrdId: latestCommand.get(order.id)?.clOrdId,
          parentId: order.parentId,
          ordStatus: report?.ordStatus ?? order.ordStatus,
          orderType: version.orderType,
          action: order.action,
          symbol: contractNames.get(order.contractId),
          orderQty: version.orderQty,
          filledQty: report?.cumQty,
          avgPrice: report?.avgPx,
        }
      })
  }

  async listPositions(connection: TradingConnection): Promise<TradovatePosition[]> {
    const credential = await this.credential(connection)
    const accountId = parsePositiveAccountId(connection.account_ref)
    const [positions, contracts] = await Promise.all([
      this.requestJson<TradovatePosition[]>(credential, '/position/list', { method: 'GET' }, false),
      this.requestJson<TradovateContract[]>(credential, '/contract/list', { method: 'GET' }, false),
    ])
    const contractNames = new Map(contracts.map((contract) => [contract.id, contract.name]))
    return positions
      .filter((position) => position.accountId === accountId)
      .map((position) => ({
        ...position,
        symbol: contractNames.get(position.contractId),
      }))
  }

  private async credential(connection: TradingConnection): Promise<TradovateCredential> {
    if (connection.environment !== 'paper') {
      throw new ExecutionGatewayError('ENVIRONMENT_MISMATCH', 'Tradovate client 1.0.0 is demo/paper only.')
    }
    if (!connection.credential_ref) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate credential reference is missing.')
    }
    const credential = await this.options.resolveCredential(connection.credential_ref)
    if (!credential || !credential.access_token.trim()) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate credential is unavailable.')
    }
    if (
      credential.account_id !== parsePositiveAccountId(connection.account_ref)
      || credential.account_spec !== connection.account_display.label
    ) {
      throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'Tradovate credential is bound to a different account.')
    }
    if (credential.expires_at && Date.parse(credential.expires_at) <= Date.parse(this.now())) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate access token has expired.')
    }
    return credential
  }

  private async requestJson<T>(
    credential: TradovateCredential,
    path: string,
    init: RequestInit,
    submissionMayHaveOccurred: boolean,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`https://demo.tradovateapi.com/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.access_token}`,
        },
      })
      if (!response.ok) {
        throw new ExecutionAdapterError(
          'TRADOVATE_HTTP_ERROR',
          `Tradovate returned HTTP ${response.status}.`,
          submissionMayHaveOccurred,
        )
      }
      try {
        return await response.json() as T
      } catch {
        throw new ExecutionAdapterError(
          'TRADOVATE_INVALID_JSON',
          'Tradovate returned invalid JSON.',
          submissionMayHaveOccurred,
        )
      }
    } catch (error) {
      if (error instanceof ExecutionAdapterError) throw error
      throw new ExecutionAdapterError(
        submissionMayHaveOccurred ? 'TRADOVATE_SUBMIT_TRANSPORT' : 'TRADOVATE_READ_TRANSPORT',
        error instanceof Error ? error.message : 'Tradovate transport failed.',
        submissionMayHaveOccurred,
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class TradovateApiAdapter implements ExecutionAdapter {
  readonly descriptor = {
    adapter_id: 'tradovate-api',
    adapter_version: '1.0.0',
    transport: 'api' as const,
    capabilities: {
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
    },
  }

  constructor(
    private readonly client: TradovateRestClient,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  supports(connection: TradingConnection): boolean {
    return (
      connection.platform.slug === 'tradovate'
      && connection.environment === 'paper'
      && Boolean(connection.credential_ref)
    )
  }

  connect(connection: TradingConnection): Promise<void> {
    return this.client.connect(connection)
  }

  async snapshotAccount(connection: TradingConnection): Promise<ExecutionAccountSnapshot> {
    return executionAccountSnapshotSchema.parse(await this.client.snapshot(connection))
  }

  async submit(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }) {
    const body = buildTradovateOsoBody(input.connection, input.intent, input.command)
    let response
    try {
      response = await this.client.placeOso({ ...input, body })
    } catch (error) {
      if (error instanceof ExecutionAdapterError) throw error
      throw new ExecutionAdapterError(
        'TRADOVATE_SUBMIT_TRANSPORT',
        error instanceof Error ? error.message : 'Tradovate submission transport failed.',
        true,
      )
    }
    if (response.failureReason || !response.orderId) {
      return executionSubmitAcknowledgmentSchema.parse({
        submit_ack_schema_version: EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
        command_id: input.command.command_id,
        status: 'rejected',
        provider_order_ids: [],
        acknowledged_at: this.now(),
        rejection_code: normalizeProviderCode(response.failureReason ?? 'TradovateRejected'),
        rejection_message: response.failureText ?? 'Tradovate rejected the order strategy.',
      })
    }
    return executionSubmitAcknowledgmentSchema.parse({
      submit_ack_schema_version: EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
      command_id: input.command.command_id,
      status: 'acknowledged',
      provider_order_ids: [response.orderId, response.oso1Id, response.oso2Id]
        .filter((id): id is number => typeof id === 'number')
        .map(String),
      acknowledged_at: this.now(),
    })
  }

  async reconcile(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<ExecutionReconciliation> {
    const [orders, positions] = await Promise.all([
      this.client.listOrders(input.connection),
      this.client.listPositions(input.connection),
    ])
    const tag = tradovateClientOrderId(input.command)
    const entry = orders.find((order) => order.clOrdId === tag)
    if (!entry) {
      return reconciliation(input, {
        status: 'not-found',
        providerOrderIds: [],
        filledQuantity: 0,
        protectionVerified: false,
        reason: 'No Tradovate order matches the immutable client order ID.',
      }, this.now())
    }
    const children = orders.filter((order) => order.parentId === entry.id)
    const providerOrderIds = [entry, ...children].map((order) => String(order.id))
    const filledQuantity = Math.max(0, Math.trunc(entry.filledQty ?? 0))
    const activeProtection = children.filter((order) => isWorking(order.ordStatus))
    const protectionVerified = (
      activeProtection.some((order) => order.orderType === 'Stop')
      && (
        !input.intent.protection.take_profit
        || activeProtection.some((order) => order.orderType === 'Limit')
      )
    )
    const position = positions.find((candidate) => (
      candidate.accountId === Number(input.connection.account_ref)
      && candidate.contractId === entry.contractId
    ))
    if (isRejected(entry.ordStatus)) {
      return reconciliation(input, {
        status: 'divergent',
        providerOrderIds,
        filledQuantity,
        protectionVerified: false,
        reason: `Tradovate order is ${entry.ordStatus}.`,
      }, this.now())
    }
    if (filledQuantity === 0) {
      return reconciliation(input, {
        status: 'working',
        providerOrderIds,
        filledQuantity: 0,
        protectionVerified: false,
        reason: 'Tradovate reports the entry working.',
      }, this.now())
    }
    if (filledQuantity < input.intent.quantity) {
      return reconciliation(input, {
        status: 'partially-filled',
        providerOrderIds,
        filledQuantity,
        averageFillPrice: entry.avgPrice,
        protectionVerified,
        reason: 'Tradovate reports a partial fill.',
      }, this.now())
    }
    if (protectionVerified) {
      return reconciliation(input, {
        status: 'filled-protected',
        providerOrderIds,
        filledQuantity,
        averageFillPrice: entry.avgPrice,
        protectionVerified: true,
        reason: 'Tradovate reports a full fill with active native protection.',
      }, this.now())
    }
    if (!position || position.netPos === 0) {
      return reconciliation(input, {
        status: 'closed',
        providerOrderIds,
        filledQuantity,
        averageFillPrice: entry.avgPrice,
        protectionVerified: false,
        reason: 'Tradovate reports the filled position is flat.',
      }, this.now())
    }
    return reconciliation(input, {
      status: 'filled',
      providerOrderIds,
      filledQuantity,
      averageFillPrice: entry.avgPrice,
      protectionVerified: false,
      reason: 'Tradovate reports a fill without verified active protection.',
    }, this.now())
  }
}

export const buildTradovateOsoBody = (
  connection: TradingConnection,
  intent: OrderIntent,
  command: ExecutionCommand,
): Record<string, unknown> => {
  const stop = intent.protection.stop_loss
  const target = intent.protection.take_profit
  if (stop.type !== 'price' || (target && target.type !== 'price')) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'Tradovate adapter 1.0.0 requires absolute-price protection for certified OSO submission.',
    )
  }
  const oppositeAction = intent.side === 'buy' ? 'Sell' : 'Buy'
  return {
    accountSpec: connection.account_display.label,
    accountId: parsePositiveAccountId(connection.account_ref),
    action: intent.side === 'buy' ? 'Buy' : 'Sell',
    symbol: intent.instrument.symbol,
    orderQty: intent.quantity,
    orderType: tradovateOrderType(intent),
    ...tradovateEntryPrice(intent),
    timeInForce: intent.time_in_force === 'gtc' ? 'GTC' : 'Day',
    clOrdId: tradovateClientOrderId(command),
    isAutomated: true,
    bracket1: {
      action: oppositeAction,
      orderType: 'Stop',
      stopPrice: decimalNumber(stop.value, 'stop-loss price'),
      timeInForce: intent.time_in_force === 'gtc' ? 'GTC' : 'Day',
    },
    ...(target
      ? {
          bracket2: {
            action: oppositeAction,
            orderType: 'Limit',
            price: decimalNumber(target.value, 'take-profit price'),
            timeInForce: intent.time_in_force === 'gtc' ? 'GTC' : 'Day',
          },
        }
      : {}),
  }
}

const tradovateOrderType = (intent: OrderIntent): string => {
  if (intent.entry.type === 'market') return 'Market'
  if (intent.entry.type === 'limit') return 'Limit'
  if (intent.entry.type === 'stop') return 'Stop'
  return 'StopLimit'
}

const tradovateEntryPrice = (intent: OrderIntent): Record<string, number> => {
  if (intent.entry.type === 'limit') {
    return { price: decimalNumber(intent.entry.price, 'entry limit price') }
  }
  if (intent.entry.type === 'stop') {
    return { stopPrice: decimalNumber(intent.entry.stop_price, 'entry stop price') }
  }
  if (intent.entry.type === 'stop-limit') {
    return {
      stopPrice: decimalNumber(intent.entry.stop_price, 'entry stop price'),
      price: decimalNumber(intent.entry.limit_price, 'entry limit price'),
    }
  }
  return {}
}

const tradovateClientOrderId = (command: ExecutionCommand): string => (
  `tg-${command.idempotency_key.slice(0, 56)}`
)

const parsePositiveAccountId = (accountRef: string): number => {
  const accountId = Number(accountRef)
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new ExecutionGatewayError(
      'ACCOUNT_MISMATCH',
      'Tradovate account reference must be its positive numeric account ID.',
    )
  }
  return accountId
}

const normalizeProviderCode = (value: string): string => (
  value.replace(/[^A-Za-z0-9._:@-]/g, '-').slice(0, 120) || 'TradovateRejected'
)

const isWorking = (status: string): boolean => (
  ['Working', 'Pending', 'PendingNew', 'PartiallyFilled'].includes(status)
)

const isRejected = (status: string): boolean => (
  ['Rejected', 'Suspended'].includes(status)
)

const normalizedOrderType = (
  value: string,
): 'market' | 'limit' | 'stop' | 'stop-limit' => {
  if (value === 'Market') return 'market'
  if (value === 'Limit') return 'limit'
  if (value === 'Stop') return 'stop'
  if (value === 'StopLimit') return 'stop-limit'
  throw new ExecutionGatewayError(
    'RECONCILIATION_DIVERGENCE',
    `Tradovate order type ${value} is not normalized by adapter 1.0.0.`,
  )
}

const latestBy = <T extends { id: number }>(
  values: T[],
  key: (value: T) => number,
): Map<number, T> => {
  const result = new Map<number, T>()
  for (const value of values) {
    const existing = result.get(key(value))
    if (!existing || value.id > existing.id) result.set(key(value), value)
  }
  return result
}

const requiredContractName = (contracts: Map<number, string>, contractId: number): string => {
  const name = contracts.get(contractId)
  if (!name) {
    throw new ExecutionGatewayError(
      'RECONCILIATION_DIVERGENCE',
      `Tradovate contract ${contractId} is missing from provider truth.`,
    )
  }
  return name
}

const requireFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExecutionGatewayError(
      'RECONCILIATION_DIVERGENCE',
      `${label} is missing or invalid.`,
    )
  }
  return value
}

const decimalNumber = (value: string, label: string): number => {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      `Tradovate ${label} is outside the certified numeric range.`,
    )
  }
  return number
}

const reconciliation = (
  input: { connection: TradingConnection; command: ExecutionCommand },
  value: {
    status: ExecutionReconciliation['status']
    providerOrderIds: string[]
    filledQuantity: number
    averageFillPrice?: number
    protectionVerified: boolean
    reason: string
  },
  now: string,
): ExecutionReconciliation => executionReconciliationSchema.parse({
  reconciliation_schema_version: EXECUTION_RECONCILIATION_SCHEMA_VERSION,
  reconciliation_id: `reconciliation-${input.command.command_id}`,
  command_id: input.command.command_id,
  connection_id: input.connection.connection_id,
  status: value.status,
  provider_order_ids: value.providerOrderIds,
  filled_quantity: value.filledQuantity,
  ...(typeof value.averageFillPrice === 'number'
    ? { average_fill_price: String(value.averageFillPrice) }
    : {}),
  protection_verified: value.protectionVerified,
  evidence_refs: value.providerOrderIds.map((id) => `tradovate-order-${id}`),
  reconciled_at: now,
  reason: value.reason,
})

export const buildTradovateAccountSnapshot = (input: {
  connection: TradingConnection
  capturedAt: string
  balance: number
  realizedPnl: number
  openPnl: number
  canTrade: boolean
  positions?: ExecutionAccountSnapshot['positions']
  workingOrders?: ExecutionAccountSnapshot['working_orders']
}): ExecutionAccountSnapshot => executionAccountSnapshotSchema.parse({
  account_snapshot_schema_version: EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  account_snapshot_id: `tradovate-snapshot-${Date.parse(input.capturedAt)}`,
  connection_id: input.connection.connection_id,
  account_ref: input.connection.account_ref,
  environment: input.connection.environment,
  captured_at: input.capturedAt,
  can_trade: input.canTrade,
  balance: String(input.balance),
  realized_pnl: String(input.realizedPnl),
  open_pnl: String(input.openPnl),
  positions: input.positions ?? [],
  working_orders: input.workingOrders ?? [],
})
