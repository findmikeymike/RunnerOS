import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  KeyRound,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'

import type { OptionsEntryPolicy, OptionsProvider } from '@trade-god/contracts'
import { openTradingConnections } from './trading-connections-navigation'
import TradeGodPageHeader from './TradeGodPageHeader'

type ConnectionStatus = Awaited<ReturnType<typeof window.electronAPI.listOptionsConnections>>[number]
type AutomationSource = Awaited<ReturnType<typeof window.electronAPI.listOptionsAutomationSources>>[number]
type DiscordSource = Awaited<ReturnType<typeof window.electronAPI.listDiscordSources>>[number]

export const discordChannelUrl = (route: { guild_id: string; channel_id: string; thread_id?: string | null }): string =>
  `https://discord.com/channels/${route.guild_id}/${route.channel_id}${route.thread_id ? `/${route.thread_id}` : ''}`

export const canRunGuidedOptionsTest = (_provider: OptionsProvider): boolean => true

const providerCopy: Record<OptionsProvider, {
  name: string
  accountPlaceholder: string
  credentialHelp: string
}> = {
  ibkr: {
    name: 'Interactive Brokers',
    accountPlaceholder: 'DU1234567',
    credentialHelp: 'Paste the OAuth access token created for your IBKR paper account.',
  },
  webull: {
    name: 'Webull',
    accountPlaceholder: 'Sandbox account ID',
    credentialHelp: 'Use the App Key and App Secret from Webull OpenAPI Management. A 2FA token is optional in sandbox.',
  },
}

interface OptionsControlCenterPageProps {
  mode?: 'desk' | 'connections'
  showSources?: boolean
}

