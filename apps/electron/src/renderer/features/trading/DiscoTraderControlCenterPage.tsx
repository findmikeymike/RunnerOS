import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageSquare,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import { TRADE_DESK_AGENT } from '@craft-agent/shared/agent-definitions/trade-god-starter-templates'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAgents } from '@/hooks/useAgents'
import { navigate, routes } from '@/lib/navigate'
import type { AgentDefinitionDTO, FolderSourceConfig } from '../../../shared/types'

type SourceState = 'checking' | 'unconfigured' | 'ready' | 'offline' | 'conflict'

interface DiscoTraderControlCenterPageProps {
  workspaceId?: string
}

const SOURCE_SLUG = 'discotrader'
const WORKER_SLUG = 'trade-desk'
const DISCOTRADER_MCP_URL = 'http://127.0.0.1:8788/mcp'
const DISCOTRADER_READ_ONLY_TOOLS = [
  'dt_status',
  'dt_signal_sources',
  'dt_positions',
  'dt_pending_tickets',
  'dt_recent_alerts',
] as const

export function isAuditedDiscoTraderSource(config: FolderSourceConfig): boolean {
  return config.slug === SOURCE_SLUG
    && config.provider === 'discotrader'
    && config.type === 'mcp'
    && config.enabled
    && config.mcp?.transport === 'http'
    && config.mcp.url === DISCOTRADER_MCP_URL
    && config.mcp.authType === 'bearer'
    && JSON.stringify(config.mcp.allowedTools) === JSON.stringify(DISCOTRADER_READ_ONLY_TOOLS)
}

export function isAuditedTradeDeskWorker(worker: AgentDefinitionDTO | undefined): boolean {
  if (!worker) return false
  const actual = worker.metadata
  const expected = TRADE_DESK_AGENT.metadata
  return worker.slug === WORKER_SLUG
    && worker.systemPrompt === TRADE_DESK_AGENT.systemPrompt
    && actual.name === expected.name
    && actual.description === expected.description
    && actual.avatar === expected.avatar
    && actual.permissionMode === expected.permissionMode
    && actual.thinkingLevel === expected.thinkingLevel
    && actual.greeting === expected.greeting
    && actual.inputs === expected.inputs
    && actual.outputs === expected.outputs
    && JSON.stringify(actual.tags) === JSON.stringify(expected.tags)
    && JSON.stringify(actual.skills) === JSON.stringify(expected.skills)
    && JSON.stringify(actual.sources) === JSON.stringify(expected.sources)
    && !actual.llmConnection
    && !actual.model
    && !actual.optionalSources?.length
    && !actual.trustedWorkerTools?.length
    && !actual.visualAgent
}

const openTradeGodView = (view: 'accounts' | 'trades') => {
  window.sessionStorage.setItem('trade-god:active-view', view)
  window.dispatchEvent(new CustomEvent('trade-god:view', { detail: view }))
}

