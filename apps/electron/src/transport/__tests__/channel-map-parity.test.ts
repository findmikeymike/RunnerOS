import { describe, it, expect } from 'bun:test'
import type { ElectronAPI } from '../../shared/types'
import { CHANNEL_MAP } from '../channel-map'

type AnyFn = (...args: any[]) => any

type FunctionKeys<T> = {
  [K in keyof T]-?: Extract<T[K], AnyFn> extends never ? never : K
}[keyof T] & string

type BrowserPaneKeys = `browserPane.${FunctionKeys<ElectronAPI['browserPane']>}`

// Methods excluded from CHANNEL_MAP because they are implemented directly in the preload
// (no IPC round-trip to the main process). Each reads local state or orchestrates client-side.
type ApiToChannelMapKeys = Exclude<
  FunctionKeys<ElectronAPI>,
  | 'performOAuth'
  | 'getTransportConnectionState'
  | 'getRuntimeEnvironment'
  | 'onTransportConnectionStateChanged'
  | 'reconnectTransport'
  | 'isChannelAvailable'
  | 'getSystemWarnings' // reads env var set at startup — no IPC needed
  | 'relaunchApp' // direct IPC to main process — not through WS RPC
  | 'removeWorkspace' // direct IPC to main process — modifies local config
  | 'invokeOnServer' // direct IPC to main process — cross-server RPC
  | 'transferSessionToWorkspace' // direct IPC to main process — orchestrated remote transfer
  | 'onTransferProgress' // direct IPC listener — chunk upload progress
  | 'changeLanguage' // direct IPC to main process — syncs i18n language
  | 'captureVisualElement' // direct IPC to main process — captures the renderer window
  | 'getFilePath' // renderer-local — webUtils.getPathForFile, no IPC round-trip
  | 'getTradeGodHealth' // direct local Trade God sidecar IPC
  | 'analyzeTradeGodFixture' // direct local Trade God sidecar IPC
  | 'interpretTradeGodFixture' // direct local Trade God specialist IPC
  | 'cancelTradeGodAnalysis' // direct local Trade God sidecar IPC
  | 'listTradeGodAlerts' // direct local Trade God alert ledger IPC
  | 'acknowledgeTradeGodAlert' // direct local Trade God alert ledger IPC
  | 'getTradeGodAlertIngestionStatus' // direct local Trade God receiver IPC
  | 'getTradeGodAlertWebhookSetup' // direct local Trade God receiver IPC
  | 'getIbkrGatewayHealth' // direct local IB Gateway health IPC
  | 'getSyntheticTradeGodChartFixture' // direct local synthetic chart fixture IPC
  | 'listTradingConnections' // direct local Trading Connections IPC
  | 'saveTradingConnection' // direct local Trading Connections IPC
  | 'removeTradingConnection' // direct local Trading Connections IPC
  | 'openTradingConnectionLogin' // direct local isolated browser-session IPC
  | 'confirmTradingConnectionLogin' // direct local isolated browser-session IPC
  | 'verifyTradingConnection' // direct local read-only provider verification IPC
  | 'listTradingSignalRoutes' // direct local trading signal-route IPC
  | 'saveTradingSignalRoute' // direct local trading signal-route IPC
  | 'removeTradingSignalRoute' // direct local trading signal-route IPC
  | 'listMirrorGroups' // direct local Mirror Group configuration IPC
  | 'saveMirrorGroup' // direct local Mirror Group revision IPC
  | 'getDiscoTraderWebhookSecretStatus' // direct local encrypted-vault IPC
  | 'saveDiscoTraderWebhookSecret' // direct local encrypted-vault IPC
  | 'getTradeGodExecutionControl' // direct local execution-control IPC
  | 'setTradeGodGlobalExecutionKill' // direct local execution-control IPC
  | 'setTradeGodConnectionExecutionKill' // direct local account-halt IPC
  | 'listTradeGodStandingAuthorizations' // direct local paper-mandate IPC
  | 'saveTradeGodStandingAuthorization' // direct local paper-mandate IPC
  | 'revokeTradeGodStandingAuthorization' // direct local paper-mandate IPC
  | 'onTradeGodAlert' // direct local Trade God alert listener
> | BrowserPaneKeys
type ChannelMapKeys = keyof typeof CHANNEL_MAP & string

type AssertNever<T extends never> = true

// Compile-time guardrails: if these fail, CHANNEL_MAP and ElectronAPI drifted.
const _missingFromMap: AssertNever<Exclude<ApiToChannelMapKeys, ChannelMapKeys>> = true
const _extraInMap: AssertNever<Exclude<ChannelMapKeys, ApiToChannelMapKeys>> = true

void _missingFromMap
void _extraInMap

describe('CHANNEL_MAP runtime contract', () => {
  it('has valid entry kinds and channels', () => {
    for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
      expect(typeof method).toBe('string')
      expect(entry.type === 'invoke' || entry.type === 'listener').toBe(true)
      expect(typeof entry.channel).toBe('string')
      expect(entry.channel.length).toBeGreaterThan(0)

      if (entry.type === 'listener') {
        expect((entry as any).transform).toBeUndefined()
      }
    }
  })

  it('contains at least one listener and one invoke entry', () => {
    const values = Object.values(CHANNEL_MAP)
    expect(values.some((entry) => entry.type === 'listener')).toBe(true)
    expect(values.some((entry) => entry.type === 'invoke')).toBe(true)
  })
})
