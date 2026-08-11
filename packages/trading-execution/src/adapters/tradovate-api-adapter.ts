import {
  EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
  EXECUTION_PROTECTION_ORDER_SCHEMA_VERSION,
  EXECUTION_RECONCILIATION_SCHEMA_VERSION,
  EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
  executionAccountSnapshotSchema,
  executionManagementAcknowledgmentSchema,
  executionReconciliationSchema,
  executionSubmitAcknowledgmentSchema,
  type ExecutionAccountSnapshot,
  type ExecutionCommand,
  type ExecutionManagementAcknowledgment,
  type ExecutionManagementCommand,
  type ExecutionProtectionOrder,
  type ExecutionReconciliation,
  type OrderIntent,
  type TradingConnection,
} from '@trade-god/contracts'

import type { ExecutionAdapter } from '../adapter.ts'
import { computeManagementAcknowledgmentChecksum, sha256 } from '../canonical.ts'
import { ExecutionAdapterError, ExecutionGatewayError } from '../errors.ts'
import type { TradovateSessionManager } from './tradovate-session-manager.ts'

export interface TradovateCredential {
  access_token: string
  account_id: number
  account_spec: string
  expires_at?: string
}

export const parseTradovateCredential = (input: string): TradovateCredential => {
  let value: unknown
  try { value = JSON.parse(input) } catch {
    throw new ExecutionGatewayError(
      'CONNECTION_UNAVAILABLE',
      'Stored Tradovate credential is not valid structured credential data.',
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Stored Tradovate credential is invalid.')
  }
  const credential = value as Record<string, unknown>
  if (
    typeof credential.access_token !== 'string'
    || credential.access_token.trim().length < 16
    || typeof credential.account_id !== 'number'
    || !Number.isSafeInteger(credential.account_id)
    || credential.account_id <= 0
    || typeof credential.account_spec !== 'string'
    || !credential.account_spec.trim()
    || typeof credential.expires_at !== 'string'
    || !Number.isFinite(Date.parse(credential.expires_at))
  ) {
    throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Stored Tradovate credential is incomplete.')
  }
  return {
    access_token: credential.access_token.trim(),
    account_id: credential.account_id,
    account_spec: credential.account_spec.trim(),
    expires_at: new Date(credential.expires_at).toISOString(),
  }
}

export const serializeTradovateCredential = (credential: TradovateCredential): string => (
  JSON.stringify(parseTradovateCredential(JSON.stringify(credential)))
)

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
  price?: number
  stopPrice?: number
  timeInForce?: string
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
  resolveContract(connection: TradingConnection, symbol: string): Promise<{
    id: number
    name: string
    expiration_date: string
  }>
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
  manage(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand: ExecutionManagementCommand
  }): Promise<{
    providerCommandIds: number[]
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
  resolveCredential?: TradovateCredentialResolver
  sessionManager?: Pick<TradovateSessionManager, 'credential'>
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
  price?: number
  stopPrice?: number
  timeInForce?: string
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
  contractMaturityId: number
}

interface TradovateContractMaturity {
  id: number
  expirationDate: string
}

export class TradovateFetchClient implements TradovateRestClient {
  private readonly fetchImpl: TradovateFetch
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly backoffUntil = new Map<string, number>()

