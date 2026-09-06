import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Pencil, Plus, Radio, Trash2, X } from 'lucide-react'

type DiscordSource = Awaited<ReturnType<typeof window.electronAPI.listDiscordSources>>[number]
type Connection = Awaited<ReturnType<typeof window.electronAPI.listTradingConnections>>[number]
type SignalRoute = Awaited<ReturnType<typeof window.electronAPI.listTradingSignalRoutes>>[number]

const FuturesRoutingPanel: React.FC = () => {
  const [sources, setSources] = useState<DiscordSource[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [routes, setRoutes] = useState<SignalRoute[]>([])
  const [editing, setEditing] = useState<SignalRoute | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const futuresSources = useMemo(() => sources.filter((source) => source.thread_id === null), [sources])

  const load = useCallback(async () => {
    try {
      const [nextSources, nextConnections, nextRoutes] = await Promise.all([
        window.electronAPI.listDiscordSources(),
        window.electronAPI.listTradingConnections(),
        window.electronAPI.listTradingSignalRoutes(),
      ])
      setSources(nextSources); setConnections(nextConnections); setRoutes(nextRoutes); setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const accountName = useCallback((route: SignalRoute) => {
    if (route.target.type !== 'connection') return 'Multi-account group'
    const connectionId = route.target.connection_id
    return connections.find((item) => item.connection.connection_id === connectionId)?.connection.display_name ?? 'Missing account'
  }, [connections])

  return <section className="rounded-2xl border border-white/[0.08] bg-white/[0.018] p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-sm font-semibold">Discord routing</h2><p className="mt-1 text-xs leading-5 text-[#77818d]">Choose a Discord trader, then the futures account that follows them.</p></div>
      <button type="button" onClick={() => setEditing('new')} disabled={!futuresSources.length || !connections.length} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.045] px-3.5 text-[11px] font-medium text-white/85 hover:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-35"><Plus className="size-3.5 text-cyan-200" /> Add route</button>
    </div>
    {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-100">{error}</p>}
    {!routes.length ? <div className="mt-4 rounded-xl border border-dashed border-white/[0.09] px-5 py-7 text-center text-xs text-[#737e8b]">{!futuresSources.length ? 'Add a Discord channel in Connections first.' : !connections.length ? 'Add a futures account in Connections first.' : 'No Discords routed to futures yet.'}</div> : (
      <div className="mt-4 grid gap-2">
        {routes.map((route) => {
          const source = sources.find((candidate) => sameIdentity(candidate, route))
          return <div key={route.route_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-cyan-300/[0.07] text-cyan-200"><Radio className="size-4" /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{source?.display_name ?? route.display_name}</p><p className="mt-1 truncate text-[11px] text-[#7d8895]">{accountName(route)}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] ${route.enabled ? 'bg-emerald-400/[0.08] text-emerald-200' : 'bg-white/[0.04] text-[#808a96]'}`}>{route.enabled ? 'Listening' : 'Paused'}</span>
            <button type="button" onClick={() => setEditing(route)} aria-label={`Edit ${route.display_name}`} className="rounded-lg p-2 text-[#7d8895] hover:bg-white/[0.05] hover:text-white"><Pencil className="size-3.5" /></button>
            <button type="button" onClick={async () => { if (window.confirm(`Remove ${route.display_name} from Futures?`)) { await window.electronAPI.removeTradingSignalRoute(route.route_id); await load() } }} aria-label={`Remove ${route.display_name}`} className="rounded-lg p-2 text-[#67727e] hover:bg-rose-400/[0.08] hover:text-rose-200"><Trash2 className="size-3.5" /></button>
          </div>
        })}
      </div>
    )}
    {editing && <FuturesRouteDialog existing={editing === 'new' ? undefined : editing} sources={futuresSources} connections={connections} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
  </section>
}

const FuturesRouteDialog: React.FC<{ existing?: SignalRoute; sources: DiscordSource[]; connections: Connection[]; onClose(): void; onSaved(): Promise<void> }> = ({ existing, sources, connections, onClose, onSaved }) => {
  const currentSource = useMemo(() => sources.find((source) => existing && sameIdentity(source, existing)), [existing, sources])
  const [sourceId, setSourceId] = useState(currentSource?.source_id ?? sources[0]?.source_id ?? '')
  const [connectionId, setConnectionId] = useState(existing?.target.type === 'connection' ? existing.target.connection_id : connections[0]?.connection.connection_id ?? '')
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const source = sources.find((item) => item.source_id === sourceId)
    if (!source || !connectionId) return
    const collision = existing ?? undefined
    const now = new Date().toISOString()
    setBusy(true); setError(null)
    try {
      await window.electronAPI.saveTradingSignalRoute({
        route_schema_version: 'trading-signal-route@2',
        route_id: collision?.route_id ?? `discord-${source.guild_id}-${source.channel_id}-${source.author_id}`,
        display_name: source.display_name, source_type: 'discord', server_id: source.guild_id, channel_id: source.channel_id,
        trader_author_id: source.author_id, target: { type: 'connection', connection_id: connectionId }, enabled,
        created_at: collision?.created_at ?? now, updated_at: now,
      }, collision ? targetKey(collision) : undefined)
      await onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={existing ? 'Edit Futures route' : 'Add Futures route'}>
    <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-white/[0.14] bg-[#08111d] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Futures routing</p><h2 className="mt-1 text-xl font-semibold">{existing ? 'Change account route' : 'Route a Discord'}</h2><p className="mt-2 text-xs text-[#84909d]">Pick one saved Discord and the exact futures account it may reach.</p></div><button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[#74808c] hover:text-white"><X className="size-4" /></button></div>
      <div className="mt-6 grid gap-4">
        <label className="grid gap-1.5 text-xs text-[#aab2bc]">Discord<select value={sourceId} disabled={Boolean(existing)} onChange={(event) => setSourceId(event.target.value)} className={inputClass}>{sources.map((source) => <option key={source.source_id} value={source.source_id}>{source.display_name}</option>)}</select></label>
        <label className="grid gap-1.5 text-xs text-[#aab2bc]">Futures account<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className={inputClass}>{connections.map((item) => <option key={item.connection.connection_id} value={item.connection.connection_id}>{item.connection.display_name}</option>)}</select></label>
        <label className="flex items-center gap-3 rounded-xl border border-white/[0.07] px-3 py-3 text-xs text-[#aab2bc]"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Listen for new signals on this route</label>
      </div>
      {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-100">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-[#9ba4af] hover:bg-white/[0.05]">Cancel</button><button type="submit" disabled={!sourceId || !connectionId || busy} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"><Link2 className="size-3.5" /> {busy ? 'Saving…' : 'Save route'}</button></div>
    </form>
  </div>
}

const sameIdentity = (source: DiscordSource, route: SignalRoute) => source.guild_id === route.server_id && source.channel_id === route.channel_id && source.author_id === route.trader_author_id && source.thread_id === null
const targetKey = (route: SignalRoute) => route.target.type === 'connection' ? `connection:${route.target.connection_id}` : `mirror-group:${route.target.mirror_group_id}`
const inputClass = 'h-10 rounded-lg border border-white/[0.1] bg-black/20 px-3 text-sm text-white outline-none focus:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-55'

export default FuturesRoutingPanel