export default function DiscoTraderControlCenterPage({
  workspaceId,
}: DiscoTraderControlCenterPageProps) {
  const {
    allAgents,
    activeSlugs,
    loading: agentsLoading,
    error: agentsError,
    upsert,
    setActive,
  } = useAgents(workspaceId)
  const [sourceState, setSourceState] = useState<SourceState>('checking')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [toolCount, setToolCount] = useState(0)
  const [token, setToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(false)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [globalExecutionKill, setGlobalExecutionKill] = useState<boolean | null>(null)
  const [providerAdaptersAttached, setProviderAdaptersAttached] = useState<boolean | null>(null)
  const [reconciliationStaleCount, setReconciliationStaleCount] = useState(0)
  const [userSyncSubscribedCount, setUserSyncSubscribedCount] = useState(0)
  const [userSyncGapCount, setUserSyncGapCount] = useState(0)
  const [connectionKillCount, setConnectionKillCount] = useState(0)
  const [activationBusy, setActivationBusy] = useState(false)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [workerBusy, setWorkerBusy] = useState(false)
  const [readyConnections, setReadyConnections] = useState(0)
  const [verifiedConnections, setVerifiedConnections] = useState(0)
  const [connectionCount, setConnectionCount] = useState(0)

  const worker = useMemo(
    () => allAgents.find((agent) => agent.slug === WORKER_SLUG),
    [allAgents],
  )
  const workerMatchesTemplate = isAuditedTradeDeskWorker(worker)
  const workerConflict = Boolean(worker && !workerMatchesTemplate)
  const workerActive = activeSlugs.includes(WORKER_SLUG)

  const probeSource = useCallback(async (): Promise<SourceState> => {
    if (!workspaceId) {
      setSourceState('unconfigured')
      setSourceError('Open the Trading workspace before connecting Discord.')
      return 'unconfigured'
    }

    setSourceState('checking')
    setSourceError(null)
    try {
      const sources = await window.electronAPI.getSources(workspaceId)
      const source = sources.find((entry) => entry.config.slug === SOURCE_SLUG)
      if (!source) {
        setSourceState('unconfigured')
        setToolCount(0)
        return 'unconfigured'
      }
      if (!isAuditedDiscoTraderSource(source.config)) {
        setSourceState('conflict')
        setSourceError('An older Discord connection needs attention before it can be used.')
        setToolCount(0)
        return 'conflict'
      }

      const result = await window.electronAPI.getMcpTools(workspaceId, SOURCE_SLUG)
      if (!result.success) {
        setSourceState('offline')
        setSourceError('DiscoTrader is saved, but it is not currently running.')
        setToolCount(0)
        return 'offline'
      }

      setSourceState('ready')
      setToolCount(result.tools?.length ?? 0)
      return 'ready'
    } catch (error) {
      setSourceState('offline')
      setSourceError(error instanceof Error ? error.message : String(error))
      setToolCount(0)
      return 'offline'
    }
  }, [workspaceId])

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await window.electronAPI.listTradingConnections()
      setConnectionCount(connections.length)
      setReadyConnections(connections.filter(({ connection }) => (
        connection.enabled && connection.state === 'ready'
      )).length)
      setVerifiedConnections(connections.filter(({ provider_read_fresh }) => provider_read_fresh).length)
    } catch {
      setConnectionCount(0)
      setReadyConnections(0)
      setVerifiedConnections(0)
    }
  }, [])

  const refreshExecutionControl = useCallback(async () => {
    try {
      const {
        global_kill,
        connection_kills,
        provider_adapters_attached,
        reconciliation_health,
        user_sync_health,
      } = await window.electronAPI.getTradeGodExecutionControl()
      setGlobalExecutionKill(global_kill)
      setProviderAdaptersAttached(provider_adapters_attached)
      setReconciliationStaleCount(reconciliation_health?.stale_connection_ids.length ?? 0)
      setUserSyncSubscribedCount(user_sync_health?.filter(({ state }) => state === 'subscribed').length ?? 0)
      setUserSyncGapCount(user_sync_health?.filter(({ state }) => (
        state === 'gap' || state === 'reconnecting'
      )).length ?? 0)
      setConnectionKillCount(connection_kills.length)
    } catch {
      setGlobalExecutionKill(null)
      setProviderAdaptersAttached(null)
      setReconciliationStaleCount(0)
      setUserSyncSubscribedCount(0)
      setUserSyncGapCount(0)
      setConnectionKillCount(0)
    }
  }, [])

  useEffect(() => {
    void probeSource()
    void refreshConnections()
    void window.electronAPI.getDiscoTraderWebhookSecretStatus()
      .then(({ configured }) => setWebhookSecretConfigured(configured))
      .catch(() => setWebhookSecretConfigured(false))
    void refreshExecutionControl()
    const controlPoll = window.setInterval(() => void refreshExecutionControl(), 5_000)
    return () => window.clearInterval(controlPoll)
  }, [probeSource, refreshConnections, refreshExecutionControl])

  const handleGlobalExecutionKill = useCallback(async () => {
    if (globalExecutionKill === null) return
    setActivationBusy(true)
    try {
      if (!globalExecutionKill) {
        await window.electronAPI.setTradeGodGlobalExecutionKill(true)
        setGlobalExecutionKill(true)
        toast.success('New paper trades are paused')
        return
      }
      const review = await window.electronAPI.prepareTradeGodPaperActivation()
      if (!review.ready) {
        const details = review.blockers.slice(0, 3).map((blocker) => blocker.detail).join(' ')
        throw new Error(details || 'Finish the required account checks first.')
      }
      const accountLines = review.connections.map((connection) => [
        `• ${connection.connection_id}`,
        `  ${connection.authorized_symbols.join(', ')} · up to ${connection.max_contracts} contract(s) per order`,
        `  max open risk $${connection.max_open_risk} · max daily loss $${connection.max_daily_loss}`,
      ].join('\n')).join('\n')
      const pendingLines = review.pending_intents.length > 0
        ? review.pending_intents.map((intent) => (
            `• Cancel ${intent.side.toUpperCase()} ${intent.quantity} ${intent.symbol} on ${intent.connection_id}`
          )).join('\n')
        : '• Nothing is waiting to run'
      if (!window.confirm(
        `Turn on paper trading for ${review.connections.length} account(s)?\n\n${accountLines}\n\nWaiting signals will not run:\n${pendingLines}\n\nThis review expires in 60 seconds.`,
      )) return
      await window.electronAPI.commitTradeGodPaperActivation(review.review_id, review.content_checksum)
      await refreshExecutionControl()
      toast.success('Paper trading is on', {
        description: `${review.pending_intents.length} old signal${review.pending_intents.length === 1 ? '' : 's'} cleared.`,
      })
    } catch (error) {
      await refreshExecutionControl()
      toast.error('Paper trading is still off', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setActivationBusy(false)
    }
  }, [globalExecutionKill, refreshExecutionControl])

  const ensureTradeDeskWorker = useCallback(async () => {
    if (!workspaceId) throw new Error('Open the Trading workspace first.')
    setWorkerBusy(true)
    try {
      if (workerConflict) {
        throw new Error('A previous Trade Desk setup needs attention. Open Advanced troubleshooting.')
      }
      if (!worker) {
        await upsert({
          slug: TRADE_DESK_AGENT.slug,
          metadata: TRADE_DESK_AGENT.metadata,
          systemPrompt: TRADE_DESK_AGENT.systemPrompt,
        })
      } else if (!workerActive) {
        await setActive(WORKER_SLUG, true)
      }
    } finally {
      setWorkerBusy(false)
    }
  }, [setActive, upsert, worker, workerActive, workerConflict, workspaceId])

  const handleConnectSource = useCallback(async () => {
    if (!workspaceId) return
    setSourceBusy(true)
    try {
      const sources = await window.electronAPI.getSources(workspaceId)
      const existing = sources.find((entry) => entry.config.slug === SOURCE_SLUG)

      if (!webhookSecretConfigured && !webhookSecret.trim()) {
        throw new Error('Enter the webhook key from DiscoTrader.')
      }

      if (existing && !isAuditedDiscoTraderSource(existing.config)) {
        throw new Error('An older Discord connection needs attention. Open Advanced troubleshooting.')
      }

      if (!existing) {
        if (!token.trim()) throw new Error('Enter the connection key from DiscoTrader.')
        const created = await window.electronAPI.createSource(workspaceId, {
          name: 'DiscoTrader',
          provider: 'discotrader',
          type: 'mcp',
          enabled: true,
          icon: '📈',
          tagline: 'Local signed-ticket futures execution daemon',
          mcp: {
            transport: 'http',
            url: DISCOTRADER_MCP_URL,
            authType: 'bearer',
            allowedTools: [...DISCOTRADER_READ_ONLY_TOOLS],
          },
        })
        if (created.slug !== SOURCE_SLUG) {
          await window.electronAPI.deleteSource(workspaceId, created.slug)
          throw new Error('A previous Discord connection needs attention. Open Advanced troubleshooting.')
        }
      }

      if (token.trim()) {
        await window.electronAPI.saveSourceCredentials(workspaceId, SOURCE_SLUG, token.trim())
        setToken('')
      }
      if (webhookSecret.trim()) {
        await window.electronAPI.saveDiscoTraderWebhookSecret(webhookSecret.trim())
        setWebhookSecret('')
        setWebhookSecretConfigured(true)
      }

      const state = await probeSource()
      if (state !== 'ready') throw new Error('DiscoTrader is saved, but it is not currently running.')
      await ensureTradeDeskWorker()
      setConnectDialogOpen(false)
      toast.success('Discord is connected')
    } catch (error) {
      toast.error('Discord could not connect', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSourceBusy(false)
    }
  }, [ensureTradeDeskWorker, probeSource, token, webhookSecret, webhookSecretConfigured, workspaceId])

  const setupComplete = sourceState === 'ready'
    && webhookSecretConfigured
    && workerActive
    && workerMatchesTemplate
  const accountConnected = connectionCount > 0
  const accountVerified = verifiedConnections > 0
  const activated = readyConnections > 0 && globalExecutionKill === false && connectionKillCount === 0
  const activationAvailable = setupComplete && accountVerified && readyConnections > 0

  return (
    <div className="runneros-glass-route h-full overflow-y-auto bg-[#090b0e] text-[#eef0f3]">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 py-8 xl:px-10">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-medium text-[#8b93a1]">Discord copy trading</p>
            <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.035em]">DiscoTrader</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#858d99]">
              Copy trades from the Discord traders you choose into your selected paper accounts.
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] ${
            activated
              ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300'
              : 'border-white/[0.09] bg-white/[0.025] text-[#9aa2ad]'
          }`}>
            {activated ? <CheckCircle2 className="size-3.5" /> : <LockKeyhole className="size-3.5" />}
            {activated ? 'Paper trading is on' : 'Paper trading is off'}
          </div>
        </header>

        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1014] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="border-b border-white/[0.06] px-6 py-5">
            <h2 className="text-base font-semibold tracking-[-0.01em]">Get started</h2>
            <p className="mt-1 text-xs text-[#747d89]">Three steps. You stay in control of every account and limit.</p>
          </div>
          <div className="divide-y divide-white/[0.06]">
            <SetupAction
              number="1"
              icon={<MessageSquare className="size-4" />}
              title="Connect Discord"
              description="Link the DiscoTrader feed that watches your chosen Discord channels."
              complete={setupComplete}
              status={setupComplete ? 'Connected' : sourceState === 'checking' ? 'Checking…' : 'Not connected'}
              actionLabel={setupComplete ? 'Manage' : 'Connect Discord'}
              onAction={() => setConnectDialogOpen(true)}
            />
            <SetupAction
              number="2"
              icon={<WalletCards className="size-4" />}
              title="Add your accounts"
              description="Connect each paper account, then choose which Discord trader it follows."
              complete={accountConnected}
              status={accountConnected ? `${connectionCount} account${connectionCount === 1 ? '' : 's'}` : 'No accounts yet'}
              actionLabel={accountConnected ? 'Manage accounts' : 'Add account'}
              onAction={() => openTradeGodView('accounts')}
            />
            <SetupAction
              number="3"
              icon={<ShieldCheck className="size-4" />}
              title="Turn on paper trading"
              description="Review your accounts and limits once, then allow new paper trades."
              complete={activated}
              status={activated ? 'On' : activationAvailable ? 'Ready to review' : 'Finish setup first'}
              actionLabel={activated ? 'Pause new trades' : 'Review & turn on'}
              onAction={() => void handleGlobalExecutionKill()}
              disabled={!activated && !activationAvailable || activationBusy}
              busy={activationBusy}
            />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3" aria-label="How DiscoTrader works">
          <HowItWorksCard number="1" title="A signal arrives" description="DiscoTrader reads a post from a trader you approved." />
          <HowItWorksCard number="2" title="Your rules are checked" description="The app confirms the right account, trade, size, and safety limits." />
          <HowItWorksCard number="3" title="The paper trade is managed" description="Entries and follow-ups stay attached to the correct account and trade." />
        </section>

        <button
          type="button"
          onClick={() => openTradeGodView('trades')}
          className="group flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.018] px-5 py-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.03]"
        >
          <div>
            <p className="text-sm font-medium">View active and past trades</p>
            <p className="mt-1 text-xs text-[#707986]">See every accepted signal, open position, update, and final result.</p>
          </div>
          <ChevronRight className="size-4 text-[#606975] transition group-hover:translate-x-0.5 group-hover:text-white" />
        </button>

        <details className="group rounded-xl border border-white/[0.07] bg-white/[0.012]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-sm font-medium text-[#b9c0c9]">Advanced troubleshooting</p>
              <p className="mt-1 text-xs text-[#68717d]">Connection diagnostics and manual safety controls.</p>
            </div>
            <ChevronRight className="size-4 text-[#606975] transition-transform group-open:rotate-90" />
          </summary>
          <div className="grid gap-5 border-t border-white/[0.06] px-5 py-5 lg:grid-cols-2">
            <div className="space-y-3">
              <AdvancedRow label="Discord service" value={sourceState === 'ready' ? 'Online' : sourceState} />
              <AdvancedRow label="Trade helper" value={workerActive && workerMatchesTemplate ? 'Ready' : 'Needs attention'} />
              <AdvancedRow label="Account data" value={userSyncSubscribedCount ? 'Live updates connected' : providerAdaptersAttached ? 'Connected' : 'Not connected'} />
              <AdvancedRow label="Safety checks" value={userSyncGapCount || reconciliationStaleCount || connectionKillCount ? 'Needs attention' : globalExecutionKill ? 'New trades paused' : 'Ready'} />
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => { void probeSource(); void refreshConnections(); void refreshExecutionControl() }}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.09] text-xs font-medium text-[#c3c9d1] hover:bg-white/[0.04]"
              >
                <RefreshCw className="size-3.5" /> Refresh status
              </button>
              {worker && (
                <button
                  type="button"
                  onClick={() => navigate(routes.view.agents(WORKER_SLUG))}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.09] text-xs font-medium text-[#c3c9d1] hover:bg-white/[0.04]"
                >
                  <Bot className="size-3.5" /> Open Trade Desk helper
                </button>
              )}
              {sourceState === 'conflict' && (
                <button
                  type="button"
                  onClick={() => navigate(routes.view.sourcesMcp(SOURCE_SLUG))}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-amber-300/20 text-xs font-medium text-amber-200 hover:bg-amber-300/[0.04]"
                >
                  <AlertTriangle className="size-3.5" /> Review old connection
                </button>
              )}
            </div>
            {(sourceError || agentsError) && (
              <div className="lg:col-span-2 rounded-lg border border-red-400/15 bg-red-400/[0.04] px-4 py-3 text-[11px] leading-5 text-red-200">
                {sourceError || agentsError}
              </div>
            )}
          </div>
        </details>
      </div>

      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto border border-white/[0.09] bg-[#0d1014] p-0 text-white shadow-2xl">
          <DialogHeader className="border-b border-white/[0.07] px-6 pb-5 pt-6 pr-14">
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-amber-300/15 bg-amber-300/[0.07] text-amber-200">
              <MessageSquare className="size-5" />
            </div>
            <DialogTitle className="text-xl tracking-[-0.02em]">Connect Discord</DialogTitle>
            <DialogDescription className="max-w-md leading-5 text-[#7d8692]">
              Copy the two private keys from DiscoTrader, paste them below, and we will handle the rest.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 pb-6">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs leading-5 text-[#929aa5]">
              Paste the two private keys from your DiscoTrader setup. If you do not know where they are, open Manual setup below.
            </div>
            <label className="block">
              <span className="text-xs font-medium text-[#d8dce2]">Connection key</span>
              <div className="relative mt-2">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#687382]" />
                <input
                  aria-label="Connection key"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={sourceState === 'unconfigured' ? 'Paste connection key' : 'Saved · paste only to replace'}
                  className="h-11 w-full rounded-lg border border-white/[0.09] bg-[#090c0f] pl-10 pr-3 text-sm text-white outline-none placeholder:text-[#4f5864] focus:border-amber-300/40"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[#d8dce2]">Webhook key</span>
              <div className="relative mt-2">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#687382]" />
                <input
                  aria-label="Webhook key"
                  type="password"
                  value={webhookSecret}
                  onChange={(event) => setWebhookSecret(event.target.value)}
                  placeholder={webhookSecretConfigured ? 'Saved · paste only to replace' : 'Paste webhook key'}
                  className="h-11 w-full rounded-lg border border-white/[0.09] bg-[#090c0f] pl-10 pr-3 text-sm text-white outline-none placeholder:text-[#4f5864] focus:border-amber-300/40"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={() => void handleConnectSource()}
              disabled={sourceBusy || workerBusy || agentsLoading || !workspaceId || (
                sourceState === 'unconfigured'
                && (!token.trim() || (!webhookSecretConfigured && !webhookSecret.trim()))
              )}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-semibold text-black transition hover:bg-[#e8eaed] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sourceBusy || workerBusy ? <Loader2 className="size-4 animate-spin" /> : setupComplete ? <Check className="size-4" /> : <PlugZap className="size-4" />}
              {setupComplete && !token.trim() && !webhookSecret.trim() ? 'Check connection' : 'Connect Discord'}
            </button>
            {sourceError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-400/15 bg-red-400/[0.04] px-4 py-3 text-xs leading-5 text-red-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {sourceError}
              </div>
            )}
            <details className="group rounded-lg border border-white/[0.07] bg-black/10">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs text-[#8c95a1]">
                Manual setup & diagnostics
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              </summary>
              <div className="space-y-3 border-t border-white/[0.06] px-4 py-4 text-[11px] leading-5 text-[#737d89]">
                <p>If DiscoTrader is not running, start its local service:</p>
                <code className="block overflow-x-auto rounded-md border border-white/[0.07] bg-[#080a0d] px-3 py-2 font-mono text-[#aeb7c2]">
                  cd ~/CAS4/DiscoTrader/v2 &amp;&amp; npm start
                </code>
                <p>Advanced names: connection key = <code>DT_MCP_TOKEN</code>; webhook key = <code>DT_SHARED_SECRET</code>. Both are stored encrypted.</p>
                <p>Local address: <code>{DISCOTRADER_MCP_URL}</code> · {toolCount} read-only tools found.</p>
              </div>
            </details>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SetupAction({
  number,
  icon,
  title,
  description,
  complete,
  status,
  actionLabel,
  onAction,
  disabled = false,
  busy = false,
}: {
  number: string
  icon: React.ReactNode
  title: string
  description: string
  complete: boolean
  status: string
  actionLabel: string
  onAction: () => void
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <div className="grid gap-4 px-6 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-4">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${complete ? 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300' : 'border-white/[0.08] bg-white/[0.025] text-[#8c95a1]'}`}>
          {complete ? <CheckCircle2 className="size-4" /> : icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-[#e4e7eb]"><span className="mr-2 text-[#5f6875]">{number}.</span>{title}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${complete ? 'bg-emerald-400/[0.07] text-emerald-300' : 'bg-white/[0.04] text-[#7a8490]'}`}>{status}</span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#747d89]">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="inline-flex h-9 min-w-[132px] items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-4 text-xs font-medium text-[#d5dae0] transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-35"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {actionLabel}<ArrowRight className="size-3.5" />
      </button>
    </div>
  )
}

function HowItWorksCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-5">
      <div className="flex size-6 items-center justify-center rounded-full bg-white/[0.05] text-[10px] font-semibold text-[#9aa2ad]">{number}</div>
      <p className="mt-4 text-sm font-medium text-[#d9dde2]">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-[#6f7884]">{description}</p>
    </div>
  )
}

function AdvancedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-black/10 px-4 py-3">
      <span className="text-xs text-[#7b8490]">{label}</span>
      <span className="text-xs font-medium text-[#c6ccd4]">{value}</span>
    </div>
  )
}
