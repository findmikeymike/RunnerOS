import {
  EXECUTION_RECONCILIATION_SCHEMA_VERSION,
  EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
  executionAccountSnapshotSchema,
  executionReconciliationSchema,
  executionSubmitAcknowledgmentSchema,
  type ExecutionAccountSnapshot,
  type ExecutionCommand,
  type ExecutionManagementAcknowledgment,
  type ExecutionManagementCommand,
  type ExecutionReconciliation,
  type OrderIntent,
  type TradingConnection,
} from '@trade-god/contracts'

import type { ExecutionAdapter } from '../adapter.ts'
import { ExecutionAdapterError, ExecutionGatewayError } from '../errors.ts'

export interface WealthChartsSessionIdentity {
  origin: string
  connection_id: string
  account_ref: string
  environment: TradingConnection['environment']
  authenticated: boolean
  selector_bundle_version: string
}

export interface WealthChartsVisibleDraft {
  action_digest: string
  account_ref: string
  environment: TradingConnection['environment']
  symbol: string
  side: OrderIntent['side']
  quantity: number
  entry_type: OrderIntent['entry']['type']
  stop_loss: string
  take_profit?: string
}

export interface WealthChartsBrowserDriver {
  verifySession(connection: TradingConnection): Promise<WealthChartsSessionIdentity>
  readAccountSnapshot(connection: TradingConnection): Promise<ExecutionAccountSnapshot>
  prepareBracketDraft(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<WealthChartsVisibleDraft>
  submitOnce(input: {
    connection: TradingConnection
    command: ExecutionCommand
  }): Promise<{
    confirmation_visible: boolean
    provider_order_ids: string[]
    evidence_refs: string[]
  }>
  reconcile(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<ExecutionReconciliation>
}

export class WealthChartsBrowserAdapter implements ExecutionAdapter {
  readonly descriptor = {
    adapter_id: 'wealthcharts-browser',
    adapter_version: '1.0.0',
    provider_contract_version: 'wealthcharts-selectors@1',
    transport: 'browser' as const,
    capabilities: {
      read_accounts: true,
      read_orders: true,
      read_positions: true,
      read_executions: true,
      submit_market: true,
      submit_limit: true,
      submit_stop: true,
      submit_stop_limit: false,
      native_bracket: true,
      native_oco: true,
      native_multi_bracket: false,
      modify_order: false,
      cancel_order: false,
      partial_close: false,
      flatten: false,
      streaming_events: false,
    },
  }

  constructor(
    private readonly driver: WealthChartsBrowserDriver,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  supports(connection: TradingConnection): boolean {
    return (
      connection.platform.slug === 'wealthcharts'
      && connection.environment === 'paper'
      && Boolean(connection.browser_session_ref)
    )
  }

  async connect(connection: TradingConnection): Promise<void> {
    const identity = await this.driver.verifySession(connection)
    if (new URL(identity.origin).origin !== 'https://www.wealthcharts.com') {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'WealthCharts browser session is on an uncertified origin.',
      )
    }
    if (
      !identity.authenticated
      || identity.connection_id !== connection.connection_id
      || identity.account_ref !== connection.account_ref
    ) {
      throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'WealthCharts session account is not exact.')
    }
    if (identity.environment !== connection.environment) {
      throw new ExecutionGatewayError(
        'ENVIRONMENT_MISMATCH',
        'WealthCharts session environment is not exact.',
      )
    }
    if (identity.selector_bundle_version !== 'wealthcharts-selectors@1') {
      throw new ExecutionGatewayError(
        'CERTIFICATION_REQUIRED',
        'WealthCharts selector bundle drifted from the certified version.',
      )
    }
  }

  async snapshotAccount(connection: TradingConnection): Promise<ExecutionAccountSnapshot> {
    return executionAccountSnapshotSchema.parse(await this.driver.readAccountSnapshot(connection))
  }

  async submit(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }) {
    if (input.intent.protection.exit_legs) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'WealthCharts multi-leg entry is not certified.',
      )
    }
    const draft = await this.driver.prepareBracketDraft(input)
    if (
      draft.action_digest !== input.command.action_digest
      || draft.account_ref !== input.connection.account_ref
      || draft.environment !== input.connection.environment
      || draft.symbol !== input.intent.instrument.symbol
      || draft.side !== input.intent.side
      || draft.quantity !== input.intent.quantity
      || draft.entry_type !== input.intent.entry.type
      || draft.stop_loss !== input.intent.protection.stop_loss.value
      || draft.take_profit !== input.intent.protection.take_profit?.value
    ) {
      throw new ExecutionAdapterError(
        'WEALTHCHARTS_DRAFT_MISMATCH',
        'Visible WealthCharts order draft does not match the immutable execution command.',
        false,
      )
    }
    let result
    try {
      result = await this.driver.submitOnce({
        connection: input.connection,
        command: input.command,
      })
    } catch (error) {
      if (error instanceof ExecutionAdapterError) throw error
      throw new ExecutionAdapterError(
        'WEALTHCHARTS_SUBMIT_UNKNOWN',
        error instanceof Error ? error.message : 'WealthCharts submission confirmation failed.',
        true,
      )
    }
    if (
      !result.confirmation_visible
      || result.provider_order_ids.length === 0
      || result.evidence_refs.length === 0
    ) {
      throw new ExecutionAdapterError(
        'WEALTHCHARTS_SUBMIT_UNKNOWN',
        'WealthCharts click completed without exact visible provider confirmation and evidence.',
        true,
      )
    }
    return executionSubmitAcknowledgmentSchema.parse({
      submit_ack_schema_version: EXECUTION_SUBMIT_ACK_SCHEMA_VERSION,
      command_id: input.command.command_id,
      status: 'acknowledged',
      provider_order_ids: result.provider_order_ids,
      acknowledged_at: this.now(),
    })
  }

  async manage(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand: ExecutionManagementCommand
  }): Promise<ExecutionManagementAcknowledgment> {
    void input
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'WealthCharts management controls remain disabled until the exact paper DOM bundle is certified.',
    )
  }

  async reconcile(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<ExecutionReconciliation> {
    const result = executionReconciliationSchema.parse(await this.driver.reconcile(input))
    if (
      result.reconciliation_schema_version !== EXECUTION_RECONCILIATION_SCHEMA_VERSION
      || result.command_id !== input.command.command_id
      || result.connection_id !== input.connection.connection_id
    ) {
      throw new ExecutionGatewayError(
        'RECONCILIATION_DIVERGENCE',
        'WealthCharts reconciliation identity does not match the execution command.',
      )
    }
    return result
  }
}
