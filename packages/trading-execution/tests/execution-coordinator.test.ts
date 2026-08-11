import { describe, expect, test } from 'bun:test'

import type { ExecutionAuthorization, ExecutionRecord } from '@trade-god/contracts'

import { PaperExecutionCoordinator } from '../src/index.ts'

const authorization = {
  authorization_schema_version: 'execution-authorization@1',
  authorization_id: 'mandate-paper-one',
  connection_id: 'connection-paper-one',
  mode: 'standing-mandate',
  scope: {
    symbols: ['ESU6'],
    max_contracts: 1,
    allowed_sides: ['buy'],
    allowed_order_types: ['limit'],
    session_start: '2026-08-10T14:00:00.000Z',
    session_end: '2026-08-10T16:00:00.000Z',
    max_daily_loss: '500',
    max_open_risk: '100',
  },
  issued_by: 'operator-michael',
  issued_at: '2026-08-10T15:00:00.000Z',
  expires_at: '2026-08-10T16:00:00.000Z',
} as ExecutionAuthorization

const record = (state: ExecutionRecord['state'] = 'created'): ExecutionRecord => ({
  record_schema_version: 'execution-record@1',
  trace_id: 'trace-one',
  intent: {
    intent_schema_version: 'order-intent@1',
    intent_id: 'intent-one',
    source: { type: 'discord', source_id: 'route-one', author_id: 'author-one' },
    connection_id: 'connection-paper-one',
    instrument: { canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME' },
    side: 'buy',
    quantity: 1,
    entry: { type: 'limit', price: '5600' },
    protection: { stop_loss: { type: 'price', value: '5598' } },
    max_loss_usd: '100',
    time_in_force: 'day',
    created_at: '2026-08-10T15:00:00.000Z',
    valid_until: '2026-08-10T15:01:00.000Z',
    content_checksum: 'a'.repeat(64),
  },
  state,
  management_actions: [],
  transitions: [],
  created_at: '2026-08-10T15:00:00.000Z',
  updated_at: '2026-08-10T15:00:00.000Z',
})

const authorizationStore = (
  getActive: () => Promise<ExecutionAuthorization | null>,
) => ({
  getActive,
  save: async (value: ExecutionAuthorization) => value,
  revoke: async () => true,
})

describe('paper execution coordinator', () => {
  test('remains inert without an adapter, mandate, or released global halt', async () => {
    let current = record()
    let evaluateCount = 0
    const gateway = {
      readControl: async () => ({ global_kill: false, connection_kills: [], source_kills: [], updated_at: '' }),
      get: async () => current,
      list: async () => [current],
      evaluateAndApprove: async () => { evaluateCount += 1; return current },
      execute: async () => current,
    }
    const noAdapter = new PaperExecutionCoordinator(
      gateway,
      authorizationStore(async () => authorization),
      () => false,
    )
    expect((await noAdapter.coordinate('intent-one')).state).toBe('created')

    const noMandate = new PaperExecutionCoordinator(
      gateway,
      authorizationStore(async () => null),
      () => true,
    )
    expect((await noMandate.coordinate('intent-one')).state).toBe('created')
    expect(evaluateCount).toBe(0)
  })

  test('risk-reviews then executes only the exact active mandate', async () => {
    let current = record()
    let executeCount = 0
    const gateway = {
      readControl: async () => ({ global_kill: false, connection_kills: [], source_kills: [], updated_at: '' }),
      get: async () => current,
      list: async () => [current],
      evaluateAndApprove: async () => {
        current = { ...current, state: 'approved', authorization }
        return current
      },
      execute: async () => {
        executeCount += 1
        current = { ...current, state: 'protected' }
        return current
      },
    }
    const coordinator = new PaperExecutionCoordinator(
      gateway,
      authorizationStore(async () => authorization),
      () => true,
    )

    expect((await coordinator.coordinate('intent-one')).state).toBe('protected')
    expect(executeCount).toBe(1)
  })

  test('does not execute an approval after its mandate was replaced or revoked', async () => {
    const approved = { ...record('approved'), authorization }
    let executeCount = 0
    const coordinator = new PaperExecutionCoordinator(
      {
        readControl: async () => ({ global_kill: false, connection_kills: [], source_kills: [], updated_at: '' }),
        get: async () => approved,
        list: async () => [approved],
        evaluateAndApprove: async () => approved,
        execute: async () => { executeCount += 1; return approved },
      },
      authorizationStore(async () => ({ ...authorization, authorization_id: 'replacement-mandate' })),
      () => true,
    )

    expect((await coordinator.coordinate('intent-one')).state).toBe('approved')
    expect(executeCount).toBe(0)
  })

  test('refuses same-id limit changes and revocation during risk evaluation', async () => {
    let currentAuthorization: ExecutionAuthorization | null = authorization
    let current = record()
    let executeCount = 0
    let revokePromise: Promise<boolean> | undefined
    let coordinator!: PaperExecutionCoordinator
    const store = {
      getActive: async () => currentAuthorization,
      save: async (value: ExecutionAuthorization) => {
        currentAuthorization = value
        return value
      },
      revoke: async () => {
        currentAuthorization = null
        return true
      },
    }
    coordinator = new PaperExecutionCoordinator(
      {
        readControl: async () => ({ global_kill: false, connection_kills: [], source_kills: [], updated_at: '' }),
        get: async () => current,
        list: async () => [current],
        evaluateAndApprove: async () => {
          current = { ...current, state: 'approved', authorization }
          revokePromise = coordinator.revokeAuthorization(authorization.connection_id)
          return current
        },
        execute: async () => { executeCount += 1; return current },
      },
      store,
      () => true,
    )

    expect((await coordinator.coordinate('intent-one')).state).toBe('approved')
    await revokePromise
    expect(executeCount).toBe(0)

    currentAuthorization = { ...authorization, scope: { ...authorization.scope, max_open_risk: '50' } }
    current = { ...record('approved'), authorization }
    expect((await coordinator.coordinate('intent-one')).state).toBe('approved')
    expect(executeCount).toBe(0)
  })

  test('refuses a same-id replacement that arrives during the final mandate read', async () => {
    let currentAuthorization: ExecutionAuthorization | null = authorization
    let current = record()
    let executeCount = 0
    let activeReads = 0
    let replacementPromise: Promise<ExecutionAuthorization> | undefined
    let coordinator!: PaperExecutionCoordinator
    const replacement = {
      ...authorization,
      scope: { ...authorization.scope, max_contracts: 1, max_open_risk: '50' },
    }
    const store = {
      getActive: async () => {
        activeReads += 1
        if (activeReads === 2) replacementPromise = coordinator.saveAuthorization(replacement)
        return currentAuthorization
      },
      save: async (value: ExecutionAuthorization) => {
        currentAuthorization = value
        return value
      },
      revoke: async () => true,
    }
    coordinator = new PaperExecutionCoordinator(
      {
        readControl: async () => ({ global_kill: false, connection_kills: [], source_kills: [], updated_at: '' }),
        get: async () => current,
        list: async () => [current],
        evaluateAndApprove: async () => {
          current = { ...current, state: 'approved', authorization }
          return current
        },
        execute: async () => { executeCount += 1; return current },
      },
      store,
      () => true,
    )

    expect((await coordinator.coordinate('intent-one')).state).toBe('approved')
    await replacementPromise
    expect(executeCount).toBe(0)
    expect(currentAuthorization).toMatchObject({ scope: { max_open_risk: '50' } })
  })
})
