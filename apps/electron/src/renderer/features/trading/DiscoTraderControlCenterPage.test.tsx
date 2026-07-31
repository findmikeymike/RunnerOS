import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TRADE_DESK_AGENT } from '@craft-agent/shared/agent-definitions/trade-god-starter-templates'
import type { AgentDefinitionDTO, FolderSourceConfig } from '../../../shared/types'

import DiscoTraderControlCenterPage, {
  isAuditedDiscoTraderSource,
  isAuditedTradeDeskWorker,
} from './DiscoTraderControlCenterPage.tsx'

test('renders an honest approval-gated DiscoTrader setup path', () => {
  const html = renderToStaticMarkup(
    <DiscoTraderControlCenterPage workspaceId="trading" />,
  )

  expect(html).toContain('DiscoTrader Control Center')
  expect(html).toContain('One-time setup')
  expect(html).toContain('Connect the signed local source')
  expect(html).toContain('Install the Trade Desk worker')
  expect(html).toContain('Every tool call remains approval-gated')
  expect(html).toContain('Halt / flatten')
  expect(html).not.toContain('Autonomous execution enabled')
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
    },
  }

  expect(isAuditedDiscoTraderSource(source)).toBe(true)
  expect(isAuditedDiscoTraderSource({
    ...source,
    mcp: { ...source.mcp, url: 'https://example.com/mcp' },
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
