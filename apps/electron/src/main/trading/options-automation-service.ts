import { randomUUID } from 'node:crypto'

import {
  OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  optionsAutomationRouteSchema,
  optionsEntryPolicySchema,
  type OptionsAutomationReceipt,
  type OptionsAutomationRoute,
  type OptionsConnection,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'
import {
  FileOptionsAutomationReceiptStore,
  FileOptionsAutomationStore,
  sha256,
} from '@trade-god/execution'

export type SaveOptionsAutomationSourceInput = {
  route_id?: string
  display_name: string
  channel_url: string
  author_id: string
  thread_id?: string | null
  connection_id: string
  max_spread_abs: string
  max_spread_pct: string
  max_chase_abs: string
  max_chase_pct: string
  max_contracts_per_order: number
  max_debit_per_trade: string
}

export type OptionsAutomationSourceStatus = {
  route: OptionsAutomationRoute
  policy: OptionsEntryPolicy
  recent_receipts: OptionsAutomationReceipt[]
  automatic_authority_active: boolean
}

export class OptionsAutomationService {
  constructor(
    private readonly store: FileOptionsAutomationStore,
    private readonly receipts: FileOptionsAutomationReceiptStore,
    private readonly resolveConnection: (connectionId: string) => Promise<OptionsConnection>,
    private readonly authorityActive: (route: OptionsAutomationRoute, policy: OptionsEntryPolicy, connection: OptionsConnection) => Promise<boolean>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async list(): Promise<OptionsAutomationSourceStatus[]> {
    const receipts = await this.receipts.list()
    return Promise.all((await this.store.listRoutes()).map(async (route) => {
      const policy = await this.store.getPolicy(route.policy_id, route.policy_revision)
      const connection = await this.resolveConnection(route.connection_id)
      return {
        route,
        policy,
        recent_receipts: receipts.filter((receipt) => receipt.route_id === route.route_id).slice(-20).reverse(),
        automatic_authority_active: await this.authorityActive(route, policy, connection),
      }
    }))
  }

  async save(input: SaveOptionsAutomationSourceInput): Promise<OptionsAutomationSourceStatus> {
    const source = parseDiscordChannelUrl(input.channel_url)
    const connection = await this.resolveConnection(input.connection_id)
    if (connection.environment !== 'paper' && connection.environment !== 'sandbox') throw new Error('Options automation is paper or sandbox only.')
    const prior = input.route_id ? await this.store.getRoute(input.route_id) : undefined
    if (prior?.state === 'archived') throw new Error('Archived Discord sources cannot be changed; add it again as a new source.')
    if (prior && (prior.guild_id !== source.guild_id || prior.channel_id !== source.channel_id
      || prior.thread_id !== (input.thread_id?.trim() || null) || prior.author_id !== input.author_id.trim())) {
      throw new Error('Discord identity cannot be edited. Archive this source and add the new one.')
    }
    const timestamp = this.now()
    const routeId = prior?.route_id ?? `options-route-${randomUUID()}`
    const revision = (prior?.revision ?? 0) + 1
    const policyId = prior?.policy_id ?? `options-policy-${randomUUID()}`
    const policyBody = {
      policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
      policy_id: policyId, revision, max_signal_age_ms: 30_000, max_ingest_delay_ms: 5_000,
      regular_session_only: true as const,
      entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' as const },
      allowed_weekdays: [1, 2, 3, 4, 5], min_days_to_expiration: 1, max_days_to_expiration: 60,
      max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1,
      max_spread_abs: input.max_spread_abs, max_spread_pct: input.max_spread_pct,
      spread_gate_mode: 'both' as const, max_chase_abs: input.max_chase_abs, max_chase_pct: input.max_chase_pct,
      max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const,
      wide_spread_action: 'skip' as const, passive_limit_offset_abs: '0.01', working_order_ttl_ms: 15_000,
      max_reprice_attempts: 0, reprice_interval_ms: 1_000, cancel_at_signal_expiry: true,
      sizing: { mode: 'fixed_contracts' as const, fixed_contracts: input.max_contracts_per_order },
      max_contracts_per_order: input.max_contracts_per_order, max_debit_per_trade: input.max_debit_per_trade,
      max_aggregate_open_debit: input.max_debit_per_trade, max_daily_debit_initiated: input.max_debit_per_trade,
      max_open_positions: 1 as const, max_active_positions_per_source: 1 as const,
      source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
      expiration_custody: {
        provider_calendar_checksum: '0'.repeat(64), account_exercise_setting_checksum: '0'.repeat(64),
        no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45,
        operator_escalation_minutes_before_close: 30, do_not_exercise_mode: 'manual-required' as const,
        custody_certification_checksum: '0'.repeat(64),
      },
      environment: connection.environment, provider_slug: connection.provider, adapter_id: connection.adapter_id,
      required_certification: 'options-paper-autopilot-certified' as const, certification_checksum: '0'.repeat(64),
      connection_id: connection.connection_id, account_id: connection.account_ref, source_route_id: routeId,
      global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
      mandate_expires_at: new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1_000).toISOString(), created_at: timestamp,
    }
    const policy = optionsEntryPolicySchema.parse({ ...policyBody, content_checksum: sha256(policyBody) })
    await this.store.savePolicy(policy)
    const routeBody = {
      route_schema_version: OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION, route_id: routeId, revision,
      display_name: requiredText(input.display_name, 'Source nickname'), guild_id: source.guild_id,
      channel_id: source.channel_id, thread_id: input.thread_id?.trim() || null,
      author_id: requiredText(input.author_id, 'Trader ID'), connection_id: connection.connection_id,
      connection_checksum: connection.content_checksum, account_id: connection.account_ref,
      provider: connection.provider, environment: connection.environment, policy_id: policy.policy_id,
      policy_revision: policy.revision, policy_checksum: policy.content_checksum,
      required_certification: 'options-paper-autopilot-certified' as const,
      state: 'draft' as const, created_at: prior?.created_at ?? timestamp, updated_at: timestamp,
    }
    const route = optionsAutomationRouteSchema.parse({ ...routeBody, content_checksum: sha256(routeBody) })
    await this.store.saveRoute(route)
    return { route, policy, recent_receipts: [], automatic_authority_active: false }
  }

  async archive(routeId: string): Promise<OptionsAutomationRoute> {
    const current = await this.store.getRoute(routeId)
    if (current.state === 'archived') return current
    const timestamp = this.now()
    const body = { ...current, revision: current.revision + 1, state: 'archived' as const, updated_at: timestamp, content_checksum: undefined }
    delete (body as { content_checksum?: string }).content_checksum
    return this.store.saveRoute(optionsAutomationRouteSchema.parse({ ...body, content_checksum: sha256(body) }))
  }
}

function parseDiscordChannelUrl(value: string): { guild_id: string; channel_id: string } {
  let parsed: URL
  try { parsed = new URL(value.trim()) } catch { throw new Error('Paste a Discord channel link, such as discord.com/channels/server/channel.') }
  if (!['discord.com', 'www.discord.com'].includes(parsed.hostname.toLowerCase())) throw new Error('Only a Discord channel link is accepted.')
  const match = /^\/channels\/([^/]+)\/([^/]+)(?:\/[^/]+)?\/?$/.exec(parsed.pathname)
  if (!match) throw new Error('This Discord link does not identify one server and channel.')
  return { guild_id: match[1]!, channel_id: match[2]! }
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}
