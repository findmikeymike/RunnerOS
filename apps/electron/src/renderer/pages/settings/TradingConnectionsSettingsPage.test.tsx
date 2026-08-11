import { expect, mock, test } from 'bun:test'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const {
  findSignalRouteByIdentity,
  isExecutionReady,
} = await import('./TradingConnectionsSettingsPage.tsx')

test('execution readiness requires both certification state and explicit enablement', () => {
  expect(isExecutionReady({ connection: { state: 'ready', enabled: false } } as any)).toBe(false)
  expect(isExecutionReady({ connection: { state: 'ready', enabled: true } } as any)).toBe(true)
  expect(isExecutionReady({ connection: { state: 'auth-required', enabled: true } } as any)).toBe(false)
})

test('Discord source identity lookup is exact and independent of target account', () => {
  const route = {
    route_id: 'discord-1-2-3',
    server_id: '1',
    channel_id: '2',
    trader_author_id: '3',
    connection_id: 'account-one',
  } as any
  expect(findSignalRouteByIdentity([route], {
    serverId: '1', channelId: '2', traderAuthorId: '3',
  })).toBe(route)
  expect(findSignalRouteByIdentity([route], {
    serverId: '1', channelId: '2', traderAuthorId: '4',
  })).toBeUndefined()
})
