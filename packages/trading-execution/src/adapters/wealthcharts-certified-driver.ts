import {
  type ExecutionAccountSnapshot,
  type ExecutionCommand,
  type ExecutionReconciliation,
  type OrderIntent,
  type TradingConnection,
} from '@trade-god/contracts'

import { computeActionDigest } from '../canonical.ts'
import { ExecutionAdapterError, ExecutionGatewayError } from '../errors.ts'
import type {
  WealthChartsBrowserDriver,
  WealthChartsSessionIdentity,
  WealthChartsVisibleDraft,
} from './wealthcharts-browser-adapter.ts'

export const WEALTHCHARTS_SELECTOR_BUNDLE_VERSION = 'wealthcharts-selectors@1'

export interface WealthChartsOrderTicket {
  account_ref: string
  environment: TradingConnection['environment']
  symbol: string
  side: OrderIntent['side']
  quantity: number
  entry: OrderIntent['entry']
  protection: OrderIntent['protection']
  time_in_force: OrderIntent['time_in_force']
}

export interface WealthChartsSubmissionEvidence {
  confirmation_visible: boolean
  provider_order_ids: string[]
  evidence_refs: string[]
}

/**
 * Trusted, platform-specific browser seam. Implementations may use Electron/CDP,
 * but they expose named WealthCharts operations rather than generic script,
 * selector, coordinate, or browser controls.
 */
export interface WealthChartsNamedAutomationPort {
  inspectSession(connection: TradingConnection): Promise<WealthChartsSessionIdentity>
  readAccountSnapshot(connection: TradingConnection): Promise<ExecutionAccountSnapshot>
  writeOrderTicket(input: {
    connection: TradingConnection
    command_id: string
    ticket: WealthChartsOrderTicket
  }): Promise<void>
  readVisibleOrderTicket(input: {
    connection: TradingConnection
    command_id: string
  }): Promise<WealthChartsOrderTicket>
  clickOrderSubmitOnce(input: {
    connection: TradingConnection
    command_id: string
    side: OrderIntent['side']
  }): Promise<void>
  readSubmissionEvidence(input: {
    connection: TradingConnection
    command_id: string
  }): Promise<WealthChartsSubmissionEvidence>
  readReconciliation(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<ExecutionReconciliation>
}

export class WealthChartsCertifiedDriver implements WealthChartsBrowserDriver {
  private readonly prepared = new Map<string, {
    connection_id: string
    side: OrderIntent['side']
  }>()

  constructor(private readonly port: WealthChartsNamedAutomationPort) {}

  verifySession(connection: TradingConnection): Promise<WealthChartsSessionIdentity> {
    return this.port.inspectSession(connection)
  }

  readAccountSnapshot(connection: TradingConnection): Promise<ExecutionAccountSnapshot> {
    return this.port.readAccountSnapshot(connection)
  }

  async prepareBracketDraft(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<WealthChartsVisibleDraft> {
    const ticket = ticketFromIntent(input.connection, input.intent)
    await this.port.writeOrderTicket({
      connection: input.connection,
      command_id: input.command.command_id,
      ticket,
    })
    const visible = await this.port.readVisibleOrderTicket({
      connection: input.connection,
      command_id: input.command.command_id,
    })
    const visibleIntent: OrderIntent = {
      ...input.intent,
      instrument: {
        ...input.intent.instrument,
        symbol: visible.symbol,
      },
      side: visible.side,
      quantity: visible.quantity,
      entry: visible.entry,
      protection: visible.protection,
      time_in_force: visible.time_in_force,
    }
    const actionDigest = computeActionDigest(visibleIntent, {
      ...input.connection,
      account_ref: visible.account_ref,
      environment: visible.environment,
    })
    if (actionDigest === input.command.action_digest) {
      this.prepared.set(input.command.command_id, {
        connection_id: input.connection.connection_id,
        side: visible.side,
      })
    } else {
      this.prepared.delete(input.command.command_id)
    }
    return {
      action_digest: actionDigest,
      account_ref: visible.account_ref,
      environment: visible.environment,
      symbol: visible.symbol,
      side: visible.side,
      quantity: visible.quantity,
      entry_type: visible.entry.type,
      stop_loss: visible.protection.stop_loss.value,
      take_profit: visible.protection.take_profit?.value,
    }
  }

  async submitOnce(input: {
    connection: TradingConnection
    command: ExecutionCommand
  }): Promise<WealthChartsSubmissionEvidence> {
    const prepared = this.prepared.get(input.command.command_id)
    if (!prepared || prepared.connection_id !== input.connection.connection_id) {
      throw new ExecutionAdapterError(
        'WEALTHCHARTS_NOT_PREPARED',
        'WealthCharts command has no current verified preparation.',
        false,
      )
    }
    this.prepared.delete(input.command.command_id)
    await this.port.clickOrderSubmitOnce({
      connection: input.connection,
      command_id: input.command.command_id,
      side: prepared.side,
    })
    return this.port.readSubmissionEvidence({
      connection: input.connection,
      command_id: input.command.command_id,
    })
  }

  reconcile(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<ExecutionReconciliation> {
    return this.port.readReconciliation(input)
  }
}

const ticketFromIntent = (
  connection: TradingConnection,
  intent: OrderIntent,
): WealthChartsOrderTicket => {
  if (intent.entry.type === 'stop-limit') {
    throw new ExecutionGatewayError(
      'CAPABILITY_UNAVAILABLE',
      'WealthCharts selector bundle 1 does not certify stop-limit entry.',
    )
  }
  return {
    account_ref: connection.account_ref,
    environment: connection.environment,
    symbol: intent.instrument.symbol,
    side: intent.side,
    quantity: intent.quantity,
    entry: intent.entry,
    protection: intent.protection,
    time_in_force: intent.time_in_force,
  }
}
