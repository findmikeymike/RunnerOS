import * as React from 'react'
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  RadioTower,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  isSelectableSignalSource,
  type DiscoTraderSignalSourceCatalog,
} from '@/features/trading/discotrader-signal-sources'
import {
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type ExecutionAuthorization,
  type ExecutionEnvironment,
  type ExecutionTransportPreference,
  type MirrorGroup,
  type TradingConnection,
} from '@trade-god/contracts'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'trading-connections',
}

const EMPTY_CAPABILITIES = {
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
}

type Draft = {
  displayName: string
  firmName: string
  platform: 'tradovate' | 'wealthcharts'
  environment: ExecutionEnvironment
  accountRef: string
  accountLabel: string
  apiSecret: string
  tokenExpiresAt: string
}

type SignalDraft = {
  displayName: string
  serverId: string
  channelId: string
  traderAuthorId: string
  connectionId: string
}

type SignalRoute = Awaited<ReturnType<typeof window.electronAPI.listTradingSignalRoutes>>[number]

type MandateDraft = {
  symbols: string
  maxContracts: string
  maxOpenRisk: string
  maxDailyLoss: string
  durationMinutes: string
}

type MirrorGroupDraftMember = {
  connectionId: string
  selected: boolean
  mode: 'source-quantity' | 'fixed-contracts'
  contracts: string
  maxContracts: string
}

type MirrorGroupDraft = {
  displayName: string
  maxAggregateRisk: string
  members: MirrorGroupDraftMember[]
}

interface TradingConnectionsSettingsPageProps {
  embedded?: boolean
  onConnectionsChanged?: () => void
  signalSourceCatalog?: DiscoTraderSignalSourceCatalog | null
  signalSourceCatalogError?: string | null
  onRefreshSignalSources?: () => void
}

const EMPTY_SIGNAL_DRAFT: SignalDraft = {
  displayName: '', serverId: '', channelId: '', traderAuthorId: '', connectionId: '',
}

const EMPTY_DRAFT: Draft = {
  displayName: '',
  firmName: 'Apex Trader Funding',
  platform: 'tradovate',
  environment: 'paper',
  accountRef: '',
  accountLabel: '',
  apiSecret: '',
  tokenExpiresAt: '',
}

const EMPTY_MANDATE_DRAFT: MandateDraft = {
  symbols: '',
  maxContracts: '',
  maxOpenRisk: '',
  maxDailyLoss: '',
  durationMinutes: '60',
}

const EMPTY_MIRROR_GROUP_DRAFT: MirrorGroupDraft = {
  displayName: '', maxAggregateRisk: '', members: [],
}

