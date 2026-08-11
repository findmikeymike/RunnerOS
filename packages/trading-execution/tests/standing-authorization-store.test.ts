import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  type ExecutionAuthorization,
} from '@trade-god/contracts'

import { FileStandingAuthorizationStore } from '../src/index.ts'

const roots: string[] = []
const NOW = '2026-08-10T15:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const authorization = (overrides: Partial<ExecutionAuthorization> = {}): ExecutionAuthorization => ({
  authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  authorization_id: 'mandate-paper-one',
  connection_id: 'connection-paper-one',
  mode: 'standing-mandate',
  scope: {
    symbols: ['ESU6'],
    max_contracts: 1,
    allowed_sides: ['buy', 'sell'],
    allowed_order_types: ['market', 'limit'],
    session_start: NOW,
    session_end: '2026-08-10T17:00:00.000Z',
    max_daily_loss: '500',
    max_open_risk: '100',
  },
  issued_by: 'operator-michael',
  issued_at: NOW,
  expires_at: '2026-08-10T17:00:00.000Z',
  ...overrides,
})

describe('standing paper authorization store', () => {
  test('persists one active mandate per connection and revokes it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-mandate-'))
    roots.push(root)
    const store = new FileStandingAuthorizationStore(root, () => NOW)

    await store.save(authorization())
    expect(await new FileStandingAuthorizationStore(root, () => NOW).getActive('connection-paper-one'))
      .toMatchObject({ authorization_id: 'mandate-paper-one', mode: 'standing-mandate' })
    expect(await store.revoke('connection-paper-one')).toBe(true)
    expect(await store.getActive('connection-paper-one')).toBeNull()
  })

  test('returns no active authority before session or after expiry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-mandate-'))
    roots.push(root)
    await new FileStandingAuthorizationStore(root, () => NOW).save(authorization())

    expect(await new FileStandingAuthorizationStore(
      root,
      () => '2026-08-10T13:59:59.000Z',
    ).getActive('connection-paper-one')).toBeNull()
    expect(await new FileStandingAuthorizationStore(
      root,
      () => '2026-08-10T17:00:00.000Z',
    ).getActive('connection-paper-one')).toBeNull()
  })

  test('refuses per-order authority and non-positive risk limits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-mandate-'))
    roots.push(root)
    const store = new FileStandingAuthorizationStore(root, () => NOW)

    await expect(store.save(authorization({
      mode: 'per-order',
      intent_id: 'intent-one',
      action_digest: 'a'.repeat(64),
    }))).rejects.toThrow('Only standing mandates')
    await expect(store.save(authorization({
      scope: { ...authorization().scope, max_open_risk: '0' },
    }))).rejects.toThrow('monetary limits must be positive')
  })

  test('refuses broad, stale, oversized, and non-contract mandates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-mandate-'))
    roots.push(root)
    const store = new FileStandingAuthorizationStore(root, () => NOW)

    await expect(store.save(authorization({
      scope: { ...authorization().scope, symbols: ['ES'] },
    }))).rejects.toThrow('exact active supported futures contract')
    await expect(store.save(authorization({
      scope: { ...authorization().scope, symbols: ['ESH6'] },
    }))).rejects.toThrow('exact active supported futures contract')
    await expect(store.save(authorization({
      scope: { ...authorization().scope, max_contracts: 11 },
    }))).rejects.toThrow('more than 10 contracts')
    await expect(store.save(authorization({
      scope: {
        ...authorization().scope,
        session_end: '2026-08-10T20:00:00.000Z',
      },
      expires_at: '2026-08-10T20:00:00.000Z',
    }))).rejects.toThrow('no more than four hours')
  })
})