const OptionsControlCenterPage: React.FC<OptionsControlCenterPageProps> = ({ mode = 'desk', showSources = true }) => {
  const [connections, setConnections] = useState<ConnectionStatus[]>([])
  const [sources, setSources] = useState<AutomationSource[]>([])
  const [discordSources, setDiscordSources] = useState<DiscordSource[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogProvider, setDialogProvider] = useState<OptionsProvider | null>(null)
  const [editingConnection, setEditingConnection] = useState<ConnectionStatus | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({})
  const [authorityConnection, setAuthorityConnection] = useState<ConnectionStatus | null>(null)
  const [certificationConnection, setCertificationConnection] = useState<ConnectionStatus | null>(null)
  const [orderConnection, setOrderConnection] = useState<ConnectionStatus | null>(null)
  const [closePosition, setClosePosition] = useState<{ status: ConnectionStatus; intentId: string } | null>(null)
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<AutomationSource | null>(null)
  const [activationSource, setActivationSource] = useState<AutomationSource | null>(null)
  const [brokerMenuOpen, setBrokerMenuOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextConnections, nextSources, nextDiscordSources] = await Promise.all([
        window.electronAPI.listOptionsConnections(),
        window.electronAPI.listOptionsAutomationSources(),
        window.electronAPI.listDiscordSources(),
      ])
      setConnections(nextConnections)
      setSources(nextSources)
      setDiscordSources(nextDiscordSources)
      setError(null)
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const verified = connections.filter((item) => item.provider_read_fresh).length
  const certified = connections.filter((item) => item.certification.state === 'applied').length
  const passed = connections.filter((item) => item.certification.state === 'passed').length
  const activeSources = sources.filter((source) => source.route.state !== 'archived')
  const nextStep = connections.length === 0
    ? 'Connect an options broker'
    : verified === 0
      ? 'Verify your saved account'
      : passed > 0
          ? 'Paper test complete'
          : certified === 0
          ? 'Run the one guided paper test'
          : 'Turn on your Discord source'

  const verify = async (connectionId: string) => {
    setBusyId(connectionId)
    setError(null)
    setConnectionErrors((current) => ({ ...current, [connectionId]: '' }))
    try {
      await window.electronAPI.verifyOptionsConnection(connectionId)
      await load()
    } catch (cause) {
      const message = readableError(cause)
      setError(message)
      setConnectionErrors((current) => ({ ...current, [connectionId]: message }))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (connectionId: string) => {
    if (!window.confirm('Remove this options account from Trade God? Your broker account is not affected.')) return
    setBusyId(connectionId)
    try {
      await window.electronAPI.removeOptionsConnection(connectionId)
      await load()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusyId(null)
    }
  }

  const revokeAuthority = async (connectionId: string) => {
    if (!window.confirm('Lock manual paper orders for this account now?')) return
    setBusyId(connectionId)
    try {
      await window.electronAPI.revokeOptionsManualAuthority(connectionId)
      await load()
    } catch (cause) { setError(readableError(cause)) } finally { setBusyId(null) }
  }

  const applyCertification = async (status: ConnectionStatus) => {
    if (!status.certification.certification_id) return
    if (!window.confirm(`Apply this passed paper safety test to ${status.connection.account_label}? This does not place orders or enable Discord automation.`)) return
    setBusyId(status.connection.connection_id)
    setError(null)
    try {
      await window.electronAPI.applyOptionsCertification(status.connection.connection_id, status.certification.certification_id, true)
      await load()
    } catch (cause) { setError(readableError(cause)) } finally { setBusyId(null) }
  }

  const cancelEntry = async (status: ConnectionStatus, intentId: string) => {
    if (!window.confirm(`Cancel this working paper order in ${status.connection.account_label}? Any exact partial fill remains safely tracked.`)) return
    setBusyId(status.connection.connection_id); setError(null)
    try {
      await window.electronAPI.cancelOptionsWorkingEntry(status.connection.connection_id, intentId, true)
      await load()
    } catch (cause) { setError(readableError(cause)) } finally { setBusyId(null) }
  }

  return (
    <div className={mode === 'desk' ? 'trade-god-page-surface h-full overflow-y-auto text-[#edf0f3]' : 'text-foreground'}>
      <div className={mode === 'desk' ? 'tg-page-container' : 'w-full py-6'}>
        {mode === 'desk' && <TradeGodPageHeader
          eyebrow="Options automation"
          icon={<CircleDollarSign className="size-3.5" />}
          title="Options Desk"
          description="Your connected accounts, Discord traders, paper positions, and next safe action."
          actions={<>
            <button type="button" onClick={() => openTradingConnections('options')} className="tg-control-secondary">
              <Link2 className="size-3.5" /> Manage connections
            </button>
            <div className="tg-header-status">
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Paper only · locked by default
            </div>
          </>}
        />}

        {mode === 'connections' && (
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">Options brokers</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Add your Options broker here. Start with paper while you test the system, then move to a small live account when live execution is supported and certified.</p>
            </div>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-medium text-blue-800">Start with paper</span>
          </div>
        )}

        {error && (
          <div className={`mt-5 flex items-start justify-between gap-4 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 py-3 text-sm ${mode === 'connections' ? 'text-rose-800' : 'text-rose-100'}`}>
            <span>{error}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className={`mt-6 flex flex-wrap items-center gap-2 border-y py-3.5 ${mode === 'connections' ? 'border-foreground/[0.08]' : 'border-white/[0.07]'}`}>
          <StatusPill label="Accounts" value={String(connections.length)} light={mode === 'connections'} />
          <StatusPill label="Verified" value={String(verified)} positive={verified > 0} light={mode === 'connections'} />
          {showSources && <StatusPill label="Discord" value={String(activeSources.length)} light={mode === 'connections'} />}
          <div className="ml-auto flex items-center gap-2 text-xs"><span className={mode === 'connections' ? 'text-muted-foreground' : 'text-[#707b87]'}>Next</span><span className={mode === 'connections' ? 'font-semibold text-foreground' : 'font-semibold text-white'}>{nextStep}</span></div>
        </section>

        <section className="py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Broker accounts</h2>
              <p className={mode === 'connections' ? 'mt-1 text-xs leading-5 text-muted-foreground' : 'mt-1 text-xs leading-5 text-[#7f8996]'}>Your options accounts and the one action needed next.</p>
            </div>
            {mode === 'connections' && <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBrokerMenuOpen(false) }}>
              <button type="button" onClick={() => setBrokerMenuOpen((open) => !open)} aria-expanded={brokerMenuOpen} className="tg-control-primary"><Plus className="h-3.5 w-3.5 shrink-0" /> Connect broker <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${brokerMenuOpen ? 'rotate-180' : ''}`} /></button>
              {brokerMenuOpen && <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-background p-1.5 text-foreground shadow-modal-small">
                {(['ibkr', 'webull'] as OptionsProvider[]).map((provider) => <button key={provider} type="button" onClick={() => { setBrokerMenuOpen(false); setDialogProvider(provider) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Link2 className="h-3.5 w-3.5" /></span><span><span className="block text-xs font-semibold">{providerCopy[provider].name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Paper/sandbox available now</span></span></button>)}
              </div>}
            </div>}
          </div>

          <div className="mt-4">
          {loading ? (
            <div className={mode === 'connections' ? 'flex min-h-32 items-center justify-center text-sm text-muted-foreground' : 'flex min-h-32 items-center justify-center text-sm text-[#77818e]'}><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading accounts</div>
          ) : connections.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-foreground/[0.14] px-6 text-center">
              <Link2 className="h-5 w-5 text-blue-700" /><h3 className="mt-3 text-sm font-medium">Connect your first options broker</h3>
              <p className="mt-1 text-xs text-muted-foreground">Paper is recommended for the first test. Trading stays off while Trade God checks the account.</p>
            </div>
          ) : (
            <div className="grid gap-3">{connections.map((status) => (
              <AccountCard key={status.connection.connection_id} status={status} busy={busyId === status.connection.connection_id} error={connectionErrors[status.connection.connection_id]} setupMode={mode === 'connections'} light={mode === 'connections'}
                onEdit={() => setEditingConnection(status)} onVerify={() => void verify(status.connection.connection_id)} onRemove={() => void remove(status.connection.connection_id)}
                onActivate={() => setAuthorityConnection(status)} onApply={() => void applyCertification(status)} onStartCertification={() => setCertificationConnection(status)}
                onRevoke={() => void revokeAuthority(status.connection.connection_id)} onOrder={() => setOrderConnection(status)}
                onCancelEntry={(intentId) => void cancelEntry(status, intentId)} onClosePosition={(intentId) => setClosePosition({ status, intentId })} />
            ))}</div>
          )}
          </div>
        </section>

        {showSources && <details open className="group border-t border-white/[0.07] py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <div><h2 className="text-sm font-semibold">Discord routing <span className="ml-1 text-[#6f7a86]">{activeSources.length}</span></h2><p className="mt-1 text-xs text-[#727d89]">Choose a saved Discord, its Options account, and its exact spending rules.</p></div>
            <div className="flex items-center gap-3"><button type="button" onClick={(event) => { event.preventDefault(); setSourceDialogOpen(true) }} disabled={connections.length === 0 || discordSources.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-medium hover:bg-white/[0.05] disabled:opacity-35"><Plus className="h-3.5 w-3.5" /> Add route</button><ChevronDown className="h-4 w-4 text-[#75808c] transition-transform group-open:rotate-180" /></div>
          </summary>
          <div className="mt-4">
          {activeSources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.1] px-5 py-8 text-center text-xs text-[#737e8b]">{discordSources.length ? 'No Discords routed to Options yet.' : 'Add a Discord in Connections first.'}</div>
          ) : <div className="grid gap-2">
              {activeSources.map((source) => {
                const account = connections.find((item) => item.connection.connection_id === source.route.connection_id)
                const custody = source.expiration_assessments?.[0]
                return (
                  <div key={source.route.route_id} className="rounded-xl border border-white/[0.07] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-400/[0.09] text-violet-200"><Radio className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{source.route.display_name}</div>
                        <a href={discordChannelUrl(source.route)} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-violet-200/80 hover:text-violet-100">Discord channel · {source.route.channel_id}</a>
                        <div className="mt-1 text-[11px] text-[#75808d]">Trader {source.route.author_id}</div>
                        <div className="mt-1 text-[11px] text-[#8d98a5]">Routes to {account?.connection.account_label ?? 'Missing account'} · {sizingSummary(source.policy)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] ${source.automatic_authority_active ? 'bg-emerald-400/[0.09] text-emerald-200' : 'bg-amber-300/[0.08] text-amber-100'}`}>{source.automatic_authority_active ? 'Running' : 'Setup saved · automation off'}</span>
                      {source.automatic_authority_active ? (
                        <button type="button" onClick={async () => { if (window.confirm(`Pause automatic paper trading for ${source.route.display_name}?`)) { await window.electronAPI.revokeOptionsAutopilot(source.route.route_id); await load() } }} className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-[11px] text-[#c7ced6] hover:bg-white/[0.05]">Pause</button>
                      ) : (
                        <button type="button" disabled={!source.activation_ready} onClick={() => setActivationSource(source)} className="rounded-lg bg-violet-200 px-3 py-1.5 text-[11px] font-semibold text-black disabled:cursor-not-allowed disabled:bg-white/[0.05] disabled:text-[#68727e]">{source.activation_ready ? 'Review & start' : 'Safety test needed'}</button>
                      )}
                      <button type="button" onClick={() => setEditingSource(source)} className="rounded-lg p-2 text-[#8a95a2] hover:bg-white/[0.05] hover:text-white" aria-label={`Edit ${source.route.display_name}`}><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={async () => { if (window.confirm(`Remove ${source.route.display_name} from options monitoring?`)) { await window.electronAPI.archiveOptionsAutomationSource(source.route.route_id); await load() } }} className="rounded-lg p-2 text-[#68727e] hover:bg-rose-400/[0.08] hover:text-rose-300" aria-label={`Remove ${source.route.display_name}`}><Trash2 className="h-4 w-4" /></button>
                    </div></div>
                    {!source.automatic_authority_active && source.activation_issue && (
                      <div className="mt-2 text-[11px] text-[#75808d]">{source.activation_issue}</div>
                    )}
                    {custody && custody.state !== 'monitoring' && custody.state !== 'resolved-flat' && (
                      <div className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${custody.state === 'custody-halted' ? 'bg-rose-400/[0.08] text-rose-100' : 'bg-amber-300/[0.07] text-amber-100'}`}>
                        <span className="font-semibold">Expiration action: </span>{custody.detail}
                      </div>
                    )}
                    {!custody && source.custody_issue && (
                      <div className="mt-3 rounded-lg bg-amber-300/[0.07] px-3 py-2 text-xs leading-5 text-amber-100">
                        <span className="font-semibold">Expiration protection needs setup: </span>{source.custody_issue.replace(/^Expiration custody is safely blocked:\s*/, '')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>}
          </div>
        </details>}

        <details className={`group border-t py-5 text-xs ${mode === 'connections' ? 'border-foreground/[0.08] text-muted-foreground' : 'border-white/[0.07] text-[#747f8b]'}`}>
          <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden"><span>How Trade God keeps this safe</span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
          <p className="mt-3 max-w-3xl leading-5">Secrets stay encrypted on this Mac. Accounts must exactly match the broker. Paper/sandbox is the supported test path today; live enrollment stays locked until its provider path is implemented and certified.</p>
        </details>
      </div>

      {dialogProvider && (
        <ConnectAccountDialog
          provider={dialogProvider}
          onClose={() => setDialogProvider(null)}
          onSaved={async () => { setDialogProvider(null); await load() }}
        />
      )}
      {editingConnection && (
        <ConnectAccountDialog
          provider={editingConnection.connection.provider}
          existing={editingConnection}
          onClose={() => setEditingConnection(null)}
          onSaved={async () => { setEditingConnection(null); await load() }}
        />
      )}
      {authorityConnection && (
        <ManualPaperDialog
          status={authorityConnection}
          onClose={() => setAuthorityConnection(null)}
          onActivated={async () => { setAuthorityConnection(null); await load() }}
        />
      )}
      {certificationConnection && (
        <CertificationDialog
          status={certificationConnection}
          onClose={() => setCertificationConnection(null)}
          onCompleted={async () => { setCertificationConnection(null); await load() }}
        />
      )}
      {orderConnection && (
        <ManualOrderDialog
          status={orderConnection}
          onClose={() => setOrderConnection(null)}
          onCompleted={async () => { setOrderConnection(null); await load() }}
        />
      )}
      {closePosition && (
        <ClosePositionDialog
          status={closePosition.status}
          intentId={closePosition.intentId}
          onClose={() => setClosePosition(null)}
          onCompleted={async () => { setClosePosition(null); await load() }}
        />
      )}
      {showSources && sourceDialogOpen && (
        <DiscordSourceDialog discordSources={discordSources} connections={connections} onClose={() => setSourceDialogOpen(false)} onSaved={async () => { setSourceDialogOpen(false); await load() }} />
      )}
      {showSources && editingSource && (
        <DiscordSourceDialog existing={editingSource} discordSources={discordSources} connections={connections} onClose={() => setEditingSource(null)} onSaved={async () => { setEditingSource(null); await load() }} />
      )}
      {activationSource && (
        <AutopilotActivationDialog source={activationSource} account={connections.find((item) => item.connection.connection_id === activationSource.route.connection_id)}
          onClose={() => setActivationSource(null)} onActivated={async () => { setActivationSource(null); await load() }} />
      )}
    </div>
  )
}

const AutopilotActivationDialog: React.FC<{
  source: AutomationSource
  account?: ConnectionStatus
  onClose(): void
  onActivated(): Promise<void>
}> = ({ source, account, onClose, onActivated }) => {
  type Review = Awaited<ReturnType<typeof window.electronAPI.prepareOptionsAutopilotActivation>>
  const [review, setReview] = useState<Review | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const certificationExpiry = source.activation_expires_at ? Date.parse(source.activation_expires_at) : Number.NaN
  const validUntil = new Date(Math.min(Date.now() + 8 * 60 * 60_000,
    Number.isFinite(certificationExpiry) ? certificationExpiry : Date.now() + 8 * 60 * 60_000)).toISOString()
  const prepare = async () => {
    setBusy(true); setError(null)
    try { setReview(await window.electronAPI.prepareOptionsAutopilotActivation(source.route.route_id, validUntil)) }
    catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  const commit = async () => {
    if (!review || !confirmed) return
    setBusy(true); setError(null)
    try {
      await window.electronAPI.commitOptionsAutopilotActivation(review.review_id, review.content_checksum, true)
      await onActivated()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label="Start automatic paper trading">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Automatic paper trading</div><h2 className="mt-1 text-lg font-semibold">Review before starting</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-4">
          <div className="text-sm font-medium text-white">{source.route.display_name} → {account?.connection.account_label ?? source.route.account_id}</div>
          <div className="mt-2 grid grid-cols-2 gap-3"><SmallFact label="Target spend" value={sizingSummary(source.policy)} /><SmallFact label="Safety cap" value={`${source.policy.max_contracts_per_order} contracts`} /><SmallFact label="Spread limit" value={`$${source.policy.max_spread_abs} and ${source.policy.max_spread_pct}%`} /><SmallFact label="Price chase limit" value={`$${source.policy.max_chase_abs} and ${source.policy.max_chase_pct}%`} /></div>
        </div>
        <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-5 text-[#d1c8ae]">Trade God can buy only single calls or puts in this paper account. It skips late, stale, wide-spread, overpriced, ambiguous, or uncertified signals. Working orders time out automatically.</div>
        {!review ? (
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><button type="button" onClick={() => void prepare()} disabled={busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Checking safety evidence…' : 'Check and continue'}</button></div>
        ) : (
          <><label className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-3 text-xs leading-5 text-emerald-100"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />Start this exact Discord source on this exact paper account until {new Date(validUntil).toLocaleString()}. I can pause it at any time.</label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><button type="button" onClick={() => void commit()} disabled={!confirmed || busy} className="rounded-lg bg-violet-200 px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Starting…' : 'Start paper automation'}</button></div></>
        )}
        {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
      </div>
    </div>
  )
}

const DiscordSourceDialog: React.FC<{
  connections: ConnectionStatus[]
  discordSources: DiscordSource[]
  existing?: AutomationSource
  onClose(): void
  onSaved(): Promise<void>
}> = ({ connections, discordSources, existing, onClose, onSaved }) => {
  const sizing = existing?.policy.sizing.mode === 'debit_range' ? existing.policy.sizing : undefined
  const matchedSource = discordSources.find((source) => source.guild_id === existing?.route.guild_id && source.channel_id === existing.route.channel_id && source.thread_id === existing.route.thread_id && source.author_id === existing.route.author_id)
  const [sourceId, setSourceId] = useState(matchedSource?.source_id ?? discordSources[0]?.source_id ?? '')
  const [connectionId, setConnectionId] = useState(existing?.route.connection_id ?? connections[0]?.connection.connection_id ?? '')
  const [minDebit, setMinDebit] = useState(sizing?.min_debit_budget ?? '300')
  const [maxDebit, setMaxDebit] = useState(sizing?.max_debit_budget ?? existing?.policy.max_debit_per_trade ?? '400')
  const [contracts, setContracts] = useState(String(existing?.policy.max_contracts_per_order ?? 20))
  const [spreadAbs, setSpreadAbs] = useState(existing?.policy.max_spread_abs ?? '0.10')
  const [spreadPct, setSpreadPct] = useState(existing?.policy.max_spread_pct ?? '10')
  const [chaseAbs, setChaseAbs] = useState(existing?.policy.max_chase_abs ?? '0.10')
  const [chasePct, setChasePct] = useState(existing?.policy.max_chase_pct ?? '8')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = sourceId && connectionId
    && Number.isInteger(Number(contracts)) && Number(contracts) > 0
    && Number(minDebit) > 0 && Number(maxDebit) >= Number(minDebit)
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!canSave) return
    setBusy(true); setError(null)
    try {
      const source = discordSources.find((candidate) => candidate.source_id === sourceId)
      if (!source) throw new Error('Choose a saved Discord.')
      await window.electronAPI.saveOptionsAutomationSource({
        ...(existing ? { route_id: existing.route.route_id } : {}),
        display_name: source.display_name,
        channel_url: `https://discord.com/channels/${source.guild_id}/${source.channel_id}${source.thread_id ? `/${source.thread_id}` : ''}`,
        author_id: source.author_id, thread_id: source.thread_id, connection_id: connectionId,
        max_spread_abs: spreadAbs.trim(), max_spread_pct: spreadPct.trim(), max_chase_abs: chaseAbs.trim(), max_chase_pct: chasePct.trim(),
        min_debit_per_trade: minDebit.trim(), max_contracts_per_order: Number(contracts), max_debit_per_trade: maxDebit.trim(),
      })
      await onSaved()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label={existing ? 'Edit Options route' : 'Add Options route'}>
      <form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Options routing</div><h2 className="mt-1 text-xl font-semibold">{existing ? 'Edit account route' : 'Route a Discord'}</h2><p className="mt-2 text-xs leading-5 text-[#8993a0]">Choose one saved Discord, one paper account, and its spending rules.</p></div><button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button></div>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-xs text-[#aab2bc]">Discord<select value={sourceId} disabled={Boolean(existing)} onChange={(event) => setSourceId(event.target.value)} className="rounded-lg border border-white/[0.1] bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/40 disabled:opacity-55">{discordSources.map((source) => <option key={source.source_id} value={source.source_id}>{source.display_name}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs text-[#aab2bc]">Paper account<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="rounded-lg border border-white/[0.1] bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/40">{connections.map((item) => <option key={item.connection.connection_id} value={item.connection.connection_id}>{item.connection.account_label}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><Field label="Spend at least" value={minDebit} onChange={setMinDebit} placeholder="300" /><Field label="Spend no more than" value={maxDebit} onChange={setMaxDebit} placeholder="400" /></div>
          <p className="-mt-2 text-xs leading-5 text-[#75808d]">Trade God chooses the largest whole-contract quantity inside this range using the live order price and estimated fees. If none fits, it skips.</p>
        </div>
        <button type="button" onClick={() => setAdvanced((value) => !value)} className="mt-5 flex w-full items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-[#9ba4af] hover:bg-white/[0.045]">Price protection <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? 'rotate-180' : ''}`} /></button>
        {advanced && <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-black/20 p-3"><Field label="Hard contract cap" value={contracts} onChange={setContracts} placeholder="20" /><div /><Field label="Max spread ($)" value={spreadAbs} onChange={setSpreadAbs} placeholder="0.10" /><Field label="Max spread (%)" value={spreadPct} onChange={setSpreadPct} placeholder="10" /><Field label="Max chase ($)" value={chaseAbs} onChange={setChaseAbs} placeholder="0.10" /><Field label="Max chase (%)" value={chasePct} onChange={setChasePct} placeholder="8" /></div>}
        <p className="mt-4 rounded-lg bg-violet-400/[0.06] px-3 py-3 text-xs leading-5 text-violet-100/80">Trade God will skip old, wide, ambiguous, same-day, or over-budget signals. It never falls back to another account.</p>
        {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-100">{error}</p>}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-[#9ba4af] hover:bg-white/[0.05]">Cancel</button><button type="submit" disabled={!canSave || busy} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />} Save route</button></div>
      </form>
    </div>
  )
}

const ConnectAccountDialog: React.FC<{
  provider: OptionsProvider
  existing?: ConnectionStatus
  onClose(): void
  onSaved(): Promise<void>
}> = ({ provider, existing, onClose, onSaved }) => {
  const copy = providerCopy[provider]
  const [accountRef, setAccountRef] = useState(existing?.connection.account_ref ?? '')
  const [label, setLabel] = useState(existing?.connection.account_label ?? (provider === 'ibkr' ? 'IBKR Paper' : 'Webull Sandbox'))
  const [accessToken, setAccessToken] = useState('')
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const newCredentialReady = provider === 'ibkr' ? accessToken.trim() : appKey.trim() && appSecret.trim()
  const canSave = accountRef.trim() && label.trim() && (existing ? true : newCredentialReady)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.saveOptionsConnection({
        ...(existing ? { connection_id: existing.connection.connection_id } : {}),
        ...(existing && accountRef.trim() !== existing.connection.account_ref ? { allow_account_ref_change: true as const } : {}),
        provider,
        account_ref: accountRef.trim(),
        account_label: label.trim(),
        credential: existing && !accessToken.trim() && !appKey.trim() && !appSecret.trim()
          ? ''
          : JSON.stringify(provider === 'ibkr'
            ? { access_token: accessToken.trim() }
            : { app_key: appKey.trim(), app_secret: appSecret.trim(), ...(accessToken.trim() ? { access_token: accessToken.trim() } : {}) }),
      })
      await onSaved()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label={`Connect ${copy.name}`}>
      <form onSubmit={save} className="w-full max-w-lg rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Paper setup</div>
            <h2 className="mt-1 text-xl font-semibold">{existing ? `Edit ${copy.name}` : `Connect ${copy.name}`}</h2>
            <p className="mt-2 text-xs leading-5 text-[#8993a0]">{existing ? 'Correct the Account ID or nickname. Leave credentials blank to keep the saved ones.' : 'This connection starts read-only. Trade God cannot place an order.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[#75808d] hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-6 grid gap-4">
          <Field label="Account ID" value={accountRef} onChange={setAccountRef} placeholder={copy.accountPlaceholder} />
          <Field label="Nickname" value={label} onChange={setLabel} placeholder="My paper account" />
          {provider === 'ibkr' ? (
            <Field label={existing ? 'Replace OAuth token (optional)' : 'OAuth access token'} value={accessToken} onChange={setAccessToken} placeholder={existing ? 'Leave blank to keep saved token' : 'Paste token'} secret optional={Boolean(existing)} />
          ) : (
            <>
              <Field label={existing ? 'Replace App Key (optional)' : 'App Key'} value={appKey} onChange={setAppKey} placeholder={existing ? 'Leave blank to keep saved key' : 'Paste App Key'} optional={Boolean(existing)} />
              <Field label={existing ? 'Replace App Secret (optional)' : 'App Secret'} value={appSecret} onChange={setAppSecret} placeholder={existing ? 'Leave blank to keep saved secret' : 'Paste App Secret'} secret optional={Boolean(existing)} />
              <Field label="2FA access token (if enabled)" value={accessToken} onChange={setAccessToken} placeholder="Optional in sandbox" secret optional />
            </>
          )}
        </div>

        <button type="button" onClick={() => setShowDetails((value) => !value)} className="mt-5 flex w-full items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-[#9ba4af] hover:bg-white/[0.045]">
          Where do I find this?
          <ChevronDown className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        </button>
        {showDetails && <p className="mt-2 rounded-lg bg-black/20 px-3 py-3 text-xs leading-5 text-[#7f8996]">{copy.credentialHelp} Only the official paper/sandbox endpoint is accepted.</p>}

        {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-100">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-[#9ba4af] hover:bg-white/[0.05] hover:text-white">Cancel</button>
          <button type="submit" disabled={!canSave || saving} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-[#e7e9ec] disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            {existing ? 'Save changes' : 'Save securely'}
          </button>
        </div>
      </form>
    </div>
  )
}

const AccountCard: React.FC<{
  status: ConnectionStatus
  busy: boolean
  error?: string
  setupMode: boolean
  light: boolean
  onEdit(): void
  onVerify(): void
  onRemove(): void
  onActivate(): void
  onApply(): void
  onStartCertification(): void
  onRevoke(): void
  onOrder(): void
  onCancelEntry(intentId: string): void
  onClosePosition(intentId: string): void
}> = ({ status, busy, error, setupMode, light, onEdit, onVerify, onRemove, onActivate, onApply, onStartCertification, onRevoke, onOrder, onCancelEntry, onClosePosition }) => {
  const { connection, provider_read_proof: proof } = status
  const connected = status.provider_read_fresh
  const provider = providerCopy[connection.provider]
  const primaryActionClass = light
    ? 'h-9 rounded-xl bg-foreground px-3.5 text-[11px] font-semibold text-background transition hover:opacity-85 disabled:bg-secondary disabled:text-muted-foreground'
    : 'h-9 rounded-xl border border-violet-300/20 bg-violet-300/[0.1] px-3.5 text-[11px] font-semibold text-violet-100 transition-colors hover:bg-violet-300/[0.16] disabled:opacity-40'
  return (
    <article className={`rounded-xl border p-4 ${light ? 'border-border bg-background-elevated' : 'border-white/[0.08] bg-white/[0.018]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? light ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-400/[0.1] text-emerald-300' : light ? 'bg-secondary text-muted-foreground' : 'bg-white/[0.05] text-[#8c96a3]'}`}>
            {connected ? <CheckCircle2 className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{connection.account_label}</h3>
              <span className={light ? 'rounded-full border border-border bg-background px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground' : 'rounded-full border border-white/[0.08] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#87919d]'}>{connection.environment}</span>
            </div>
            <p className={light ? 'mt-1 text-xs text-muted-foreground' : 'mt-1 text-xs text-[#737e8b]'}>{provider.name} · {connection.account_ref} · <span className={connected ? light ? 'text-emerald-700' : 'text-emerald-300' : light ? 'text-amber-700' : 'text-amber-200'}>{connected ? 'Verified' : 'Needs verification'}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.manual_authority ? (
            <>
              <button type="button" onClick={onOrder} disabled={busy || !connected} className={primaryActionClass}>Create paper order</button>
              <button type="button" onClick={onRevoke} disabled={busy} className={light ? 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-40' : 'rounded-lg border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-xs text-rose-100 hover:bg-rose-300/[0.1] disabled:opacity-40'}>Lock</button>
            </>
          ) : status.certification.state === 'applied' ? (
            <button type="button" onClick={onActivate} disabled={busy || !connected} title={!connected ? 'Verify this account again first' : undefined} className={primaryActionClass}>Grant manual access</button>
          ) : status.certification.state === 'passed' ? (
            <button type="button" onClick={onApply} disabled={busy || !connected} title={!connected ? 'Verify this account again first' : undefined} className={light ? 'h-9 rounded-xl bg-emerald-700 px-3.5 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-40' : 'h-9 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.1] px-3.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/[0.16] disabled:opacity-40'}>Apply safety test</button>
          ) : !connected ? (
            <button type="button" onClick={onVerify} disabled={busy} className={light ? 'tg-control-secondary' : 'inline-flex h-9 items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-300/[0.1] px-3.5 text-[11px] font-semibold text-violet-100 shadow-minimal transition-colors hover:border-violet-300/30 hover:bg-violet-300/[0.16] disabled:opacity-40'}>{busy ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 shrink-0" />} Verify account</button>
          ) : (
            <button
              type="button"
              onClick={onStartCertification}
              disabled={busy}
              title="Run one paper-only broker test"
              className={primaryActionClass}
            >
              Run paper test
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-3 text-xs leading-5 text-rose-100">
          <div className="font-semibold">Could not verify this account</div>
          <div className="mt-1 text-rose-100/80">{error}</div>
        </div>
      )}
      <details className={`group mt-3 border-t pt-3 ${light ? 'border-border' : 'border-white/[0.06]'}`}>
        <summary className={`flex cursor-pointer list-none items-center justify-between text-[11px] [&::-webkit-details-marker]:hidden ${light ? 'text-muted-foreground' : 'text-[#7f8996]'}`}><span>Account details & controls</span><ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /></summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {setupMode && <button type="button" onClick={onEdit} disabled={busy} className={light ? 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs hover:bg-secondary disabled:opacity-40' : 'inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-xs hover:bg-white/[0.05] disabled:opacity-40'}><Pencil className="h-3.5 w-3.5" /> Edit</button>}
          <button type="button" onClick={onVerify} disabled={busy} className={light ? 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs hover:bg-secondary disabled:opacity-40' : 'inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-xs hover:bg-white/[0.05] disabled:opacity-40'}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{connected ? 'Check again' : 'Verify account'}</button>
          {setupMode && <button type="button" onClick={onRemove} disabled={busy} className={light ? 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-rose-700 hover:bg-rose-50' : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-rose-200/70 hover:bg-rose-400/[0.08] hover:text-rose-200'}><Trash2 className="h-3.5 w-3.5" /> Remove</button>}
        </div>
        {proof && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5"><SmallFact label="Positions" value={String(proof.position_count)} light={light} /><SmallFact label="Open orders" value={String(proof.open_order_count)} light={light} /><SmallFact label="Options data" value={status.certification.state === 'passed' || status.certification.state === 'applied' ? 'Proved in test' : 'Checked'} warn={status.certification.state === 'not-run'} light={light} /><SmallFact label="Safety test" value={status.certification.state === 'applied' ? 'Applied' : status.certification.state === 'passed' ? 'Passed' : status.certification.state === 'blocked' ? 'Needs attention' : 'Not run'} warn={status.certification.state !== 'applied'} light={light} /><SmallFact label="Manual access" value={status.manual_authority ? 'Active' : 'Locked'} light={light} /></div>}
      </details>
      {status.manual_recovery_issue && (
        <div className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${light ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-rose-300/20 bg-rose-300/[0.06] text-rose-100'}`}>
          <div className="font-semibold">Paper orders are safely paused</div>
          <div className={light ? 'mt-1 text-rose-700' : 'mt-1 text-rose-100/75'}>{status.manual_recovery_issue} Check the broker account, then restart Trade God to retry recovery.</div>
        </div>
      )}
      {!status.manual_recovery_issue && (status.pending_manual_reviews ?? 0) > 0 && (
        <div className={`mt-4 rounded-xl border p-3 text-xs ${light ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-amber-300/15 bg-amber-300/[0.05] text-amber-100'}`}>
          An unfinished order review is being held safely. Open the order flow or restart Trade God to clear it after a flat-account check.
        </div>
      )}
      {(status.manual_orders?.length ?? 0) > 0 && (
        <div className={`mt-4 border-t pt-4 ${light ? 'border-border' : 'border-white/[0.07]'}`}>
          <div className={light ? 'text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground' : 'text-[9px] font-semibold uppercase tracking-[0.16em] text-[#697481]'}>Paper orders</div>
          <div className="mt-2 grid gap-2">
            {status.manual_orders!.slice(-3).reverse().map((order) => (
              <div key={order.record_id} className={light ? 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-xs' : 'flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2 text-xs'}>
                <div>
                  <div className={light ? 'text-foreground' : 'text-[#c9cfd6]'}>{order.canonical_contract_id.replace('USOPT:', '').replaceAll(':', ' ')}</div>
                  <div className={light ? 'mt-1 text-[10px] text-muted-foreground' : 'mt-1 text-[10px] text-[#707b87]'}>{plainOrderState(order.state)} · {order.open_quantity} open</div>
                  {order.open_quantity > 0 && <div className={light ? 'mt-1 text-[10px] text-amber-700' : 'mt-1 text-[10px] text-amber-200/80'}>Expires {contractExpiration(order.canonical_contract_id)} · close manually before broker cutoff</div>}
                </div>
                <div className="flex items-center gap-2">
                  {(order.state === 'working' || order.state === 'partially-filled') && (
                    <button type="button" onClick={() => onCancelEntry(order.intent_id)} disabled={busy} className={light ? 'rounded-lg border border-amber-300 px-2.5 py-1.5 text-[10px] text-amber-800 hover:bg-amber-50 disabled:opacity-40' : 'rounded-lg border border-amber-200/20 px-2.5 py-1.5 text-[10px] text-amber-100 hover:bg-amber-200/[0.06] disabled:opacity-40'}>Cancel entry</button>
                  )}
                  {order.open_quantity > 0 && order.state === 'open-position' && !hasActiveManagement(status, order.intent_id) && (
                    <button type="button" onClick={() => onClosePosition(order.intent_id)} disabled={busy} className={light ? 'rounded-lg bg-foreground px-2.5 py-1.5 text-[10px] font-semibold text-background hover:opacity-85 disabled:opacity-40' : 'rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold text-black hover:bg-[#e7e9ec] disabled:opacity-40'}>Close position</button>
                  )}
                  <span className={order.state === 'submit-unknown' || order.state === 'halted' ? light ? 'text-rose-700' : 'text-rose-200' : light ? 'text-emerald-700' : 'text-emerald-200'}>{plainOrderState(order.state)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

const CertificationDialog: React.FC<{ status: ConnectionStatus; onClose(): void; onCompleted(): Promise<void> }> = ({ status, onClose, onCompleted }) => {
  const [underlying, setUnderlying] = useState('SPY')
  const [expiration, setExpiration] = useState(() => {
    const value = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
    return value.toISOString().slice(0, 10)
  })
  const [strike, setStrike] = useState('')
  const [right, setRight] = useState<'call' | 'put'>('call')
  const [maxDebit, setMaxDebit] = useState('150')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (event: React.SyntheticEvent) => {
    event.preventDefault()
    if (!confirmed || !underlying.trim() || !expiration || !strike.trim() || !maxDebit.trim()) return
    setBusy(true); setError(null)
    try {
      await window.electronAPI.startOptionsCertification({
        connection_id: status.connection.connection_id,
        max_test_debit: maxDebit.trim(),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        contract: { underlying: underlying.trim().toUpperCase(), expiration, strike: strike.trim(), right },
        operator_confirmed: true,
      })
      await onCompleted()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label="Run paper safety test">
      <form onSubmit={run} className="w-full max-w-lg rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Guided broker test</div><h2 className="mt-1 text-lg font-semibold">Test one paper option</h2></div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-xs leading-5 text-[#8993a0]">Trade God will place, cancel, buy, and sell one contract in your paper account, then prove the account is flat. Nothing here can use real money.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Field label="Ticker" value={underlying} onChange={setUnderlying} placeholder="SPY" />
          <Field label="Expiration" value={expiration} onChange={setExpiration} placeholder="YYYY-MM-DD" />
          <Field label="Strike" value={strike} onChange={setStrike} placeholder="650" />
          <label className="grid gap-1.5 text-xs font-medium text-[#b7bec7]"><span>Type</span><select value={right} onChange={(event) => setRight(event.target.value as 'call' | 'put')} className="h-10 rounded-lg border border-white/[0.1] bg-[#090c10] px-3 text-sm text-white outline-none"><option value="call">Call</option><option value="put">Put</option></select></label>
        </div>
        <div className="mt-3"><Field label="Maximum test debit" value={maxDebit} onChange={setMaxDebit} placeholder="150" /></div>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-5 text-[#c8c0aa]">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          I understand this runs a real order lifecycle in {status.connection.account_label}, which is a paper/sandbox account only.
        </label>
        {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><PaperTestButton busy={busy} disabled={!confirmed || !underlying.trim() || !expiration || !strike.trim() || !maxDebit.trim()} onRun={(event) => void run(event)} /></div>
      </form>
    </div>
  )
}

export const PaperTestButton: React.FC<{
  busy: boolean
  disabled: boolean
  onRun(event: React.MouseEvent<HTMLButtonElement>): void
}> = ({ busy, disabled, onRun }) => (
  <button type="button" onClick={onRun} disabled={disabled || busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">
    {busy ? 'Running test…' : 'Run paper test'}
  </button>
)

const ManualPaperDialog: React.FC<{ status: ConnectionStatus; onClose(): void; onActivated(): Promise<void> }> = ({ status, onClose, onActivated }) => {
  const [maxDebit, setMaxDebit] = useState('100')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!confirmed || !maxDebit.trim()) return
    setBusy(true); setError(null)
    try {
      const certificationExpiry = status.certification.expires_at
        ? Date.parse(status.certification.expires_at)
        : Number.NaN
      const validUntilMs = Math.min(
        Date.now() + 30 * 60 * 1000,
        Number.isFinite(certificationExpiry) ? certificationExpiry - 1_000 : Number.POSITIVE_INFINITY,
      )
      if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
        throw new Error('The paper safety test has expired. Run it again before enabling manual orders.')
      }
      const validUntil = new Date(validUntilMs).toISOString()
      await window.electronAPI.activateOptionsManualAuthority(status.connection.connection_id, maxDebit.trim(), validUntil, true)
      await onActivated()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label="Enable manual paper testing">
      <form onSubmit={activate} className="w-full max-w-md rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">30-minute permission</div><h2 className="mt-1 text-lg font-semibold">Grant manual paper access</h2></div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-xs leading-5 text-[#8993a0]">This records permission for the exact tested contract on {status.connection.account_label}. Discord automation stays off. An order still needs a separate review and confirmation.</p>
        <div className="mt-5"><Field label="Maximum debit per order" value={maxDebit} onChange={setMaxDebit} placeholder="100" /></div>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-xs leading-5 text-[#aab2bc]">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          I understand every order still requires my confirmation and uses this paper/sandbox account only.
        </label>
        {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><button disabled={!confirmed || busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Granting…' : 'Grant for 30 minutes'}</button></div>
      </form>
    </div>
  )
}

const ManualOrderDialog: React.FC<{ status: ConnectionStatus; onClose(): void; onCompleted(): Promise<void> }> = ({ status, onClose, onCompleted }) => {
  type Review = Awaited<ReturnType<typeof window.electronAPI.prepareOptionsManualOrder>>
  const [maxPremium, setMaxPremium] = useState('')
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [finalConfirmed, setFinalConfirmed] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connectionId = status.connection.connection_id

  const close = async () => {
    if (review) {
      setBusy(true); setError(null)
      try {
        await window.electronAPI.cancelOptionsManualOrder(connectionId, review.review_id)
      } catch (cause) {
        setError(`Trade God could not safely release this review yet. Keep this window open and retry: ${readableError(cause)}`)
        setBusy(false)
        return
      }
    }
    onClose()
  }
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reviewConfirmed || !maxPremium.trim()) return
    setBusy(true); setError(null)
    try {
      setReview(await window.electronAPI.prepareOptionsManualOrder({
        connection_id: connectionId,
        max_premium: maxPremium.trim(),
        operator_confirmed: true,
      }))
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  const commit = async () => {
    if (!review || !finalConfirmed) return
    setBusy(true); setError(null)
    try {
      await window.electronAPI.commitOptionsManualOrder(connectionId, review.review_id, review.content_checksum, true)
      setReview(null)
      await onCompleted()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  const contractLabel = review?.contract
    ? `${review.contract.underlying} ${review.contract.expiration} $${review.contract.strike} ${review.contract.right}`
    : status.manual_authority?.allowed_contract_id.replace('USOPT:', '').replaceAll(':', ' ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label="Create paper option order">
      <form onSubmit={prepare} className="w-full max-w-lg rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Manual paper order</div><h2 className="mt-1 text-lg font-semibold">Buy one tested contract</h2></div>
          <button type="button" onClick={() => void close()} disabled={busy} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#697481]">Contract</div>
          <div className="mt-1 text-sm font-medium text-white">{contractLabel}</div>
          <div className="mt-1 text-xs text-[#7f8996]">{status.connection.account_label} · 1 contract · paper only</div>
        </div>

        {!review ? (
          <>
            <div className="mt-5"><Field label="Most you will pay per share" value={maxPremium} onChange={setMaxPremium} placeholder="Example: 1.35" /></div>
            <p className="mt-2 text-[11px] leading-5 text-[#77818e]">Options are quoted per share. A $1.35 limit is up to $135 plus the broker’s estimated fee.</p>
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-xs leading-5 text-[#aab2bc]">
              <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="mt-1" />
              Check the live paper quote and show me the exact order before anything is sent.
            </label>
            {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => void close()} disabled={busy} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><button disabled={!reviewConfirmed || !maxPremium.trim() || busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Checking live quote…' : 'Review order'}</button></div>
          </>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SmallFact label="Live bid" value={`$${review.quote.bid}`} />
              <SmallFact label="Live ask" value={`$${review.quote.ask}`} />
              <SmallFact label="Your limit" value={`$${review.decision.limit_price}`} />
              <SmallFact label="Maximum debit" value={`$${review.decision.maximum_debit}`} />
            </div>
            <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-3 text-xs leading-5 text-emerald-100">
              Trade God will send one DAY limit order. It will never pay above ${review.decision.limit_price}. This review expires in about 30 seconds.
            </div>
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-5 text-[#c8c0aa]">
              <input type="checkbox" checked={finalConfirmed} onChange={(event) => setFinalConfirmed(event.target.checked)} className="mt-1" />
              Place this exact one-contract order in {status.connection.account_label} now.
            </label>
            {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => void close()} disabled={busy} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><button type="button" onClick={() => void commit()} disabled={!finalConfirmed || busy} className="rounded-lg bg-violet-200 px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Placing paper order…' : 'Place paper order'}</button></div>
          </>
        )}
      </form>
    </div>
  )
}

const ClosePositionDialog: React.FC<{
  status: ConnectionStatus
  intentId: string
  onClose(): void
  onCompleted(): Promise<void>
}> = ({ status, intentId, onClose, onCompleted }) => {
  const order = status.manual_orders?.find((candidate) => candidate.intent_id === intentId)
  const [minimumCredit, setMinimumCredit] = useState('0.01')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!confirmed || !minimumCredit.trim()) return
    setBusy(true); setError(null)
    try {
      await window.electronAPI.closeOptionsPosition(status.connection.connection_id, intentId, minimumCredit.trim(), true)
      await onCompleted()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }} role="dialog" aria-modal="true" aria-label="Close paper option position">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-white/[0.16] bg-[#0a0d11] p-6 shadow-modal-small">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">Risk-reducing action</div><h2 className="mt-1 text-lg font-semibold">Close this paper position</h2></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-4 text-xs">
          <div className="font-medium text-white">{order?.canonical_contract_id.replace('USOPT:', '').replaceAll(':', ' ')}</div>
          <div className="mt-1 text-[#7f8996]">{order?.open_quantity ?? 0} contract · {status.connection.account_label}</div>
        </div>
        <div className="mt-5"><Field label="Minimum price you will accept per share" value={minimumCredit} onChange={setMinimumCredit} placeholder="Example: 1.00" /></div>
        <p className="mt-2 text-[11px] leading-5 text-[#77818e]">Trade God checks a fresh live bid and sends one DAY sell-to-close limit. It cannot sell more than the exact owned quantity.</p>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-5 text-[#c8c0aa]">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          Close the full exact paper position now. A working entry remainder must already be canceled.
        </label>
        {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-xs text-[#9ba4af]">Keep position</button><button disabled={!confirmed || !minimumCredit.trim() || busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Checking live bid…' : 'Close paper position'}</button></div>
      </form>
    </div>
  )
}

const Field: React.FC<{ label: string; value: string; onChange(value: string): void; placeholder: string; secret?: boolean; optional?: boolean }> = ({ label, value, onChange, placeholder, secret, optional }) => (
  <label className="grid gap-1.5 text-xs font-medium text-[#b7bec7]">
    <span>{label}{optional && <span className="ml-1 font-normal text-[#69737f]">optional</span>}</span>
    <input type={secret ? 'password' : 'text'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" className="h-10 rounded-lg border border-white/[0.1] bg-[#090c10] px-3 text-sm text-white outline-none placeholder:text-[#4e5864] focus:border-violet-300/45" />
  </label>
)

const StatusPill: React.FC<{ label: string; value: string; positive?: boolean; light?: boolean }> = ({ label, value, positive, light }) => (
  <div className={light ? 'inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-[11px]' : 'inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-[11px]'}><span className={light ? 'text-muted-foreground' : 'text-[#77828e]'}>{label}</span><span className={positive ? light ? 'font-semibold text-emerald-700' : 'font-semibold text-emerald-300' : light ? 'font-semibold text-foreground' : 'font-semibold text-white'}>{value}</span></div>
)

const SmallFact: React.FC<{ label: string; value: string; warn?: boolean; light?: boolean }> = ({ label, value, warn, light }) => (
  <div>
    <div className={light ? 'text-[9px] uppercase tracking-[0.14em] text-muted-foreground' : 'text-[9px] uppercase tracking-[0.14em] text-[#5e6874]'}>{label}</div>
    <div className={`mt-1 text-xs font-medium ${warn ? light ? 'text-amber-700' : 'text-amber-200' : light ? 'text-foreground' : 'text-[#d9dde2]'}`}>{value}</div>
  </div>
)

const readableError = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').replace(/^Error:\s*/i, '')
}

const sizingSummary = (policy: OptionsEntryPolicy): string => policy.sizing.mode === 'debit_range'
  ? `$${policy.sizing.min_debit_budget}–$${policy.sizing.max_debit_budget} total`
  : policy.sizing.mode === 'fixed_contracts'
    ? `${policy.sizing.fixed_contracts} contract${policy.sizing.fixed_contracts === 1 ? '' : 's'}`
    : `Up to $${policy.sizing.max_debit_budget}`

const plainOrderState = (state: string): string => ({
  working: 'Waiting to fill',
  'partially-filled': 'Partially filled',
  'open-position': 'Position open',
  'canceled-flat': 'Canceled · no position',
  'closed-flat': 'Closed',
  'submit-unknown': 'Broker confirmation needed',
  halted: 'Safely paused',
  prepared: 'Prepared',
  submitting: 'Sending',
  'not-sent': 'Not sent',
}[state] ?? state.replaceAll('-', ' '))

const hasActiveManagement = (status: ConnectionStatus, intentId: string): boolean => (
  (status.management_records ?? []).some((record) => record.entry_intent_id === intentId
    && ['prepared', 'cancel-unknown', 'close-unknown', 'close-working', 'partially-closed', 'halted'].includes(record.state))
)

const contractExpiration = (canonicalId: string): string => {
  const match = /^USOPT:[^:]+:(\d{4}-\d{2}-\d{2}):/.exec(canonicalId)
  if (!match) return 'unknown date'
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${match[1]}T12:00:00.000Z`))
}

export default OptionsControlCenterPage