export default function TradingConnectionsSettingsPage({
  embedded = false,
  onConnectionsChanged,
  signalSourceCatalog = null,
  signalSourceCatalogError = null,
  onRefreshSignalSources,
}: TradingConnectionsSettingsPageProps = {}) {
  const [connections, setConnections] = React.useState<
    Awaited<ReturnType<typeof window.electronAPI.listTradingConnections>>
  >([])
  const [standingAuthorizations, setStandingAuthorizations] = React.useState<ExecutionAuthorization[]>([])
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [editing, setEditing] = React.useState(false)
  const [routes, setRoutes] = React.useState<SignalRoute[]>([])
  const [mirrorGroups, setMirrorGroups] = React.useState<MirrorGroup[]>([])
  const [mirrorGroupDraft, setMirrorGroupDraft] = React.useState<MirrorGroupDraft>(EMPTY_MIRROR_GROUP_DRAFT)
  const [editingMirrorGroup, setEditingMirrorGroup] = React.useState(false)
  const [signalDraft, setSignalDraft] = React.useState<SignalDraft>(EMPTY_SIGNAL_DRAFT)
  const [editingSignal, setEditingSignal] = React.useState(false)
  const [pendingReassignment, setPendingReassignment] = React.useState<SignalRoute | null>(null)
  const [busy, setBusy] = React.useState<string | null>('load')

  const load = React.useCallback(async () => {
    setBusy('load')
    try {
      const [nextConnections, nextRoutes, nextAuthorizations, nextMirrorGroups] = await Promise.all([
        window.electronAPI.listTradingConnections(),
        window.electronAPI.listTradingSignalRoutes(),
        window.electronAPI.listTradeGodStandingAuthorizations(),
        window.electronAPI.listMirrorGroups(),
      ])
      setConnections(nextConnections)
      setRoutes(nextRoutes)
      setStandingAuthorizations(nextAuthorizations)
      setMirrorGroups(nextMirrorGroups)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load trading connections')
    } finally {
      setBusy(null)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const accountRef = draft.accountRef.trim()
    const displayName = draft.displayName.trim()
    const accountLabel = draft.accountLabel.trim()
    const firmName = draft.firmName.trim()
    if (!displayName || !firmName || !accountRef || !accountLabel) {
      toast.error('Connection name, prop firm, account reference, and account label are required')
      return
    }
    if (draft.platform === 'tradovate' && !draft.apiSecret.trim()) {
      toast.error('Tradovate access token is required')
      return
    }
    if (draft.platform === 'tradovate' && draft.environment !== 'paper') {
      toast.error('Tradovate API execution is paper-only in this build')
      return
    }
    if (
      draft.platform === 'tradovate'
      && (!/^\d+$/.test(accountRef) || Number(accountRef) <= 0)
    ) {
      toast.error('Tradovate account reference must be the numeric account ID')
      return
    }
    if (
      draft.platform === 'tradovate'
      && (!draft.tokenExpiresAt || !Number.isFinite(Date.parse(draft.tokenExpiresAt)))
    ) {
      toast.error('Tradovate token expiration is required')
      return
    }
    setBusy('save')
    try {
      const now = new Date().toISOString()
      const transport: ExecutionTransportPreference = draft.platform === 'tradovate'
        ? 'api'
        : 'browser'
      const firmSlug = slugify(firmName)
      const connectionId = [
        'connection',
        firmSlug,
        draft.platform,
        draft.environment,
        accountRef,
      ].join('-').replace(/[^A-Za-z0-9._:@-]/g, '-').slice(0, 150)
      const connection: TradingConnection = {
        connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
        connection_id: connectionId,
        display_name: displayName,
        firm: { slug: firmSlug, name: firmName },
        platform: draft.platform === 'tradovate'
          ? { slug: 'tradovate', name: 'Tradovate' }
          : { slug: 'wealthcharts', name: 'WealthCharts' },
        environment: draft.environment,
        environment_class: draft.environment === 'paper' ? 'rehearsal' : 'consequential',
        transport_preference: transport,
        account_ref: accountRef,
        account_display: { label: accountLabel },
        ...(transport === 'api' ? { credential_ref: 'assigned-by-trusted-runtime' } : {}),
        ...(transport === 'browser' ? { browser_session_ref: 'assigned-by-trusted-runtime' } : {}),
        risk_policy_ref: `risk-policy-${draft.environment}`,
        authorization_basis_ref: `operator-authorized-${firmSlug}`,
        approval_policy_ref: 'approval-policy-per-order',
        state: 'auth-required',
        capabilities: EMPTY_CAPABILITIES,
        certifications: [],
        enabled: false,
        created_at: now,
        updated_at: now,
      }
      const saved = await window.electronAPI.saveTradingConnection({
        connection,
        ...(transport === 'api' ? {
          api_secret: JSON.stringify({
            access_token: draft.apiSecret.trim(),
            account_id: Number(accountRef),
            account_spec: accountLabel,
            expires_at: new Date(draft.tokenExpiresAt).toISOString(),
          }),
        } : {}),
      })
      setDraft(EMPTY_DRAFT)
      setEditing(false)
      await load()
      onConnectionsChanged?.()
      if (transport === 'browser') {
        await window.electronAPI.openTradingConnectionLogin(saved.connection.connection_id)
        toast.success('Account saved. Sign in, then return here and confirm the session.')
      } else {
        toast.success('API account saved. Execution remains locked pending certification.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save trading connection')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (connectionId: string) => {
    setBusy(`remove:${connectionId}`)
    try {
      await window.electronAPI.removeTradingConnection(connectionId)
      await load()
      onConnectionsChanged?.()
      toast.success('Trading connection removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove trading connection')
    } finally {
      setBusy(null)
    }
  }

  const openLogin = async (connectionId: string) => {
    setBusy(`login:${connectionId}`)
    try {
      await window.electronAPI.openTradingConnectionLogin(connectionId)
      toast.success('Isolated trading login opened')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open trading login')
    } finally {
      setBusy(null)
    }
  }

  const confirmLogin = async (connectionId: string) => {
    setBusy(`confirm:${connectionId}`)
    try {
      await window.electronAPI.confirmTradingConnectionLogin(connectionId)
      await load()
      onConnectionsChanged?.()
      toast.success('Provider page session saved', {
        description: 'This confirms the isolated browser origin only. Execution remains locked pending account identity and paper certification.',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not confirm trading login')
    } finally {
      setBusy(null)
    }
  }

  const verifyProvider = async (connectionId: string) => {
    setBusy(`verify:${connectionId}`)
    try {
      await window.electronAPI.verifyTradingConnection(connectionId)
      await load()
      onConnectionsChanged?.()
      toast.success('Tradovate paper account verified', {
        description: 'This was read-only. Order entry remains locked pending lifecycle certification and explicit activation.',
      })
    } catch (error) {
      await load()
      toast.error(error instanceof Error ? error.message : 'Could not verify provider account')
    } finally {
      setBusy(null)
    }
  }

  const saveSignalRoute = async (expectedPreviousTargetKey?: string) => {
    if (!signalDraft.displayName.trim() || !signalDraft.connectionId
      || !/^\d{1,25}$/.test(signalDraft.serverId)
      || !/^\d{1,25}$/.test(signalDraft.channelId)
      || !/^\d{1,25}$/.test(signalDraft.traderAuthorId)) {
      toast.error('Name, target account, and immutable Discord server, channel, and trader IDs are required')
      return
    }
    const existing = findSignalRouteByIdentity(routes, signalDraft)
    if (existing && signalRouteTargetKey(existing) !== signalDraftTargetKey(signalDraft.connectionId)
      && expectedPreviousTargetKey !== signalRouteTargetKey(existing)) {
      setPendingReassignment(existing)
      return
    }
    setBusy('save-signal')
    try {
      const now = new Date().toISOString()
      await window.electronAPI.saveTradingSignalRoute({
        route_schema_version: 'trading-signal-route@2',
        route_id: existing?.route_id
          ?? `discord-${signalDraft.serverId}-${signalDraft.channelId}-${signalDraft.traderAuthorId}`,
        display_name: signalDraft.displayName.trim(),
        source_type: 'discord',
        server_id: signalDraft.serverId,
        channel_id: signalDraft.channelId,
        trader_author_id: signalDraft.traderAuthorId,
        target: signalDraftTarget(signalDraft.connectionId),
        enabled: true,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      }, expectedPreviousTargetKey)
      setSignalDraft(EMPTY_SIGNAL_DRAFT)
      setEditingSignal(false)
      setPendingReassignment(null)
      await load()
      toast.success(expectedPreviousTargetKey
        ? 'Discord source reassigned to the selected account'
        : 'Discord trader routed to one exact account')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Discord route')
    } finally { setBusy(null) }
  }

  const beginMirrorGroup = () => {
    setMirrorGroupDraft({
      ...EMPTY_MIRROR_GROUP_DRAFT,
      members: connections.map(({ connection }) => ({
        connectionId: connection.connection_id,
        selected: false,
        mode: 'source-quantity',
        contracts: '1',
        maxContracts: '1',
      })),
    })
    setEditingMirrorGroup(true)
  }

  const saveMirrorGroup = async () => {
    const selected = mirrorGroupDraft.members.filter((member) => member.selected)
    const maxRisk = Number(mirrorGroupDraft.maxAggregateRisk)
    if (!mirrorGroupDraft.displayName.trim() || selected.length < 2 || !Number.isFinite(maxRisk) || maxRisk <= 0) {
      toast.error('Mirror Group name, at least two accounts, and a positive price-distance exposure limit are required')
      return
    }
    const parsedMembers = selected.map((member) => ({
      ...member,
      contractsNumber: Number(member.contracts),
      maxContractsNumber: Number(member.maxContracts),
    }))
    if (parsedMembers.some((member) => (
      !Number.isSafeInteger(member.maxContractsNumber) || member.maxContractsNumber <= 0
      || (member.mode === 'fixed-contracts' && (
        !Number.isSafeInteger(member.contractsNumber)
        || member.contractsNumber <= 0
        || member.contractsNumber > member.maxContractsNumber
      ))
    ))) {
      toast.error('Every selected account needs a valid whole-contract rule and maximum')
      return
    }
    setBusy('save-mirror-group')
    try {
      const mirrorGroupId = `mirror-group-${slugify(mirrorGroupDraft.displayName)}`
      const allMembersReady = parsedMembers.every((member) => {
        const status = connections.find(({ connection }) => connection.connection_id === member.connectionId)
        return status ? isPaperMandateEligible(status) : false
      })
      await window.electronAPI.saveMirrorGroup({
        mirror_group_id: mirrorGroupId,
        display_name: mirrorGroupDraft.displayName.trim(),
        environment: 'paper',
        state: allMembersReady ? 'active' : 'draft',
        dispatch_max_concurrency: Math.min(4, selected.length),
        max_aggregate_initial_risk: String(maxRisk),
        max_active_parent_trades: 1,
        members: parsedMembers.map((member) => ({
          connection_id: member.connectionId,
          enabled: true,
          quantity_rule: member.mode === 'source-quantity'
            ? { mode: 'source-quantity', max_contracts: member.maxContractsNumber }
            : {
                mode: 'fixed-contracts',
                contracts: member.contractsNumber,
                max_contracts: member.maxContractsNumber,
              },
        })),
      })
      setEditingMirrorGroup(false)
      setMirrorGroupDraft(EMPTY_MIRROR_GROUP_DRAFT)
      await load()
      toast.success(allMembersReady
        ? 'Paper Mirror Group created for previews. It has zero order authority.'
        : 'Draft Mirror Group saved. Certify every account before activating previews.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Mirror Group')
    } finally { setBusy(null) }
  }

  const setMirrorGroupState = async (group: MirrorGroup, state: MirrorGroup['state']) => {
    setBusy(`mirror-state:${group.mirror_group_id}`)
    try {
      await window.electronAPI.saveMirrorGroup({
        mirror_group_id: group.mirror_group_id,
        display_name: group.display_name,
        environment: group.environment,
        state,
        dispatch_max_concurrency: group.dispatch_policy.max_concurrency,
        max_aggregate_initial_risk: group.portfolio_limits.max_aggregate_initial_risk,
        max_active_parent_trades: group.portfolio_limits.max_active_parent_trades,
        members: group.members.map(({ connection_id, enabled, quantity_rule }) => ({
          connection_id, enabled, quantity_rule,
        })),
        expected_revision: group.revision,
      })
      await load()
      toast.success(state === 'active' ? 'Mirror Group resumed for previews' : 'Mirror Group paused')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change Mirror Group state')
    } finally { setBusy(null) }
  }

  const removeSignalRoute = async (routeId: string) => {
    setBusy(`remove-route:${routeId}`)
    try {
      await window.electronAPI.removeTradingSignalRoute(routeId)
      await load()
      toast.success('Discord route removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove Discord route')
    } finally { setBusy(null) }
  }

  const originConfirmed = connections.filter((status) => status.browser_login_confirmed).length
  const ready = connections.filter(isExecutionReady).length
  const connectionIds = new Set(connections.map(({ connection }) => connection.connection_id))
  const mirrorGroupIds = new Set(mirrorGroups.map((group) => group.mirror_group_id))
  const groupedConnectionIds = new Set(mirrorGroups
    .filter((group) => group.state !== 'archived')
    .flatMap((group) => group.members.map((member) => member.connection_id)))
  const orphanedRoutes = routes.filter((route) => (
    (route.target.type === 'connection' && !connectionIds.has(route.target.connection_id))
    || (route.target.type === 'mirror-group' && !mirrorGroupIds.has(route.target.mirror_group_id))
  ))

  const body = (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      {embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Accounts & Discord routing</h2>
            <p className="mt-1 text-xs text-muted-foreground">Connect each prop account, then choose exactly which Discord traders feed it.</p>
          </div>
          <Button size="sm" onClick={() => setEditing(true)}>
            <Plus className="mr-1.5 size-4" />
            Add account
          </Button>
        </div>
      )}
          <SettingsSection
            title="Execution custody"
            description="Secrets stay in the encrypted desktop vault. Browser sessions use a trading-only partition."
          >
            <div className="grid gap-3 md:grid-cols-4">
              <Guardrail label="Accounts" value={String(connections.length)} />
              <Guardrail label="Browser sessions" value={`${originConfirmed} provider pages saved`} />
              <Guardrail label="Execution ready" value={String(ready)} />
              <Guardrail label="Default safety" value="Locked" />
            </div>
          </SettingsSection>

          {editing && (
            <SettingsSection
              title="Add connection"
              description="Adding credentials never enables order entry. Certification is a separate gate."
            >
              <SettingsCard>
                <SettingsCardContent className="grid gap-4 p-5 md:grid-cols-2">
                  <Field label="Display name">
                    <input
                      className={inputClass}
                      value={draft.displayName}
                      onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                      placeholder="Apex Tradovate Paper"
                    />
                  </Field>
                  <Field label="Prop firm">
                    <input
                      className={inputClass}
                      value={draft.firmName}
                      onChange={(event) => setDraft({ ...draft, firmName: event.target.value })}
                      placeholder="Apex, Topstep, MyFundedFutures…"
                    />
                  </Field>
                  <Field label="Platform">
                    <select
                      className={inputClass}
                      value={draft.platform}
                      onChange={(event) => setDraft({
                        ...draft,
                        platform: event.target.value as Draft['platform'],
                        environment: event.target.value === 'tradovate' ? 'paper' : draft.environment,
                        apiSecret: '',
                        tokenExpiresAt: '',
                      })}
                    >
                      <option value="tradovate">Tradovate API</option>
                      <option value="wealthcharts">WealthCharts browser</option>
                    </select>
                  </Field>
                  <Field label="Environment">
                    <select
                      className={inputClass}
                      value={draft.environment}
                      disabled={draft.platform === 'tradovate'}
                      onChange={(event) => setDraft({
                        ...draft,
                        environment: event.target.value as ExecutionEnvironment,
                      })}
                    >
                      <option value="paper">Paper</option>
                      {draft.platform !== 'tradovate' && <option value="evaluation">Evaluation</option>}
                      {draft.platform !== 'tradovate' && <option value="performance">Performance</option>}
                      {draft.platform !== 'tradovate' && <option value="live">Live</option>}
                    </select>
                  </Field>
                  <Field label="Account reference">
                    <input
                      className={inputClass}
                      value={draft.accountRef}
                      onChange={(event) => setDraft({ ...draft, accountRef: event.target.value })}
                      placeholder="Stable internal account ID"
                    />
                  </Field>
                  <Field label="Account label">
                    <input
                      className={inputClass}
                      value={draft.accountLabel}
                      onChange={(event) => setDraft({ ...draft, accountLabel: event.target.value })}
                      placeholder="APEX-1234"
                    />
                  </Field>
                  {draft.platform === 'tradovate' && (
                    <Field label="Tradovate access token" className="md:col-span-2">
                      <input
                        className={inputClass}
                        type="password"
                        value={draft.apiSecret}
                        onChange={(event) => setDraft({ ...draft, apiSecret: event.target.value })}
                        placeholder="Stored encrypted; never returned to the renderer"
                      />
                    </Field>
                  )}
                  {draft.platform === 'tradovate' && (
                    <Field label="Token expires at" className="md:col-span-2">
                      <input
                        className={inputClass}
                        type="datetime-local"
                        value={draft.tokenExpiresAt}
                        onChange={(event) => setDraft({ ...draft, tokenExpiresAt: event.target.value })}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Tradovate tokens normally expire after 90 minutes; Trade God renews and re-encrypts them before expiry.
                      </p>
                    </Field>
                  )}
                  <div className="flex justify-end gap-2 md:col-span-2">
                    <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={busy === 'save'}>
                      {busy === 'save' && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                      Save disabled
                    </Button>
                  </div>
                </SettingsCardContent>
              </SettingsCard>
            </SettingsSection>
          )}

          <SettingsSection
            title="Mirror Groups"
            description="Route one Discord trader to several paper accounts. This rollout creates exact dry-run plans only—no orders."
          >
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={beginMirrorGroup} disabled={editingMirrorGroup}>
                  <Plus className="mr-1.5 size-3.5" /> New Mirror Group
                </Button>
              </div>
              {editingMirrorGroup && (
                <SettingsCard>
                  <SettingsCardContent className="space-y-4 p-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Group name">
                        <input className={inputClass} value={mirrorGroupDraft.displayName} onChange={(event) => (
                          setMirrorGroupDraft({ ...mirrorGroupDraft, displayName: event.target.value })
                        )} placeholder="Apex paper mirrors" />
                      </Field>
                      <Field label="Estimated price-distance exposure limit (USD)">
                        <input className={inputClass} inputMode="decimal" value={mirrorGroupDraft.maxAggregateRisk} onChange={(event) => (
                          setMirrorGroupDraft({ ...mirrorGroupDraft, maxAggregateRisk: event.target.value })
                        )} placeholder="500" />
                        </Field>
                        <p className="text-[11px] leading-4 text-muted-foreground">
                          Preview estimate only. Fees, slippage, live risk reservations, and active-parent admission are not yet enforced.
                        </p>
                    </div>
                    <div className="space-y-2">
                      {mirrorGroupDraft.members.map((member, index) => {
                        const status = connections.find(({ connection }) => connection.connection_id === member.connectionId)
                        if (!status) return null
                        return (
                          <div key={member.connectionId} className="grid gap-2 rounded-lg border border-white/10 bg-black/10 p-3 md:grid-cols-[1.5fr_1fr_0.7fr_0.7fr]">
                            <label className="flex items-center gap-2 text-xs">
                              <input type="checkbox" checked={member.selected} onChange={(event) => {
                                const members = [...mirrorGroupDraft.members]
                                members[index] = { ...member, selected: event.target.checked }
                                setMirrorGroupDraft({ ...mirrorGroupDraft, members })
                              }} />
                              <span>{status.connection.display_name}</span>
                              <StatusBadge positive={isPaperMandateEligible(status)}>
                                {isPaperMandateEligible(status) ? 'Ready' : 'Blocked'}
                              </StatusBadge>
                            </label>
                            <select className={inputClass} disabled={!member.selected} value={member.mode} onChange={(event) => {
                              const members = [...mirrorGroupDraft.members]
                              members[index] = { ...member, mode: event.target.value as MirrorGroupDraftMember['mode'] }
                              setMirrorGroupDraft({ ...mirrorGroupDraft, members })
                            }}>
                              <option value="source-quantity">Copy source quantity</option>
                              <option value="fixed-contracts">Fixed quantity</option>
                            </select>
                            <input className={inputClass} aria-label={`${status.connection.display_name} fixed contracts`} disabled={!member.selected || member.mode !== 'fixed-contracts'} value={member.contracts} onChange={(event) => {
                              const members = [...mirrorGroupDraft.members]
                              members[index] = { ...member, contracts: event.target.value }
                              setMirrorGroupDraft({ ...mirrorGroupDraft, members })
                            }} placeholder="Fixed" />
                            <input className={inputClass} aria-label={`${status.connection.display_name} maximum contracts`} disabled={!member.selected} value={member.maxContracts} onChange={(event) => {
                              const members = [...mirrorGroupDraft.members]
                              members[index] = { ...member, maxContracts: event.target.value }
                              setMirrorGroupDraft({ ...mirrorGroupDraft, members })
                            }} placeholder="Max" />
                          </div>
                        )
                      })}
                    </div>
                    <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3 text-[11px] text-amber-100/80">
                      Saving activates preview routing only. Every member must be enabled, ready, and paper-lifecycle-certified. Provider execution stays disabled.
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => { setEditingMirrorGroup(false); setMirrorGroupDraft(EMPTY_MIRROR_GROUP_DRAFT) }}>Cancel</Button>
                      <Button onClick={() => void saveMirrorGroup()} disabled={busy === 'save-mirror-group'}>Create preview group</Button>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              )}
              {mirrorGroups.map((group) => {
                const targetId = `mirror-group:${group.mirror_group_id}`
                const groupRoutes = routes.filter((route) => (
                  route.target.type === 'mirror-group' && route.target.mirror_group_id === group.mirror_group_id
                ))
                return (
                  <SettingsCard key={group.mirror_group_id}>
                    <SettingsCardContent className="space-y-4 p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{group.display_name}</p>
                            <Badge>revision {group.revision}</Badge>
                            <StatusBadge positive={group.state === 'active'}>{group.state}</StatusBadge>
                            <StatusBadge positive={false}>Preview only</StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {group.members.filter((member) => member.enabled).length} accounts · ${group.portfolio_limits.max_aggregate_initial_risk} estimated price-distance limit · {groupRoutes.length} Discord source{groupRoutes.length === 1 ? '' : 's'}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" disabled={busy === `mirror-state:${group.mirror_group_id}`} onClick={() => void setMirrorGroupState(group, group.state === 'active' ? 'paused' : 'active')}>
                          {group.state === 'active' ? 'Pause previews' : 'Resume previews'}
                        </Button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {group.members.map((member) => {
                          const status = connections.find(({ connection }) => connection.connection_id === member.connection_id)
                          return (
                            <div key={member.member_id} className="rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs">
                              <p className="font-medium">{status?.connection.display_name ?? member.connection_id}</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {member.quantity_rule.mode === 'source-quantity'
                                  ? `Copy source · max ${member.quantity_rule.max_contracts}`
                                  : `Fixed ${member.quantity_rule.contracts} · max ${member.quantity_rule.max_contracts}`}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                      <AccountDiscordRoutes
                        connectionId={targetId}
                        targetLabel="Mirror Group"
                        routes={routes}
                        draft={signalDraft}
                        editing={editingSignal && signalDraft.connectionId === targetId}
                        addDisabled={editingSignal || group.state !== 'active'}
                        pendingReassignment={pendingReassignment}
                        previousAccountName={pendingReassignment ? describeSignalRouteTarget(pendingReassignment) : null}
                        signalSourceCatalog={signalSourceCatalog}
                        signalSourceCatalogError={signalSourceCatalogError}
                        onRefreshSignalSources={onRefreshSignalSources}
                        busy={busy}
                        onAdd={() => { setSignalDraft({ ...EMPTY_SIGNAL_DRAFT, connectionId: targetId }); setPendingReassignment(null); setEditingSignal(true) }}
                        onDraftChange={(nextDraft) => { setSignalDraft(nextDraft); setPendingReassignment(null) }}
                        onCancel={() => { setSignalDraft(EMPTY_SIGNAL_DRAFT); setEditingSignal(false); setPendingReassignment(null) }}
                        onSave={() => void saveSignalRoute()}
                        onConfirmReassignment={() => { if (pendingReassignment) void saveSignalRoute(signalRouteTargetKey(pendingReassignment)) }}
                        onRemove={(routeId) => void removeSignalRoute(routeId)}
                      />
                    </SettingsCardContent>
                  </SettingsCard>
                )
              })}
              {!mirrorGroups.length && !editingMirrorGroup && (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">No Mirror Groups yet.</div>
              )}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Accounts"
            description="A connection cannot execute until account identity and paper lifecycle certification are proven."
          >
            <div className="space-y-3">
              {connections.map((status) => (
                <SettingsCard key={status.connection.connection_id}>
                  <SettingsCardContent className="space-y-4 p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                        {status.connection.transport_preference === 'browser'
                          ? <ExternalLink className="size-4 text-cyan-300" />
                          : <KeyRound className="size-4 text-amber-300" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{status.connection.display_name}</p>
                          <Badge>{status.connection.environment}</Badge>
                          <Badge>{status.connection.transport_preference === 'browser' ? 'Browser' : 'API'}</Badge>
                          <StatusBadge positive={status.browser_login_confirmed || status.credential_configured}>
                            {status.connection.transport_preference === 'browser'
                              ? status.browser_login_confirmed ? 'Provider page saved' : 'Sign-in needed'
                              : status.credential_configured ? 'Credential saved' : 'Credential needed'}
                          </StatusBadge>
                          {status.connection.transport_preference === 'api' && (
                            <StatusBadge positive={status.provider_read_fresh}>
                              {status.provider_read_fresh
                                ? 'Provider verified'
                                : status.provider_read_verified
                                  ? 'Verification stale'
                                  : 'Verify needed'}
                            </StatusBadge>
                          )}
                          <StatusBadge positive={isExecutionReady(status)}>
                            {isExecutionReady(status)
                              ? 'Paper certified'
                              : status.connection.state === 'ready'
                                ? 'Ready · disabled'
                                : 'Execution locked'}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {status.connection.firm.name} · {status.connection.platform.name} · {status.connection.account_display.label}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Dedicated identity: {status.connection.account_ref} · {status.connection.certifications.length} certifications
                        </p>
                        {status.provider_read_verification && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Last read-only proof {new Date(status.provider_read_verification.verified_at).toLocaleString()} · {status.provider_read_verification.position_count} positions · {status.provider_read_verification.working_order_count} working orders
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {status.connection.transport_preference === 'api' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!status.credential_configured || busy === `verify:${status.connection.connection_id}`}
                            onClick={() => void verifyProvider(status.connection.connection_id)}
                          >
                            {busy === `verify:${status.connection.connection_id}`
                              ? <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              : <ShieldCheck className="mr-1.5 size-3.5" />}
                            Verify account
                          </Button>
                        )}
                        {status.connection.transport_preference !== 'api' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `login:${status.connection.connection_id}`}
                              onClick={() => void openLogin(status.connection.connection_id)}
                            >
                              <ExternalLink className="mr-1.5 size-3.5" />
                              {status.browser_login_confirmed ? 'Open account' : 'Open sign-in'}
                            </Button>
                            {!status.browser_login_confirmed && (
                              <Button
                                size="sm"
                                disabled={busy === `confirm:${status.connection.connection_id}`}
                                onClick={() => void confirmLogin(status.connection.connection_id)}
                              >
                                <CheckCircle2 className="mr-1.5 size-3.5" />
                                Save provider page
                              </Button>
                            )}
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${status.connection.display_name}`}
                          title={routes.some((route) => routeTargetsConnection(route, status.connection.connection_id))
                            ? 'Remove Discord sources first'
                            : groupedConnectionIds.has(status.connection.connection_id)
                              ? 'Remove this account from its Mirror Group first'
                            : 'Remove account'}
                          disabled={busy === `remove:${status.connection.connection_id}`
                            || groupedConnectionIds.has(status.connection.connection_id)
                            || routes.some((route) => routeTargetsConnection(route, status.connection.connection_id))}
                          onClick={() => void remove(status.connection.connection_id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <CertificationMatrix evidence={status.certification_evidence[0]} />
                    <PaperMandateControl
                      status={status}
                      authorization={standingAuthorizations.find((authorization) => (
                        authorization.connection_id === status.connection.connection_id
                      ))}
                      busy={busy}
                      onBusyChange={setBusy}
                      onChanged={load}
                    />
                    <AccountDiscordRoutes
                      connectionId={status.connection.connection_id}
                      targetLabel="account"
                      routes={routes}
                      draft={signalDraft}
                      editing={editingSignal && signalDraft.connectionId === status.connection.connection_id}
                      addDisabled={editingSignal}
                      pendingReassignment={pendingReassignment}
                      previousAccountName={pendingReassignment
                        ? connections.find(({ connection }) => (
                            pendingReassignment.target.type === 'connection'
                            && connection.connection_id === pendingReassignment.target.connection_id
                          ))?.connection.display_name ?? describeSignalRouteTarget(pendingReassignment)
                        : null}
                      signalSourceCatalog={signalSourceCatalog}
                      signalSourceCatalogError={signalSourceCatalogError}
                      onRefreshSignalSources={onRefreshSignalSources}
                      busy={busy}
                      onAdd={() => {
                        setSignalDraft({ ...EMPTY_SIGNAL_DRAFT, connectionId: status.connection.connection_id })
                        setPendingReassignment(null)
                        setEditingSignal(true)
                      }}
                      onDraftChange={(nextDraft) => {
                        setSignalDraft(nextDraft)
                        setPendingReassignment(null)
                      }}
                      onCancel={() => {
                        setSignalDraft(EMPTY_SIGNAL_DRAFT)
                        setEditingSignal(false)
                        setPendingReassignment(null)
                      }}
                      onSave={() => void saveSignalRoute()}
                      onConfirmReassignment={() => {
                        if (pendingReassignment) void saveSignalRoute(signalRouteTargetKey(pendingReassignment))
                      }}
                      onRemove={(routeId) => void removeSignalRoute(routeId)}
                    />
                  </SettingsCardContent>
                </SettingsCard>
              ))}
              {!connections.length && busy !== 'load' && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">
                  No trading connections yet.
                </div>
              )}
            </div>
          </SettingsSection>

          {orphanedRoutes.length > 0 && (
            <SettingsSection
              title="Orphaned Discord routes"
              description="These legacy routes point to accounts that no longer exist. They cannot execute."
            >
              <div className="space-y-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
                {orphanedRoutes.map((route) => (
                  <div key={route.route_id} className="flex items-center gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2.5">
                    <RadioTower className="size-3.5 text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{route.display_name}</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        Missing {route.target.type === 'connection'
                          ? `account ${route.target.connection_id}`
                          : `Mirror Group ${route.target.mirror_group_id}`}
                      </p>
                    </div>
                    <StatusBadge positive={false}>Blocked</StatusBadge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove orphaned ${route.display_name}`}
                      disabled={busy === `remove-route:${route.route_id}`}
                      onClick={() => void removeSignalRoute(route.route_id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </SettingsSection>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 text-xs text-emerald-200/80">
            <ShieldCheck className="size-4 shrink-0" />
            Credentials alone cannot activate evaluation, performance, or live execution.
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] px-4 py-3 text-xs text-cyan-100/80">
            <RadioTower className="mt-0.5 size-4 shrink-0" />
            <span>Discord channels and traders are signal sources, not broker accounts. Assign each monitored source to one exact account here.</span>
          </div>
    </div>
  )

  if (embedded) return body

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PanelHeader
        title="Trading Connections"
        actions={(
          <Button size="sm" onClick={() => setEditing(true)}>
            <Plus className="mr-1.5 size-4" />
            Add account
          </Button>
        )}
      />
      <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
    </div>
  )
}

function PaperMandateControl({
  status,
  authorization,
  busy,
  onBusyChange,
  onChanged,
}: {
  status: Awaited<ReturnType<typeof window.electronAPI.listTradingConnections>>[number]
  authorization?: ExecutionAuthorization
  busy: string | null
  onBusyChange: (value: string | null) => void
  onChanged: () => Promise<void>
}) {
  const [draft, setDraft] = React.useState<MandateDraft>(EMPTY_MANDATE_DRAFT)
  const connection = status.connection
  const eligible = isPaperMandateEligible(status)
  const now = Date.now()
  const active = Boolean(
    authorization
    && authorization.mode === 'standing-mandate'
    && Date.parse(authorization.scope.session_start) <= now
    && Date.parse(authorization.scope.session_end) > now
    && Date.parse(authorization.expires_at) > now,
  )
  const busyKey = `mandate:${connection.connection_id}`

  const activate = async () => {
    const symbols = [...new Set(draft.symbols
      .split(/[\s,]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean))]
    const maxContracts = Number(draft.maxContracts)
    const maxOpenRisk = Number(draft.maxOpenRisk)
    const maxDailyLoss = Number(draft.maxDailyLoss)
    const durationMinutes = Number(draft.durationMinutes)
    if (!symbols.length) {
      toast.error('Enter at least one exact active contract, such as ESU6')
      return
    }
    if (
      !Number.isInteger(maxContracts)
      || maxContracts < 1
      || maxContracts > 10
      || !Number.isFinite(maxOpenRisk)
      || maxOpenRisk <= 0
      || !Number.isFinite(maxDailyLoss)
      || maxDailyLoss <= 0
      || !Number.isInteger(durationMinutes)
      || durationMinutes < 1
      || durationMinutes > 240
    ) {
      toast.error('Use 1–10 contracts, positive dollar limits, and a 1–240 minute session')
      return
    }
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + durationMinutes * 60_000)
    if (!window.confirm(formatPaperMandateConfirmation({
      accountName: connection.display_name,
      symbols,
      maxContracts,
      maxOpenRisk,
      maxDailyLoss,
      expiresAt,
    }))) return

    onBusyChange(busyKey)
    try {
      const expiresAtIso = expiresAt.toISOString()
      const mandate: ExecutionAuthorization = {
        authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
        authorization_id: `paper-mandate-${crypto.randomUUID()}`,
        connection_id: connection.connection_id,
        mode: 'standing-mandate',
        scope: {
          symbols,
          max_contracts: maxContracts,
          allowed_sides: ['buy', 'sell'],
          allowed_order_types: ['market', 'limit', 'stop', 'stop-limit'],
          session_start: issuedAt.toISOString(),
          session_end: expiresAtIso,
          max_daily_loss: String(maxDailyLoss),
          max_open_risk: String(maxOpenRisk),
        },
        issued_by: 'operator-local',
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAtIso,
      }
      await window.electronAPI.saveTradeGodStandingAuthorization(mandate)
      setDraft(EMPTY_MANDATE_DRAFT)
      await onChanged()
      toast.success('Paper mandate saved', {
        description: 'Provider execution is still unavailable until this exact adapter is attached.',
      })
    } catch (error) {
      toast.error('Could not activate paper mandate', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      onBusyChange(null)
    }
  }

  const revoke = async () => {
    if (!window.confirm(`Revoke new-entry authority for ${connection.display_name}?`)) return
    onBusyChange(busyKey)
    try {
      await window.electronAPI.revokeTradeGodStandingAuthorization(connection.connection_id)
      await onChanged()
      toast.success('Paper mandate revoked')
    } catch (error) {
      toast.error('Could not revoke paper mandate', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      onBusyChange(null)
    }
  }

  return (
    <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.025] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium">Automatic paper authority</p>
            <StatusBadge positive={active}>{active ? 'Mandate active' : 'Mandate inactive'}</StatusBadge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {active && authorization
              ? `New-entry authority expires ${new Date(authorization.expires_at).toLocaleString()}.`
              : eligible
                ? 'Set narrow limits for this account. Nothing starts until you confirm.'
                : 'Requires an enabled, ready, paper-lifecycle-certified paper account.'}
          </p>
        </div>
        {authorization && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === busyKey}
            onClick={() => void revoke()}
          >
            Revoke mandate
          </Button>
        )}
      </div>

      {!active && eligible && (
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <Field label="Exact contracts" className="md:col-span-2">
            <input
              className={inputClass}
              value={draft.symbols}
              onChange={(event) => setDraft({ ...draft, symbols: event.target.value })}
              placeholder="ESU6, NQU6"
            />
          </Field>
          <Field label="Max contracts/order">
            <input
              className={inputClass}
              inputMode="numeric"
              value={draft.maxContracts}
              onChange={(event) => setDraft({ ...draft, maxContracts: event.target.value })}
              placeholder="1"
            />
          </Field>
          <Field label="Max open risk ($)">
            <input
              className={inputClass}
              inputMode="decimal"
              value={draft.maxOpenRisk}
              onChange={(event) => setDraft({ ...draft, maxOpenRisk: event.target.value })}
              placeholder="100"
            />
          </Field>
          <Field label="Max daily loss ($)">
            <input
              className={inputClass}
              inputMode="decimal"
              value={draft.maxDailyLoss}
              onChange={(event) => setDraft({ ...draft, maxDailyLoss: event.target.value })}
              placeholder="500"
            />
          </Field>
          <Field label="Session minutes">
            <input
              className={inputClass}
              inputMode="numeric"
              value={draft.durationMinutes}
              onChange={(event) => setDraft({ ...draft, durationMinutes: event.target.value })}
            />
          </Field>
          <div className="flex items-end md:col-span-4">
            <Button disabled={busy === busyKey} onClick={() => void activate()}>
              {busy === busyKey && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Activate paper mandate
            </Button>
          </div>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-4 text-amber-100/60">
        A mandate is only one key. A matching signed route, certified attached adapter, gateway risk approval, and released global halt are all still required.
      </p>
    </div>
  )
}

function AccountDiscordRoutes({
  connectionId,
  targetLabel,
  routes,
  draft,
  editing,
  addDisabled,
  pendingReassignment,
  previousAccountName,
  signalSourceCatalog,
  signalSourceCatalogError,
  onRefreshSignalSources,
  busy,
  onAdd,
  onDraftChange,
  onCancel,
  onSave,
  onConfirmReassignment,
  onRemove,
}: {
  connectionId: string
  targetLabel: string
  routes: SignalRoute[]
  draft: SignalDraft
  editing: boolean
  addDisabled: boolean
  pendingReassignment: SignalRoute | null
  previousAccountName: string | null
  signalSourceCatalog: DiscoTraderSignalSourceCatalog | null
  signalSourceCatalogError: string | null
  onRefreshSignalSources?: () => void
  busy: string | null
  onAdd: () => void
  onDraftChange: (draft: SignalDraft) => void
  onCancel: () => void
  onSave: () => void
  onConfirmReassignment: () => void
  onRemove: (routeId: string) => void
}) {
  const accountRoutes = routes.filter((route) => signalRouteTargetKey(route) === signalDraftTargetKey(connectionId))
  const selectableSources = signalSourceCatalog?.observed.sources.filter(isSelectableSignalSource) ?? []
  return (
    <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/[0.025] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Discord sources</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Only these exact channel + trader matches can route into this {targetLabel}.</p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={addDisabled}>
          <Plus className="mr-1.5 size-3.5" /> Add source
        </Button>
      </div>

      {editing && (
        <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-black/10 p-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium text-muted-foreground">DiscoTrader source catalog</p>
              {onRefreshSignalSources && (
                <Button variant="ghost" size="sm" onClick={onRefreshSignalSources}>Refresh</Button>
              )}
            </div>
            <select
              className={inputClass}
              value=""
              disabled={!selectableSources.length}
              onChange={(event) => {
                const source = selectableSources.find((candidate) => candidate.sourceId === event.target.value)
                if (!source?.serverId || !source.trader.discordUserId) return
                onDraftChange({
                  ...draft,
                  displayName: draft.displayName || `${source.trader.displayName} · ${source.channelId}`,
                  serverId: source.serverId,
                  channelId: source.channelId,
                  traderAuthorId: source.trader.discordUserId,
                })
              }}
            >
              <option value="">{selectableSources.length ? 'Choose a configured observed trader…' : 'No selectable configured traders found'}</option>
              {selectableSources.map((source) => (
                <option key={source.sourceId} value={source.sourceId}>
                  {source.trader.displayName} · channel {source.channelId}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {signalSourceCatalogError
                ? `Catalog unavailable: ${signalSourceCatalogError}. You can still enter immutable IDs below.`
                : signalSourceCatalog
                  ? `${signalSourceCatalog.observed.sources.length} observed · ${selectableSources.length} configured for daemon routing. Observation does not prove a Discord tab is currently open.`
                  : 'Connect and start DiscoTrader to load its monitored channel catalog. Manual IDs remain available.'}
            </p>
          </div>
          <Field label="Route name"><input className={inputClass} value={draft.displayName} onChange={(event) => onDraftChange({ ...draft, displayName: event.target.value })} placeholder="NQ alerts — Uncle Mike" /></Field>
          <Field label="Discord server ID"><input className={inputClass} value={draft.serverId} onChange={(event) => onDraftChange({ ...draft, serverId: event.target.value.trim() })} placeholder="Immutable server ID" /></Field>
          <Field label="Discord channel ID"><input className={inputClass} value={draft.channelId} onChange={(event) => onDraftChange({ ...draft, channelId: event.target.value.trim() })} placeholder="Immutable channel ID" /></Field>
          <Field label="Trader user ID"><input className={inputClass} value={draft.traderAuthorId} onChange={(event) => onDraftChange({ ...draft, traderAuthorId: event.target.value.trim() })} placeholder="Immutable Discord user ID" /></Field>
          {pendingReassignment && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-xs text-amber-100 md:col-span-2">
              <p className="font-medium">Confirm account reassignment</p>
              <p className="mt-1 text-amber-100/70">
                This source currently routes to {previousAccountName}. Saving will move it here; it will never feed both targets.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button onClick={onConfirmReassignment} disabled={busy === 'save-signal'}>Confirm reassignment</Button>
              </div>
            </div>
          )}
          {!pendingReassignment && (
            <div className="flex justify-end gap-2 md:col-span-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button onClick={onSave} disabled={busy === 'save-signal'}>Save source</Button></div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {accountRoutes.map((route) => (
          <div key={route.route_id} className="flex items-center gap-3 rounded-md border border-white/10 bg-black/10 px-3 py-2.5">
            <RadioTower className="size-3.5 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{route.display_name}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">Server {route.server_id} · channel {route.channel_id} · trader {route.trader_author_id}</p>
            </div>
            <StatusBadge positive={route.enabled}>{route.enabled ? 'Routed' : 'Off'}</StatusBadge>
            <Button variant="ghost" size="icon" aria-label={`Remove ${route.display_name}`} onClick={() => onRemove(route.route_id)}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        {!accountRoutes.length && !editing && <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-muted-foreground">No Discord source assigned to this {targetLabel}.</p>}
      </div>
    </div>
  )
}

export function isExecutionReady(
  status: Awaited<ReturnType<typeof window.electronAPI.listTradingConnections>>[number],
): boolean {
  return status.connection.enabled && status.connection.state === 'ready'
}

export function isPaperMandateEligible(
  status: Awaited<ReturnType<typeof window.electronAPI.listTradingConnections>>[number],
): boolean {
  const connection = status.connection
  return connection.enabled
    && connection.state === 'ready'
    && connection.environment === 'paper'
    && connection.environment_class === 'rehearsal'
    && connection.certifications.includes('paper-lifecycle-certified')
}

export function formatPaperMandateConfirmation(input: {
  accountName: string
  symbols: string[]
  maxContracts: number
  maxOpenRisk: number
  maxDailyLoss: number
  expiresAt: Date
}): string {
  return [
    `Activate this PAPER mandate for ${input.accountName}?`,
    `Contracts: ${input.symbols.join(', ')}`,
    `Max contracts/order: ${input.maxContracts}`,
    `Max open risk: $${input.maxOpenRisk}`,
    `Max daily loss: $${input.maxDailyLoss}`,
    `Expires: ${input.expiresAt.toLocaleString()}`,
    '',
    'New entries remain blocked unless the exact provider adapter is certified, attached, and the global halt is released.',
  ].join('\n')
}

export function findSignalRouteByIdentity(
  routes: SignalRoute[],
  draft: Pick<SignalDraft, 'serverId' | 'channelId' | 'traderAuthorId'>,
): SignalRoute | undefined {
  return routes.find((route) => route.server_id === draft.serverId
    && route.channel_id === draft.channelId
    && route.trader_author_id === draft.traderAuthorId)
}

export function signalRouteTargetKey(route: SignalRoute): string {
  return route.target.type === 'connection'
    ? `connection:${route.target.connection_id}`
    : `mirror-group:${route.target.mirror_group_id}`
}

export function routeTargetsConnection(route: SignalRoute, connectionId: string): boolean {
  return route.target.type === 'connection' && route.target.connection_id === connectionId
}

function signalDraftTarget(value: string): SignalRoute['target'] {
  const mirrorPrefix = 'mirror-group:'
  return value.startsWith(mirrorPrefix)
    ? { type: 'mirror-group', mirror_group_id: value.slice(mirrorPrefix.length) }
    : { type: 'connection', connection_id: value }
}

function signalDraftTargetKey(value: string): string {
  const target = signalDraftTarget(value)
  return target.type === 'connection'
    ? `connection:${target.connection_id}`
    : `mirror-group:${target.mirror_group_id}`
}

function describeSignalRouteTarget(route: SignalRoute): string {
  return route.target.type === 'connection'
    ? route.target.connection_id
    : `Mirror Group ${route.target.mirror_group_id}`
}

function CertificationMatrix(props: {
  evidence?: Awaited<
    ReturnType<typeof window.electronAPI.listTradingConnections>
  >[number]['certification_evidence'][number]
}) {
  if (!props.evidence) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-[11px] text-muted-foreground">
        No adapter certification evidence. Connection remains disabled.
      </div>
    )
  }
  const passed = props.evidence.scenarios.filter((scenario) => scenario.status === 'pass').length
  return (
    <div className="grid gap-2 rounded-lg border border-white/10 bg-black/10 p-3 text-[11px] md:grid-cols-4">
      <div>
        <p className="text-muted-foreground">Adapter evidence</p>
        <p className="mt-1 font-mono">{props.evidence.adapter_id} {props.evidence.adapter_version}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Forced failures</p>
        <p className="mt-1">{passed}/{props.evidence.scenarios.length} passed</p>
      </div>
      <div>
        <p className="text-muted-foreground">Paper lifecycle soak</p>
        <p className="mt-1">
          {props.evidence.soak.completed_lifecycles}/50 attempted · {
            props.evidence.soak.duplicate_submissions
            + props.evidence.soak.unprotected_positions
            + props.evidence.soak.unresolved_divergences
            + props.evidence.soak.incomplete_closes
          } critical defects
        </p>
      </div>
      <div>
        <p className="text-muted-foreground">Gate</p>
        <p className="mt-1">
          {props.evidence.eligible_certifications.includes('paper-lifecycle-certified')
            ? 'Paper lifecycle certified'
            : `${props.evidence.blockers.length} blockers`}
        </p>
      </div>
    </div>
  )
}

function Field(props: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={props.className}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{props.label}</span>
      {props.children}
    </label>
  )
}

function Guardrail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

function StatusBadge({ children, positive }: { children: React.ReactNode; positive: boolean }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${positive
      ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200'
      : 'border-amber-400/20 bg-amber-400/[0.08] text-amber-200'}`}>
      {children}
    </span>
  )
}

const slugify = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 60) || 'prop-firm'

const inputClass = 'h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none transition focus:border-amber-400/50'
