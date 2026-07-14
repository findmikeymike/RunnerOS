import { semverSchema } from './common.ts'

export const PROTOCOL_VERSION = '1.0.0'
export const ANALYSIS_ARTIFACT_SCHEMA_VERSION = 'order-flow-artifact@1'
export const MARKET_TRADE_EVENT_SCHEMA_VERSION = 'market-trade-event@1'
export const MARKET_QUALITY_REPORT_SCHEMA_VERSION = 'market-quality-report@1'
export const MARKET_TRADE_BATCH_SCHEMA_VERSION = 'market-trade-batch@1'
export const MARKET_DATA_RPC_PROTOCOL_VERSION = 'market-data-rpc@1'
export const MARKET_CANDLE_SCHEMA_VERSION = 'market-candle@1'
export const MARKET_CANDLE_SERIES_SCHEMA_VERSION = 'market-candle-series@1'

export interface ProtocolCompatibility {
  compatible: true
  local_version: string
  remote_version: string
}

export function assertCompatibleProtocol(remoteVersion: string): ProtocolCompatibility {
  const local = semverSchema.parse(PROTOCOL_VERSION)
  const remote = semverSchema.parse(remoteVersion)
  const localMajor = local.split('.')[0]
  const remoteMajor = remote.split('.')[0]

  if (localMajor !== remoteMajor) {
    throw new Error(`Incompatible trading protocol: local ${local}, remote ${remote}`)
  }

  return { compatible: true, local_version: local, remote_version: remote }
}
