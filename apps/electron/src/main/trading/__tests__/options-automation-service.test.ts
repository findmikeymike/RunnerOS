import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { OPTIONS_CONNECTION_SCHEMA_VERSION, type OptionsConnection } from '@trade-god/contracts'
import { FileOptionsAutomationReceiptStore, FileOptionsAutomationStore, sha256 } from '@trade-god/execution'
import { OptionsAutomationService } from '../options-automation-service.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const now = '2026-08-26T15:00:00.000Z'

const connection = (): OptionsConnection => {
  const body = {
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION, connection_id: 'options-one', provider: 'ibkr' as const,
    environment: 'paper' as const, auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options',
    adapter_version: '1.0.0', provider_contract_version: 'ibkr-options-web-api@1', account_ref: 'DU1234567',
    account_label: 'IBKR Paper', endpoint: 'https://api.ibkr.com/v1/api', credential_ref: 'options-secret-one',
    credential_generation: 'a'.repeat(64), state: 'read-only-verified' as const, read_only: true as const,
    execution_enabled: false as const, created_at: now, updated_at: now,
  }
  return { ...body, content_checksum: sha256(body) }
}

describe('options automation service', () => {
  test('turns one plain Discord source setup into a locked exact route and policy', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automation-service-')); roots.push(root)
    const account = connection()
    const service = new OptionsAutomationService(new FileOptionsAutomationStore(root), new FileOptionsAutomationReceiptStore(root),
      async () => account, async () => false, () => now)
    const saved = await service.save({
      display_name: 'SPY calls', channel_url: 'https://discord.com/channels/guild-one/channel-one/message-one',
      author_id: 'trader-one', connection_id: account.connection_id, max_spread_abs: '0.10', max_spread_pct: '10',
      max_chase_abs: '0.10', max_chase_pct: '8', min_debit_per_trade: '100', max_contracts_per_order: 10, max_debit_per_trade: '150',
    })
    expect(saved.route).toMatchObject({ state: 'draft', guild_id: 'guild-one', channel_id: 'channel-one', author_id: 'trader-one' })
    expect(saved.policy).toMatchObject({
      sizing: { mode: 'debit_range', min_debit_budget: '100', max_debit_budget: '150' },
      max_contracts_per_order: 10, max_debit_per_trade: '150', wide_spread_action: 'skip',
    })
    expect((await service.list())[0]).toMatchObject({ automatic_authority_active: false })
  })

  test('refuses source identity edits and archives append-only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automation-service-')); roots.push(root)
    const account = connection()
    const service = new OptionsAutomationService(new FileOptionsAutomationStore(root), new FileOptionsAutomationReceiptStore(root),
      async () => account, async () => false, () => now)
    const input = { display_name: 'SPY calls', channel_url: 'https://discord.com/channels/guild-one/channel-one',
      author_id: 'trader-one', connection_id: account.connection_id, max_spread_abs: '0.10', max_spread_pct: '10',
      max_chase_abs: '0.10', max_chase_pct: '8', min_debit_per_trade: '100', max_contracts_per_order: 10, max_debit_per_trade: '150' }
    const saved = await service.save(input)
    await expect(service.save({ ...input, route_id: saved.route.route_id, author_id: 'other-trader' })).rejects.toThrow('cannot be edited')
    expect(await service.archive(saved.route.route_id)).toMatchObject({ state: 'archived', revision: 2 })
  })
})
