import { expect, mock, test } from 'bun:test'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const {
  findSignalRouteByIdentity,
  formatPaperMandateConfirmation,
  isExecutionReady,
  isPaperMandateEligible,
} = await import('./TradingConnectionsSettingsPage.tsx')

test('execution readiness requires both certification state and explicit enablement', () => {
  expect(isExecutionReady({ connection: { state: 'ready', enabled: false } } as any)).toBe(false)
  expect(isExecutionReady({ connection: { state: 'ready', enabled: true } } as any)).toBe(true)
  expect(isExecutionReady({ connection: { state: 'auth-required', enabled: true } } as any)).toBe(false)
})

test('automatic mandate eligibility is paper-only and lifecycle-certified', () => {
  const connection = {
    enabled: true,
    state: 'ready',
    environment: 'paper',
    environment_class: 'rehearsal',
    certifications: ['paper-lifecycle-certified'],
  }
  expect(isPaperMandateEligible({ connection } as any)).toBe(true)
  expect(isPaperMandateEligible({ connection: { ...connection, environment: 'live' } } as any)).toBe(false)
  expect(isPaperMandateEligible({ connection: { ...connection, enabled: false } } as any)).toBe(false)
  expect(isPaperMandateEligible({ connection: { ...connection, certifications: [] } } as any)).toBe(false)
})

test('paper mandate confirmation restates every authority limit', () => {
  const confirmation = formatPaperMandateConfirmation({
    accountName: 'Apex paper',
    symbols: ['ESU6', 'NQU6'],
    maxContracts: 2,
    maxOpenRisk: 100,
    maxDailyLoss: 500,
    expiresAt: new Date('2026-08-10T16:00:00.000Z'),
  })
  expect(confirmation).toContain('Apex paper')
  expect(confirmation).toContain('ESU6, NQU6')
  expect(confirmation).toContain('Max contracts/order: 2')
  expect(confirmation).toContain('Max open risk: $100')
  expect(confirmation).toContain('Max daily loss: $500')
  expect(confirmation).toContain('Expires:')
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