  constructor(private readonly options: TradovateFetchClientOptions) {
    if (!options.resolveCredential && !options.sessionManager) {
      throw new Error('Tradovate client requires a credential resolver or session manager.')
    }
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

  async resolveContract(
    connection: TradingConnection,
    symbol: string,
  ): Promise<{ id: number; name: string; expiration_date: string }> {
    const credential = await this.credential(connection)
    const contract = await this.requestJson<TradovateContract>(
      credential,
      `/contract/find?name=${encodeURIComponent(symbol)}`,
      { method: 'GET' },
      false,
    )
    if (
      !Number.isSafeInteger(contract.id)
      || contract.id <= 0
      || contract.name !== symbol
      || !Number.isSafeInteger(contract.contractMaturityId)
      || contract.contractMaturityId <= 0
    ) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Tradovate did not resolve the exact canonical futures contract.',
      )
    }
    const maturity = await this.requestJson<TradovateContractMaturity>(
      credential,
      `/contractMaturity/item?id=${contract.contractMaturityId}`,
      { method: 'GET' },
      false,
    )
    if (
      maturity.id !== contract.contractMaturityId
      || !Number.isFinite(Date.parse(maturity.expirationDate))
    ) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Tradovate returned invalid contract maturity evidence.',
      )
    }
    return {
      id: contract.id,
      name: contract.name,
      expiration_date: new Date(maturity.expirationDate).toISOString(),
    }
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

  async manage(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand: ExecutionManagementCommand
  }): Promise<{
    providerCommandIds: number[]
    failureReason?: string
    failureText?: string
  }> {
    const credential = await this.credential(input.connection)
    const payload = input.managementCommand.payload
    const tag = tradovateManagementTag(input.managementCommand)
    if (payload.operation === 'partial-close') {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Tradovate partial close is disabled until exit-order and protection resize semantics are certified.',
      )
    }
    if (payload.operation === 'flatten') {
      const positions = (await this.listPositions(input.connection)).filter(
        (position) => position.symbol === input.intent.instrument.symbol && position.netPos !== 0,
      )
      if (positions.length !== 1) {
        throw new ExecutionGatewayError(
          'RECONCILIATION_DIVERGENCE',
          'Tradovate flatten requires exactly one matching open contract position.',
        )
      }
      const result = await this.requestJson<{
        orderId?: number
        failureReason?: string
        failureText?: string
      }>(
        credential,
        '/order/liquidateposition',
        {
          method: 'POST',
          body: JSON.stringify({
            accountId: credential.account_id,
            contractId: positions[0]!.contractId,
            admin: false,
            customTag50: tag,
          }),
        },
        true,
      )
      return {
        providerCommandIds: typeof result.orderId === 'number' ? [result.orderId] : [],
        ...(result.failureReason ? { failureReason: result.failureReason } : {}),
        ...(result.failureText ? { failureText: result.failureText } : {}),
      }
    }

    const orders = await this.listOrders(input.connection)
    const entry = orders.find((order) => order.clOrdId === tradovateClientOrderId(input.command))
    if (
      !entry
      || entry.symbol !== input.intent.instrument.symbol
      || entry.accountId !== credential.account_id
    ) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Tradovate could not prove the management target belongs to this trade.',
      )
    }
    const ownedOrderIds = new Set([
      entry.id,
      ...orders.filter((order) => order.parentId === entry.id).map((order) => order.id),
    ])
    if (payload.operation === 'cancel') {
      const targets = payload.provider_order_ids.map((value) => parsePositiveProviderId(value))
      if (!targets.every((id) => ownedOrderIds.has(id))) {
        throw new ExecutionGatewayError(
          'ACCOUNT_MISMATCH',
          'Tradovate cancel target is not owned by this trade.',
        )
      }
      const providerCommandIds: number[] = []
      for (const orderId of targets) {
        const result = await this.requestJson<{
          commandId?: number
          failureReason?: string
          failureText?: string
        }>(
          credential,
          '/order/cancelorder',
          {
            method: 'POST',
            body: JSON.stringify({
              orderId,
              clOrdId: tag,
              isAutomated: true,
            }),
          },
          true,
        )
        if (result.failureReason || typeof result.commandId !== 'number') {
          return {
            providerCommandIds,
            failureReason: result.failureReason ?? 'TradovateCancelRejected',
            failureText: result.failureText ?? 'Tradovate did not acknowledge cancellation.',
          }
        }
        providerCommandIds.push(result.commandId)
      }
      return { providerCommandIds }
    }

    const orderId = parsePositiveProviderId(payload.provider_order_id)
    if (!ownedOrderIds.has(orderId)) {
      throw new ExecutionGatewayError(
        'ACCOUNT_MISMATCH',
        'Tradovate modify target is not owned by this trade.',
      )
    }
    const result = await this.requestJson<{
      commandId?: number
      failureReason?: string
      failureText?: string
    }>(
      credential,
      '/order/modifyorder',
      {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          clOrdId: tag,
          orderQty: payload.quantity,
          orderType: tradovateManagementOrderType(payload.order_type),
          ...(payload.limit_price
            ? { price: decimalNumber(payload.limit_price, 'modified limit price') }
            : {}),
          ...(payload.stop_price
            ? { stopPrice: decimalNumber(payload.stop_price, 'modified stop price') }
            : {}),
          timeInForce: payload.time_in_force === 'gtc' ? 'GTC' : 'Day',
          isAutomated: true,
        }),
      },
      true,
    )
    return {
      providerCommandIds: typeof result.commandId === 'number' ? [result.commandId] : [],
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      ...(result.failureText ? { failureText: result.failureText } : {}),
    }
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
          price: version.price,
          stopPrice: version.stopPrice,
          timeInForce: version.timeInForce,
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
    const credential = this.options.sessionManager
      ? await this.options.sessionManager.credential(connection)
      : await this.options.resolveCredential!(connection.credential_ref)
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
    const backoffKey = sha256({
      account_id: credential.account_id,
      account_spec: credential.account_spec,
    })
    const blockedUntil = this.backoffUntil.get(backoffKey) ?? 0
    if (blockedUntil > Date.parse(this.now())) {
      throw new ExecutionAdapterError(
        'TRADOVATE_RATE_LIMITED',
        `Tradovate requests are paused until ${new Date(blockedUntil).toISOString()}.`,
        false,
      )
    }
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
        if (response.status === 429) {
          this.backoffUntil.set(backoffKey, Date.parse(this.now()) + 60 * 60_000)
        }
        throw new ExecutionAdapterError(
          response.status === 429
            ? 'TRADOVATE_RATE_LIMITED'
            : response.status === 401
              ? 'TRADOVATE_AUTH_REQUIRED'
              : 'TRADOVATE_HTTP_ERROR',
          `Tradovate returned HTTP ${response.status}.`,
          submissionMayHaveOccurred,
        )
      }
      try {
        const body = await response.json() as T
        const penalty = tradovatePenalty(body)
        if (penalty) {
          this.backoffUntil.set(
            backoffKey,
            Date.parse(this.now()) + (penalty.captcha ? 60 * 60_000 : penalty.waitSeconds * 1_000),
          )
          throw new ExecutionAdapterError(
            penalty.captcha ? 'TRADOVATE_CAPTCHA_REQUIRED' : 'TRADOVATE_PENALTY_TICKET',
            penalty.captcha
              ? 'Tradovate requires user intervention before requests can resume.'
              : `Tradovate deferred the request for ${penalty.waitSeconds} seconds.`,
            false,
          )
        }
        return body
      } catch (error) {
        if (error instanceof ExecutionAdapterError) throw error
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

const tradovatePenalty = (body: unknown): {
  captcha: boolean
  waitSeconds: number
} | null => {
  if (!body || typeof body !== 'object') return null
  const value = body as Record<string, unknown>
  if (typeof value['p-ticket'] !== 'string' || !value['p-ticket']) return null
  return {
    captcha: value['p-captcha'] === true,
    waitSeconds: typeof value['p-time'] === 'number' && Number.isFinite(value['p-time'])
      ? Math.max(0, value['p-time'])
      : 0,
  }
}

export class TradovateApiAdapter implements ExecutionAdapter {
  readonly descriptor = {
    adapter_id: 'tradovate-api',
    adapter_version: '1.0.0',
    provider_contract_version: 'tradovate-demo-rest-2026-07',
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
      native_multi_bracket: false,
      modify_order: true,
      cancel_order: true,
      partial_close: false,
      flatten: true,
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
    const contract = await this.client.resolveContract(
      input.connection,
      input.intent.instrument.symbol,
    )
    if (
      contract.name !== input.intent.instrument.symbol
      || !Number.isSafeInteger(contract.id)
      || contract.id <= 0
    ) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'Tradovate did not resolve the exact canonical futures contract.',
      )
    }
    if (
      !Number.isFinite(Date.parse(contract.expiration_date))
      || Date.parse(contract.expiration_date) <= Date.parse(this.now())
    ) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Tradovate resolved a futures contract that is already expired.',
      )
    }
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

  async manage(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand: ExecutionManagementCommand
  }): Promise<ExecutionManagementAcknowledgment> {
    const capability = managementCapability(input.managementCommand.payload.operation)
    if (!this.descriptor.capabilities[capability]) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        `Tradovate adapter cannot perform ${input.managementCommand.payload.operation}.`,
      )
    }
    let result
    try {
      result = await this.client.manage(input)
    } catch (error) {
      if (error instanceof ExecutionAdapterError || error instanceof ExecutionGatewayError) throw error
      throw new ExecutionAdapterError(
        'TRADOVATE_MANAGEMENT_TRANSPORT',
        error instanceof Error ? error.message : 'Tradovate management transport failed.',
        true,
      )
    }
    const rejected = Boolean(result.failureReason) || result.providerCommandIds.length === 0
    const unsigned = {
      management_ack_schema_version: EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION,
      management_command_id: input.managementCommand.management_command_id,
      status: rejected ? 'rejected' : 'acknowledged',
      provider_command_ids: result.providerCommandIds.map(String),
      evidence_refs: result.providerCommandIds.map((id) => `tradovate-command-${id}`),
      acknowledged_at: this.now(),
      message: rejected
        ? result.failureText ?? result.failureReason ?? 'Tradovate rejected the management command.'
        : 'Tradovate acknowledged the management command.',
    } satisfies Omit<ExecutionManagementAcknowledgment, 'content_checksum'>
    return executionManagementAcknowledgmentSchema.parse({
      ...unsigned,
      content_checksum: computeManagementAcknowledgmentChecksum(unsigned),
    })
  }

  async reconcile(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand?: ExecutionManagementCommand
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
    const protectionOrders = activeProtection.map(normalizeProtectionOrder)
    const position = positions.find((candidate) => (
      candidate.accountId === Number(input.connection.account_ref)
      && candidate.contractId === entry.contractId
    ))
    const openQuantity = Math.abs(Math.trunc(position?.netPos ?? 0))
    const activeStops = activeProtection.filter(
      (order) => order.orderType === 'Stop' || order.orderType === 'StopLimit',
    )
    const activeContractOrders = orders.filter((order) => (
      order.contractId === entry.contractId && isWorking(order.ordStatus)
    ))
    const protectionVerified = (
      openQuantity > 0
      && activeStops.length === 1
      && Math.trunc(activeStops[0]!.orderQty) === openQuantity
      && (
        !input.intent.protection.take_profit
        || activeProtection.some((order) => order.orderType === 'Limit')
      )
    )
    if (input.managementCommand?.payload.operation === 'flatten') {
      const flat = !position || position.netPos === 0
      const safeToClose = flat && activeContractOrders.length === 0
      return reconciliation(input, {
        status: safeToClose ? 'closed' : flat ? 'divergent' : 'closing',
        providerOrderIds,
        filledQuantity,
        openQuantity,
        averageFillPrice: entry.avgPrice,
        protectionVerified: false,
        protectionOrders: [],
        reason: safeToClose
          ? 'Tradovate reports the position flat with no working contract order.'
          : flat
            ? 'Tradovate reports the position flat but a working contract order could reopen it.'
          : 'Tradovate liquidation is acknowledged but the position is not yet flat.',
      }, this.now())
    }
    if (input.managementCommand?.payload.operation === 'modify') {
      const requested = input.managementCommand.payload
      const target = orders.find((order) => String(order.id) === requested.provider_order_id)
      if (!target || !tradovateOrderMatchesModification(target, requested)) {
        return reconciliation(input, {
          status: 'divergent',
          providerOrderIds,
          filledQuantity,
          openQuantity,
          averageFillPrice: entry.avgPrice,
          protectionVerified: false,
          protectionOrders,
          reason: 'Tradovate has not verified the exact requested order modification.',
        }, this.now())
      }
    }
    if (
      input.managementCommand?.payload.operation === 'cancel'
      && input.managementCommand.payload.provider_order_ids.every((id) => (
        orders.some((order) => String(order.id) === id && isCanceled(order.ordStatus))
      ))
      && filledQuantity === 0
    ) {
      return reconciliation(input, {
        status: 'canceled',
        providerOrderIds,
        filledQuantity: 0,
        openQuantity: 0,
        protectionVerified: false,
        protectionOrders: [],
        reason: 'Tradovate reports every targeted order canceled with no fill.',
      }, this.now())
    }
    if (isRejected(entry.ordStatus)) {
      return reconciliation(input, {
        status: 'divergent',
        providerOrderIds,
        filledQuantity,
        openQuantity,
        protectionVerified: false,
        protectionOrders,
        reason: `Tradovate order is ${entry.ordStatus}.`,
      }, this.now())
    }
    if (filledQuantity === 0) {
      return reconciliation(input, {
        status: 'working',
        providerOrderIds,
        filledQuantity: 0,
        openQuantity,
        protectionVerified: false,
        protectionOrders,
        reason: 'Tradovate reports the entry working.',
      }, this.now())
    }
    if (filledQuantity < input.intent.quantity) {
      return reconciliation(input, {
        status: 'partially-filled',
        providerOrderIds,
        filledQuantity,
        openQuantity,
        averageFillPrice: entry.avgPrice,
        protectionVerified,
        protectionOrders,
        reason: 'Tradovate reports a partial fill.',
      }, this.now())
    }
    if (protectionVerified) {
      return reconciliation(input, {
        status: 'filled-protected',
        providerOrderIds,
        filledQuantity,
        openQuantity,
        averageFillPrice: entry.avgPrice,
        protectionVerified: true,
        protectionOrders,
        reason: 'Tradovate reports a full fill with active native protection.',
      }, this.now())
    }
    if (!position || position.netPos === 0) {
      if (activeContractOrders.length > 0) {
        return reconciliation(input, {
          status: 'divergent',
          providerOrderIds,
          filledQuantity,
          openQuantity: 0,
          averageFillPrice: entry.avgPrice,
          protectionVerified: false,
          protectionOrders,
          reason: 'Tradovate reports the position flat but a working contract order could reopen it.',
        }, this.now())
      }
      return reconciliation(input, {
        status: 'closed',
        providerOrderIds,
        filledQuantity,
        openQuantity: 0,
        averageFillPrice: entry.avgPrice,
        protectionVerified: false,
        protectionOrders: [],
        reason: 'Tradovate reports the filled position is flat.',
      }, this.now())
    }
    return reconciliation(input, {
      status: 'filled',
      providerOrderIds,
      filledQuantity,
      openQuantity,
      averageFillPrice: entry.avgPrice,
      protectionVerified: false,
      protectionOrders,
      reason: 'Tradovate reports a fill without verified active protection.',
    }, this.now())
  }
}

