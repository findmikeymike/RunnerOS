import type {
  ExecutionAccountSnapshot,
  ExecutionCapabilities,
  ExecutionCommand,
  ExecutionManagementAcknowledgment,
  ExecutionManagementCommand,
  ExecutionReconciliation,
  ExecutionSubmitAcknowledgment,
  ExecutionTransport,
  OrderIntent,
  TradingConnection,
} from '@trade-god/contracts'

export interface ExecutionAdapterDescriptor {
  adapter_id: string
  adapter_version: string
  provider_contract_version: string
  transport: ExecutionTransport
  capabilities: ExecutionCapabilities
}

export interface ExecutionAdapter {
  readonly descriptor: ExecutionAdapterDescriptor
  supports(connection: TradingConnection): boolean
  connect(connection: TradingConnection): Promise<void>
  snapshotAccount(connection: TradingConnection): Promise<ExecutionAccountSnapshot>
  submit(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
  }): Promise<ExecutionSubmitAcknowledgment>
  manage(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand: ExecutionManagementCommand
  }): Promise<ExecutionManagementAcknowledgment>
  reconcile(input: {
    connection: TradingConnection
    intent: OrderIntent
    command: ExecutionCommand
    managementCommand?: ExecutionManagementCommand
  }): Promise<ExecutionReconciliation>
}
