import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  TRADING_CONNECTION_SCHEMA_VERSION,
  type TradingConnection,
} from '@trade-god/contracts'

import { ExecutionGatewayError, FileTradingConnectionStore } from '../src/index.ts'

const roots: string[] = []
const NOW = '2026-07-30T15:05:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const connection = (): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: 'connection-apex-paper',
  display_name: 'Apex Paper',
  firm: { slug: 'apex', name: 'Apex Trader Funding' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'api',
  account_ref: 'account-apex-paper',
  account_display: { label: 'APEX-1234', last4: '1234' },
  credential_ref: 'credential-ref-apex-paper',
  risk_policy_ref: 'risk-policy-paper',
  authorization_basis_ref: 'authorization-basis-apex',
  approval_policy_ref: 'approval-policy-paper',
  state: 'auth-required',
  capabilities: {
    read_accounts: false,
    read_orders: false,
    read_positions: false,
    read_executions: false,
    submit_market: false,
    submit_limit: false,
    submit_stop: false,
    submit_stop_limit: false,
    native_bracket: false,
    native_oco: false,
    modify_order: false,
    cancel_order: false,
    partial_close: false,
    flatten: false,
    streaming_events: false,
  },
  certifications: [],
  enabled: false,
  created_at: NOW,
  updated_at: NOW,
})

describe('trading connection store', () => {
  test('persists only validated connection metadata across restarts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-connections-'))
    roots.push(root)
    const first = new FileTradingConnectionStore(root, () => NOW)
    await first.save(connection())

    const second = new FileTradingConnectionStore(root, () => NOW)
    expect(await second.list()).toEqual([connection()])
    expect(JSON.stringify(await second.get(connection().connection_id))).not.toContain('secret')
  })

  test('does not permit an existing connection ID to change account identity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-connections-'))
    roots.push(root)
    const store = new FileTradingConnectionStore(root, () => NOW)
    await store.save(connection())

    await expect(store.save({
      ...connection(),
      account_ref: 'different-account',
      account_display: { label: 'APEX-9999', last4: '9999' },
    })).rejects.toBeInstanceOf(ExecutionGatewayError)

    await expect(store.save({
      ...connection(),
      transport_preference: 'browser',
      credential_ref: undefined,
      browser_session_ref: 'session-apex-paper',
    })).rejects.toBeInstanceOf(ExecutionGatewayError)
  })

  test('removes metadata without affecting unrelated connections', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-connections-'))
    roots.push(root)
    const store = new FileTradingConnectionStore(root, () => NOW)
    await store.save(connection())
    await store.save({
      ...connection(),
      connection_id: 'connection-apex-browser',
      display_name: 'Apex Browser',
      platform: { slug: 'wealthcharts', name: 'WealthCharts' },
      transport_preference: 'browser',
      credential_ref: undefined,
      browser_session_ref: 'session-apex-browser',
      account_ref: 'account-apex-browser',
    })

    expect(await store.remove('connection-apex-paper')).toBe(true)
    expect(await store.list()).toMatchObject([{ connection_id: 'connection-apex-browser' }])
  })
})