export const buildTradovateOsoBody = (
  connection: TradingConnection,
  intent: OrderIntent,
  command: ExecutionCommand,
): Record<string, unknown> => {
  if (intent.protection.exit_legs) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'Tradovate multi-leg entry requires the native multi-bracket strategy transport and paper certification.',
    )
  }
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

/** Builds the exact native multi-bracket payload; transport stays disabled until paper-certified. */
export const buildTradovateMultiBracketBody = (
  connection: TradingConnection,
  intent: OrderIntent,
  command: ExecutionCommand,
): Record<string, unknown> => {
  const legs = intent.protection.exit_legs
  const tickSize = intent.instrument.tick_size
  if (!legs || legs.length < 2 || !tickSize) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'Tradovate multi-bracket entry requires explicit exit legs and instrument tick size.',
    )
  }
  if (intent.entry.type !== 'limit' || intent.protection.stop_loss.type !== 'price') {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'Tradovate multi-bracket entry currently requires an absolute limit entry and stop.',
    )
  }
  if (legs.some((leg) => !leg.take_profit || leg.take_profit.type !== 'price')) {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'Tradovate multi-bracket entry requires one absolute take profit for every exit leg.',
    )
  }
  const entry = decimalNumber(intent.entry.price, 'entry limit price')
  const entryPrice = intent.entry.price
  const stop = decimalNumber(intent.protection.stop_loss.value, 'stop-loss price')
  decimalNumber(tickSize, 'instrument tick size')
  if (
    (intent.side === 'buy' && stop >= entry)
    || (intent.side === 'sell' && stop <= entry)
  ) {
    throw new ExecutionGatewayError('RISK_DENIED', 'Tradovate multi-bracket stop is not protective.')
  }
  const stopTicks = exactPositiveTicksBetween(
    entryPrice,
    intent.protection.stop_loss.value,
    tickSize,
    'stop loss',
  )
  const brackets = legs.map((leg) => {
    const target = decimalNumber(leg.take_profit!.value, `take-profit ${leg.leg_id}`)
    if (
      (intent.side === 'buy' && target <= entry)
      || (intent.side === 'sell' && target >= entry)
    ) {
      throw new ExecutionGatewayError('RISK_DENIED', `Tradovate target ${leg.leg_id} is not profitable.`)
    }
    const targetTicks = exactPositiveTicksBetween(
      entryPrice,
      leg.take_profit!.value,
      tickSize,
      `take-profit ${leg.leg_id}`,
    )
    return {
      qty: leg.quantity,
      profitTarget: intent.side === 'buy' ? targetTicks : -targetTicks,
      stopLoss: intent.side === 'buy' ? -stopTicks : stopTicks,
      trailingStop: false,
    }
  })
  return {
    accountSpec: connection.account_display.label,
    accountId: parsePositiveAccountId(connection.account_ref),
    symbol: intent.instrument.symbol,
    action: intent.side === 'buy' ? 'Buy' : 'Sell',
    orderStrategyTypeId: 2,
    params: JSON.stringify({
      entryVersion: {
        orderQty: intent.quantity,
        orderType: 'Limit',
        price: entry,
        timeInForce: intent.time_in_force === 'gtc' ? 'GTC' : 'Day',
      },
      brackets,
    }),
    uuid: deterministicTradovateStrategyUuid(command.idempotency_key),
    customTag50: `tg-${command.idempotency_key.slice(0, 47)}`,
  }
}

