import { expect, mock, test } from 'bun:test'
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
import { renderToStaticMarkup } from 'react-dom/server'
import { TRADE_DESK_AGENT } from '@craft-agent/shared/agent-definitions/trade-god-starter-templates'
import type { AgentDefinitionDTO, FolderSourceConfig } from '../../../shared/types'

const {
  default: DiscoTraderControlCenterPage,
  isAuditedDiscoTraderSource,
  isAuditedTradeDeskWorker,
} = await import('./DiscoTraderControlCenterPage.tsx')
const {
  discoTraderSignalSourceCatalogSchema,
  isSelectableSignalSource,
} = await import('./discotrader-signal-sources.ts')

test('keeps Futures operations in the desk and Discord setup in Connections', () => {
  const desk = renderToStaticMarkup(
    <DiscoTraderControlCenterPage workspaceId="trading" />,
  )
  const setup = renderToStaticMarkup(
    <DiscoTraderControlCenterPage mode="connections" workspaceId="trading" />,
  )

  expect(desk).toContain('Futures Desk')
  expect(desk).toContain('Paper trading is off')
  expect(desk).toContain('Manage connections')
  expect(desk).toContain('View active and past trades')
  expect(desk).toContain('Advanced troubleshooting')
  expect(desk).not.toContain('Discord signal service')
  expect(desk).not.toContain('Choose your accounts')
  expect(setup).toContain('Discord signal service')
  expect(setup).toContain('Connect Discord')
  expect(setup).not.toContain('Futures Desk')
  expect(desk).not.toContain('DT_MCP_TOKEN')
  expect(desk).not.toContain('DT_SHARED_SECRET')
  expect(desk).not.toContain('Install the Trade Desk worker')
  expect(desk).not.toContain('execution custody')
  expect(desk).not.toContain('Autonomous execution enabled')
})

test('accepts only the exact loopback DiscoTrader source contract', () => {
  const source: FolderSourceConfig = {
    id: 'discotrader_test',
    name: 'DiscoTrader',
    slug: 'discotrader',
    enabled: true,
    provider: 'discotrader',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'http://127.0.0.1:8788/mcp',
      authType: 'bearer',
      allowedTools: ['dt_status', 'dt_signal_sources', 'dt_positions', 'dt_pending_tickets', 'dt_recent_alerts'],
    },
  }

  expect(isAuditedDiscoTraderSource(source)).toBe(true)
  expect(isAuditedDiscoTraderSource({
    ...source,
    mcp: { ...source.mcp, url: 'https://example.com/mcp' },
  })).toBe(false)
  expect(isAuditedDiscoTraderSource({
    ...source,
    mcp: { ...source.mcp, allowedTools: [...source.mcp!.allowedTools!, 'dt_place_ticket'] },
  })).toBe(false)
  expect(isAuditedDiscoTraderSource({
    ...source,
    mcp: { ...source.mcp, authType: 'none' },
  })).toBe(false)
})

test('refuses a same-slug worker with expanded authority', () => {
  const worker: AgentDefinitionDTO = {
    ...TRADE_DESK_AGENT,
    path: '/tmp/trade-desk',
    source: 'global',
  }

  expect(isAuditedTradeDeskWorker(worker)).toBe(true)
  expect(isAuditedTradeDeskWorker({
    ...worker,
    metadata: {
      ...worker.metadata,
      permissionMode: 'allow-all',
    },
  })).toBe(false)
  expect(isAuditedTradeDeskWorker({
    ...worker,
    metadata: {
      ...worker.metadata,
      trustedWorkerTools: ['dt_flatten_all'],
    },
  })).toBe(false)
})

test('offers only complete, daemon-allowed, configured DiscoTrader identities for account routing', () => {
  const catalog = discoTraderSignalSourceCatalogSchema.parse({
    schemaVersion: 1,
    readOnly: true,
    configured: {
      allowlistMode: 'restricted', channelAllowlist: ['2'], truncated: false, invalidEntriesOmitted: 0,
    },
    observed: {
      limit: 100,
      truncated: false,
      sources: [{
        sourceId: 'source-1', serverId: '1', channelId: '2', threadId: null, parentChannelId: null,
        trader: {
          discordUserId: '3', configuredTraderId: 'trader-1', configuredTraderEnabled: true,
          displayName: 'Trader One', configurationStatus: 'configured-enabled',
        },
        identityStatus: 'complete', daemonAllowlistStatus: 'allowlisted',
        lastObservedAt: '2026-08-03T12:00:00.000Z', messageCount: 4, provenance: 'observed-daemon-db',
      }],
    },
  })
  expect(isSelectableSignalSource(catalog.observed.sources[0]!)).toBe(true)
  expect(isSelectableSignalSource({
    ...catalog.observed.sources[0]!,
    daemonAllowlistStatus: 'not-allowlisted',
  })).toBe(false)
  expect(isSelectableSignalSource({
    ...catalog.observed.sources[0]!,
    trader: { ...catalog.observed.sources[0]!.trader, configurationStatus: 'configured-disabled' },
  })).toBe(false)
})
