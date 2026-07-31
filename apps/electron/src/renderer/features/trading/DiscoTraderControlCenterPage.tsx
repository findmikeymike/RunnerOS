import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleOff,
  DatabaseZap,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageSquare,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { TRADE_DESK_AGENT } from '@craft-agent/shared/agent-definitions/trade-god-starter-templates'
import { toast } from 'sonner'

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

export function isAuditedDiscoTraderSource(config: FolderSourceConfig): boolean {
  return config.slug === SOURCE_SLUG
    && config.provider === 'discotrader'
    && config.type === 'mcp'
    && config.enabled
    && config.mcp?.transport === 'http'
    && config.mcp.url === DISCOTRADER_MCP_URL
    && config.mcp.authType === 'bearer'
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
  const [sourceBusy, setSourceBusy] = useState(false)
  const [workerBusy, setWorkerBusy] = useState(false)
  const [readyConnections, setReadyConnections] = useState(0)
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
      setSourceError('Open a Trading workspace before connecting DiscoTrader.')
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
        setSourceError('The existing discotrader source does not match the audited loopback bearer configuration.')
        setToolCount(0)
        return 'conflict'
      }

      const result = await window.electronAPI.getMcpTools(workspaceId, SOURCE_SLUG)
      if (!result.success) {
        setSourceState('offline')
        setSourceError(result.error || 'DiscoTrader did not return its tool catalog.')
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
    } catch {
      setConnectionCount(0)
      setReadyConnections(0)
    }
  }, [])

  useEffect(() => {
    void probeSource()
    void refreshConnections()
  }, [probeSource, refreshConnections])

  const handleConnectSource = useCallback(async () => {
    if (!workspaceId) return
    setSourceBusy(true)
    try {
      const sources = await window.electronAPI.getSources(workspaceId)
      const existing = sources.find((entry) => entry.config.slug === SOURCE_SLUG)

      if (existing && !isAuditedDiscoTraderSource(existing.config)) {
        navigate(routes.view.sourcesMcp(SOURCE_SLUG))
        throw new Error('The existing discotrader source differs from the audited local configuration. Review or delete it first.')
      }

      if (!existing) {
        if (!token.trim()) {
          throw new Error('Paste DT_MCP_TOKEN from DiscoTrader v2/.env first.')
        }
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
          },
        })
        if (created.slug !== SOURCE_SLUG) {
          await window.electronAPI.deleteSource(workspaceId, created.slug)
          throw new Error('A conflicting DiscoTrader source already exists. Open Sources and resolve it first.')
        }
      }

      if (token.trim()) {
        await window.electronAPI.saveSourceCredentials(workspaceId, SOURCE_SLUG, token.trim())
        setToken('')
      }

      const state = await probeSource()
      if (state === 'ready') toast.success('DiscoTrader source connected')
      else toast.error('DiscoTrader source saved but the daemon is not reachable')
    } catch (error) {
      toast.error('Could not connect DiscoTrader', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSourceBusy(false)
    }
  }, [probeSource, token, workspaceId])

  const handleInstallWorker = useCallback(async () => {
    if (!workspaceId) return
    setWorkerBusy(true)
    try {
      if (workerConflict) {
        navigate(routes.view.agents(WORKER_SLUG))
        throw new Error('An existing trade-desk definition differs from the audited bundle. Review or delete it before installation.')
      }
      if (!worker) {
        await upsert({
          slug: TRADE_DESK_AGENT.slug,
          metadata: TRADE_DESK_AGENT.metadata,
          systemPrompt: TRADE_DESK_AGENT.systemPrompt,
        })
        toast.success('Trade Desk installed and activated in this workspace')
      } else if (!workerActive) {
        await setActive(WORKER_SLUG, true)
        toast.success('Trade Desk activated in this workspace')
      } else {
        toast.success('Trade Desk is already active')
      }
    } catch (error) {
      toast.error('Could not install Trade Desk', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setWorkerBusy(false)
    }
  }, [setActive, upsert, worker, workerActive, workerConflict, workspaceId])

  const setupComplete = sourceState === 'ready' && workerActive && workerMatchesTemplate
  const brokerLabel = readyConnections > 0
    ? `${readyConnections} ready`
    : connectionCount > 0
      ? `${connectionCount} configured`
      : 'Not configured'

  return (
    <div className="runneros-glass-route h-full overflow-y-auto bg-[#080b0e] text-[#eaecef]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-5 py-5 xl:px-8 xl:py-7">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#252b33] pb-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-300">
              <DatabaseZap className="h-4 w-4" /> Futures automation
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">DiscoTrader Control Center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#929aa5]">
              Connect the local daemon, install its Trade Desk worker, and see which execution gates are actually ready.
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            setupComplete
              ? 'border-[#0ecb81]/25 bg-[#0ecb81]/[0.07] text-[#8fe8bd]'
              : 'border-amber-300/20 bg-amber-300/[0.06] text-amber-100'
          }`}>
            {setupComplete ? <ShieldCheck className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
            {setupComplete ? 'Desk connected · actions still approval-gated' : 'Setup required · no autonomous execution'}
          </div>
        </header>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="DiscoTrader status">
          <StatusCard
            icon={<Server className="h-4 w-4" />}
            label="Daemon bridge"
            value={sourceState === 'ready' ? 'Online' : sourceState === 'checking' ? 'Checking' : sourceState === 'offline' ? 'Offline' : sourceState === 'conflict' ? 'Config conflict' : 'Not connected'}
            detail={sourceState === 'ready' ? `${toolCount} MCP tools available` : '127.0.0.1:8788'}
            tone={sourceState === 'ready' ? 'positive' : sourceState === 'offline' || sourceState === 'conflict' ? 'danger' : 'warning'}
          />
          <StatusCard
            icon={<Bot className="h-4 w-4" />}
            label="Trade Desk worker"
            value={workerConflict ? 'Definition conflict' : workerActive ? 'Active' : worker ? 'Installed' : agentsLoading ? 'Checking' : 'Not installed'}
            detail={workerConflict ? 'Review before activation' : workerActive ? 'Scoped to this workspace' : 'Explicit activation required'}
            tone={workerConflict ? 'danger' : workerActive ? 'positive' : 'warning'}
          />
          <StatusCard
            icon={<PlugZap className="h-4 w-4" />}
            label="Broker route"
            value={brokerLabel}
            detail={readyConnections > 0 ? 'Connection ready; adapter certification still applies' : 'Settings → Trading Connections'}
            tone={readyConnections > 0 ? 'positive' : 'muted'}
          />
          <StatusCard
            icon={<LockKeyhole className="h-4 w-4" />}
            label="Live actions"
            value="Ask first"
            detail="Every tool call remains approval-gated"
            tone="muted"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="rounded-xl border border-[#252b33] bg-[#11161b] p-5">
            <div className="mb-5">
              <div className="text-xs font-semibold text-white">One-time setup</div>
              <p className="mt-1 text-xs leading-5 text-[#7e8793]">
                The app stores the daemon token in encrypted credentials. It never writes the token into the worker.
              </p>
            </div>

            <SetupStep
              number="1"
              title="Run DiscoTrader"
              state={sourceState === 'ready' ? 'complete' : 'pending'}
              description="Start the v2 daemon. The desktop app connects only to its loopback MCP endpoint."
            >
              <code className="block overflow-x-auto rounded-md border border-[#2a3038] bg-[#090c0f] px-3 py-2 font-mono text-[11px] text-[#aeb7c2]">
                cd ~/CAS4/DiscoTrader/v2 &amp;&amp; npm start
              </code>
            </SetupStep>

            <SetupStep
              number="2"
              title="Connect the signed local source"
              state={sourceState === 'ready' ? 'complete' : sourceState === 'offline' || sourceState === 'conflict' ? 'error' : 'pending'}
              description="Use DT_MCP_TOKEN from DiscoTrader v2/.env. Shell and file secrets are never shown here after save."
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#687382]" />
                  <input
                    aria-label="DiscoTrader MCP token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={sourceState === 'unconfigured' ? 'Paste DT_MCP_TOKEN' : 'Optional: replace saved token'}
                    className="h-10 w-full rounded-md border border-[#2a3038] bg-[#090c0f] pl-9 pr-3 text-xs text-white outline-none placeholder:text-[#545d69] focus:border-amber-300/40"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleConnectSource}
                  disabled={sourceBusy || !workspaceId || (sourceState === 'unconfigured' && !token.trim())}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 text-xs font-semibold text-black transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sourceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                  {sourceState === 'unconfigured' ? 'Connect source' : sourceState === 'conflict' ? 'Review conflicting source' : token.trim() ? 'Save token + test' : 'Test connection'}
                </button>
              </div>
              {sourceError && (
                <div className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[#ff9b9b]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{sourceError}</span>
                </div>
              )}
            </SetupStep>

            <SetupStep
              number="3"
              title="Install the Trade Desk worker"
              state={workerActive ? 'complete' : 'pending'}
              description="Creates the audited worker definition globally, then activates it only in this Trading workspace."
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleInstallWorker}
                  disabled={workerBusy || agentsLoading || !workspaceId}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-[#e6e8eb] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {workerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                  {workerConflict ? 'Review conflicting worker' : workerActive ? 'Worker active' : worker ? 'Activate worker' : 'Install worker'}
                </button>
                {worker && (
                  <button
                    type="button"
                    onClick={() => navigate(routes.view.agents(WORKER_SLUG))}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-[#303741] px-4 text-xs font-medium text-[#c4cbd4] hover:bg-white/[0.04]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open worker
                  </button>
                )}
              </div>
              {agentsError && <p className="mt-2 text-[11px] text-[#ff9b9b]">{agentsError}</p>}
            </SetupStep>
          </div>

          <div className="grid gap-4">
            <div className="rounded-xl border border-[#252b33] bg-[#11161b] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-white">How it runs</div>
                  <p className="mt-1 text-[11px] text-[#707a87]">Deterministic system first; worker only at the decision edge.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void probeSource()
                    void refreshConnections()
                  }}
                  className="rounded-md border border-[#2a3038] p-2 text-[#7d8794] hover:bg-white/[0.04] hover:text-white"
                  aria-label="Refresh DiscoTrader status"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-5 grid gap-2">
                <FlowRow label="Discord signal" detail="DiscoTrader parses + risk-gates" />
                <FlowRow label="Sized ticket" detail="Immutable ticket ID" />
                <FlowRow label="Trade Desk" detail="Status, exceptions, approvals" />
                <FlowRow label="Trade God gateway" detail="Connection + certification gates" />
                <FlowRow label="Provider" detail="Paper first; live requires explicit arming" last />
              </div>
            </div>

            <div className="rounded-xl border border-[#252b33] bg-[#11161b] p-5">
              <div className="text-xs font-semibold text-white">Operating surfaces</div>
              <div className="mt-4 grid gap-2">
                <OperationRow
                  icon={<MessageSquare className="h-4 w-4" />}
                  title="Talk to Trade Desk"
                  detail="Opens the worker. Run starts with dt_status."
                  enabled={workerActive && workerMatchesTemplate}
                  onClick={() => workerActive && workerMatchesTemplate && navigate(routes.view.agents(WORKER_SLUG))}
                />
                <OperationRow
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Pending tickets + positions"
                  detail="Read through the signed DiscoTrader source."
                  enabled={sourceState === 'ready'}
                  onClick={() => navigate(routes.view.sourcesMcp(SOURCE_SLUG))}
                />
                <OperationRow
                  icon={<CircleOff className="h-4 w-4" />}
                  title="Halt / flatten"
                  detail="Deliberate Trade Desk tools; never automatic from this dashboard."
                  enabled={workerActive && workerMatchesTemplate && sourceState === 'ready'}
                  onClick={() => workerActive && workerMatchesTemplate && navigate(routes.view.agents(WORKER_SLUG))}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  tone: 'positive' | 'warning' | 'danger' | 'muted'
}) {
  const toneClass = {
    positive: 'text-[#7de2b0]',
    warning: 'text-amber-200',
    danger: 'text-[#ff9b9b]',
    muted: 'text-[#b7bec8]',
  }[tone]
  return (
    <div className="rounded-lg border border-[#252b33] bg-[#11161b] p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#66707d]">
        {icon} {label}
      </div>
      <div className={`mt-3 text-sm font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-[#66707d]">{detail}</div>
    </div>
  )
}

