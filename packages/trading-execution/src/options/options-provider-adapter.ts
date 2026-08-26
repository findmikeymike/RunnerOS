import type { OptionContractIdentity, OptionQuoteSnapshot } from '@trade-god/contracts'

export type OptionsProviderOrderRequest = {
  account_id: string
  canonical_contract_id: string
  provider_instrument_id: string
  action: 'BUY_TO_OPEN'
  order_type: 'limit'
  limit_price: string
  quantity: number
  time_in_force: 'day'
  regular_hours_only: true
  client_order_id: string
}

export type OptionsProviderOrderStatus =
  | 'working'
  | 'partially-filled'
  | 'filled'
  | 'canceled'
  | 'partially-filled-canceled'

export type OptionsProviderOrder = OptionsProviderOrderRequest & {
  provider_order_id: string
  status: OptionsProviderOrderStatus
  filled_quantity: number
  average_fill_price?: string
}

export type OptionsProviderAccountSnapshot = {
  account_id: string
  positions: Array<{ canonical_contract_id: string; quantity: number; average_price: string }>
  orders: OptionsProviderOrder[]
}

export interface OptionsProviderAdapter {
  readonly descriptor: {
    adapter_id: string
    adapter_version: string
    provider_contract_version: string
    environment: 'paper'
    credential_generation: string
    preview_supported: true
  }
  resolveContract(query: {
    underlying: string
    expiration: string
    strike: string
    right: 'call' | 'put'
  }): Promise<OptionContractIdentity>
  quote(canonicalContractId: string): Promise<OptionQuoteSnapshot>
  preview(request: OptionsProviderOrderRequest): Promise<{
    estimated_debit: string
    estimated_fees: string
    buying_power_impact: string
  }>
  submit(request: OptionsProviderOrderRequest): Promise<OptionsProviderOrder>
  getOrderByClientId(accountId: string, clientOrderId: string): Promise<OptionsProviderOrder | null>
  snapshotAccount(accountId: string): Promise<OptionsProviderAccountSnapshot>
}
