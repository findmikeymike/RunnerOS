export type TradingConnectionsMarket = 'futures' | 'options'

export const TRADING_CONNECTIONS_MARKET_KEY = 'trade-god:connections-market'

export function readTradingConnectionsMarket(): TradingConnectionsMarket {
  if (typeof window === 'undefined') return 'futures'
  return window.sessionStorage.getItem(TRADING_CONNECTIONS_MARKET_KEY) === 'options'
    ? 'options'
    : 'futures'
}

export function openTradingConnections(market: TradingConnectionsMarket): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(TRADING_CONNECTIONS_MARKET_KEY, market)
  window.dispatchEvent(new CustomEvent('trade-god:view', { detail: 'accounts' }))
}