function SetupStep({
  number,
  title,
  description,
  state,
  children,
}: {
  number: string
  title: string
  description: string
  state: 'complete' | 'pending' | 'error'
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-t border-[#232930] py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${
        state === 'complete'
          ? 'border-[#0ecb81]/30 bg-[#0ecb81]/10 text-[#7de2b0]'
          : state === 'error'
            ? 'border-red-400/30 bg-red-400/10 text-[#ff9b9b]'
            : 'border-[#343b45] bg-[#171c22] text-[#8a94a1]'
      }`}>
        {state === 'complete' ? <CheckCircle2 className="h-3.5 w-3.5" /> : number}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white">{title}</div>
        <p className="mb-3 mt-1 text-[11px] leading-5 text-[#747e8b]">{description}</p>
        {children}
      </div>
    </div>
  )
}

function FlowRow({ label, detail, last = false }: { label: string; detail: string; last?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md border border-[#262d35] bg-[#0b0f13] px-3 py-2.5">
        <span className="text-[11px] font-medium text-[#d5dae0]">{label}</span>
        <span className="truncate text-[10px] text-[#66707d]">{detail}</span>
      </div>
      {!last && <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-[#4f5864] xl:block" />}
    </div>
  )
}

function OperationRow({
  icon,
  title,
  detail,
  enabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      className="flex items-center gap-3 rounded-md border border-[#262d35] bg-[#0b0f13] p-3 text-left transition-colors hover:border-[#3a434e] hover:bg-[#11171d] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-amber-200">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-[#d5dae0]">{title}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-[#66707d]">{detail}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-[#4f5864]" />
    </button>
  )
}