const exactPositiveTicksBetween = (
  left: string,
  right: string,
  tickSize: string,
  label: string,
): number => {
  const a = decimalFraction(left)
  const b = decimalFraction(right)
  const tick = decimalFraction(tickSize)
  const distanceNumerator = a.numerator * b.scale - b.numerator * a.scale
  const absoluteDistance = distanceNumerator < 0n ? -distanceNumerator : distanceNumerator
  const distanceScale = a.scale * b.scale
  const numerator = absoluteDistance * tick.scale
  const denominator = distanceScale * tick.numerator
  if (denominator <= 0n || numerator <= 0n || numerator % denominator !== 0n) {
    throw new ExecutionGatewayError('RISK_DENIED', `${label} is not an exact positive tick distance.`)
  }
  const ticks = numerator / denominator
  if (ticks > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', `${label} tick distance is too large.`)
  }
  return Number(ticks)
}

const decimalFraction = (value: string): { numerator: bigint; scale: bigint } => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', 'Tradovate decimal is not canonical.')
  }
  const [whole, decimals = ''] = value.split('.')
  return {
    numerator: BigInt(`${whole}${decimals}`),
    scale: 10n ** BigInt(decimals.length),
  }
}

const deterministicTradovateStrategyUuid = (idempotencyKey: string): string => {
  if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Tradovate idempotency key is invalid.')
  }
  const hex = `${idempotencyKey.slice(0, 12)}4${idempotencyKey.slice(13, 16)}8${idempotencyKey.slice(17, 32)}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
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

const tradovateManagementTag = (command: ExecutionManagementCommand): string => (
  `tg-m-${command.idempotency_key.slice(0, 59)}`
)

const parsePositiveProviderId = (value: string): number => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', 'Tradovate provider order ID is invalid.')
  }
  return id
}

const tradovateManagementOrderType = (
  value: 'market' | 'limit' | 'stop' | 'stop-limit',
): string => {
  if (value === 'market') return 'Market'
  if (value === 'limit') return 'Limit'
  if (value === 'stop') return 'Stop'
  return 'StopLimit'
}

const managementCapability = (
  operation: ExecutionManagementCommand['payload']['operation'],
): 'cancel_order' | 'modify_order' | 'partial_close' | 'flatten' => {
  if (operation === 'cancel') return 'cancel_order'
  if (operation === 'modify') return 'modify_order'
  if (operation === 'partial-close') return 'partial_close'
  return 'flatten'
}

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

const isCanceled = (status: string): boolean => (
  ['Canceled', 'Cancelled'].includes(status)
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

const normalizeProtectionOrder = (order: TradovateOrder): ExecutionProtectionOrder => {
  const orderType = normalizedOrderType(order.orderType)
  const status = order.ordStatus === 'PartiallyFilled'
    ? 'partially-filled' as const
    : order.ordStatus.startsWith('Pending')
      ? 'pending' as const
      : 'working' as const
  const stopPrice = order.stopPrice ?? (
    orderType === 'stop' || orderType === 'stop-limit' ? order.price : undefined
  )
  return {
    protection_order_schema_version: EXECUTION_PROTECTION_ORDER_SCHEMA_VERSION,
    provider_order_id: String(order.id),
    role: orderType === 'stop' || orderType === 'stop-limit'
      ? 'stop-loss'
      : 'take-profit',
    quantity: Math.max(1, Math.trunc(order.orderQty)),
    order_type: orderType,
    time_in_force: normalizeTimeInForce(order.timeInForce),
    ...(orderType === 'limit' || orderType === 'stop-limit'
      ? { limit_price: String(requireFiniteNumber(order.price, 'Tradovate protection limit price')) }
      : {}),
    ...(orderType === 'stop' || orderType === 'stop-limit'
      ? { stop_price: String(requireFiniteNumber(stopPrice, 'Tradovate protection stop price')) }
      : {}),
    status,
  }
}

const normalizeTimeInForce = (value: string | undefined): 'day' | 'gtc' => {
  if (value === 'Day') return 'day'
  if (value === 'GTC') return 'gtc'
  throw new ExecutionGatewayError(
    'RECONCILIATION_DIVERGENCE',
    'Tradovate protection time-in-force is missing or unsupported.',
  )
}

const tradovateOrderMatchesModification = (
  order: TradovateOrder,
  requested: Extract<ExecutionManagementCommand['payload'], { operation: 'modify' }>,
): boolean => {
  if (!isWorking(order.ordStatus)) return false
  if (Math.trunc(order.orderQty) !== requested.quantity) return false
  if (normalizedOrderType(order.orderType) !== requested.order_type) return false
  if (normalizeTimeInForce(order.timeInForce) !== requested.time_in_force) return false
  if (requested.limit_price !== undefined && order.price !== Number(requested.limit_price)) return false
  if (
    requested.stop_price !== undefined
    && (order.stopPrice ?? order.price) !== Number(requested.stop_price)
  ) return false
  return true
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
    openQuantity?: number
    averageFillPrice?: number
    protectionVerified: boolean
    protectionOrders?: ExecutionReconciliation['protection_orders']
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
  ...(value.openQuantity !== undefined ? { open_quantity: value.openQuantity } : {}),
  ...(typeof value.averageFillPrice === 'number'
    ? { average_fill_price: String(value.averageFillPrice) }
    : {}),
  protection_verified: value.protectionVerified,
  ...(value.protectionOrders ? { protection_orders: value.protectionOrders } : {}),
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
}): ExecutionAccountSnapshot => {
  const providerState = {
    connection_id: input.connection.connection_id,
    account_ref: input.connection.account_ref,
    environment: input.connection.environment,
    can_trade: input.canTrade,
    balance: String(input.balance),
    realized_pnl: String(input.realizedPnl),
    open_pnl: String(input.openPnl),
    positions: input.positions ?? [],
    working_orders: input.workingOrders ?? [],
  }
  return executionAccountSnapshotSchema.parse({
    account_snapshot_schema_version: EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
    account_snapshot_id: `tradovate-snapshot-${sha256(providerState).slice(0, 32)}`,
    ...providerState,
    captured_at: input.capturedAt,
  })
}
