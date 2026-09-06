import React, { useCallback, useEffect, useState } from 'react'
import { ExternalLink, MessageSquare, Pencil, Plus, Radio, Trash2, X } from 'lucide-react'

import DiscoTraderControlCenterPage from './DiscoTraderControlCenterPage'

type DiscordSource = Awaited<ReturnType<typeof window.electronAPI.listDiscordSources>>[number]

interface DiscordSourcesPageProps {
  workspaceId?: string
}

const DiscordSourcesPage: React.FC<DiscordSourcesPageProps> = ({ workspaceId }) => {
  const [sources, setSources] = useState<DiscordSource[]>([])
  const [editing, setEditing] = useState<DiscordSource | null | 'new'>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSources(await window.electronAPI.listDiscordSources())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const remove = async (source: DiscordSource) => {
    if (!window.confirm(`Remove ${source.display_name} from your Discord list?`)) return
    try {
      await window.electronAPI.archiveDiscordSource(source.source_id)
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return (
    <div className="space-y-6 pt-5 text-foreground">
      <DiscoTraderControlCenterPage mode="connections" workspaceId={workspaceId} />

      <section className="border-t border-foreground/[0.08] pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">Your Discords</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Save every Discord once, using a name you will recognize. Route it inside Futures or Options.</p>
          </div>
          <button type="button" onClick={() => setEditing('new')} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-3.5 text-[11px] font-semibold text-background hover:opacity-85"><Plus className="size-3.5" /> Add Discord</button>
        </div>

        {error && <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-xs text-rose-100">{error}</div>}
        {loading ? <p className="py-12 text-center text-xs text-muted-foreground">Loading your Discords…</p> : sources.length === 0 ? (
          <button type="button" onClick={() => setEditing('new')} className="mt-5 flex w-full flex-col items-center rounded-2xl border border-dashed border-foreground/[0.14] px-6 py-12 text-center hover:bg-foreground/[0.02]">
            <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><MessageSquare className="size-5" /></span>
            <span className="mt-4 text-sm font-medium">Add your first Discord trader</span>
            <span className="mt-1 text-xs text-muted-foreground">Give it a clear name, then add the channel link and trader ID.</span>
          </button>
        ) : (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {sources.map((source) => <article key={source.source_id} className="rounded-2xl border border-border bg-background-elevated p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Radio className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">{source.display_name}</h3>
                  <a href={discordUrl(source)} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-blue-700 hover:text-blue-900">Channel {source.channel_id}<ExternalLink className="size-3 shrink-0" /></a>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">Trader {source.author_id}</p>
                </div>
                <button type="button" onClick={() => setEditing(source)} aria-label={`Edit ${source.display_name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil className="size-3.5" /></button>
                <button type="button" onClick={() => void remove(source)} aria-label={`Remove ${source.display_name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"><Trash2 className="size-3.5" /></button>
              </div>
            </article>)}
          </div>
        )}
      </section>

      {editing && <DiscordSourceDialog existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
    </div>
  )
}

const DiscordSourceDialog: React.FC<{ existing?: DiscordSource; onClose(): void; onSaved(): Promise<void> }> = ({ existing, onClose, onSaved }) => {
  const [name, setName] = useState(existing?.display_name ?? '')
  const [url, setUrl] = useState(existing ? discordUrl(existing) : '')
  const [authorId, setAuthorId] = useState(existing?.author_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      await window.electronAPI.saveDiscordSource({
        ...(existing ? { source_id: existing.source_id } : {}),
        display_name: name.trim(), channel_url: url.trim(), author_id: authorId.trim(),
      })
      await onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={existing ? 'Edit Discord' : 'Add Discord'}>
    <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-white/[0.14] bg-[#08111d] p-6 text-white shadow-modal-small">
      <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Discord</p><h2 className="mt-1 text-xl font-semibold">{existing ? 'Edit Discord' : 'Add a Discord trader'}</h2><p className="mt-2 text-xs leading-5 text-[#84909d]">This only saves the trader. You will choose their account inside Futures or Options.</p></div><button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[#74808c] hover:text-white"><X className="size-4" /></button></div>
      <div className="mt-6 grid gap-4">
        <label className="grid gap-1.5 text-xs text-[#aab2bc]">Discord name<input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="AlgoXFlow · Algo Austin" /><span className="text-[10px] leading-4 text-[#74808c]">Use the server or trader name you will recognize in routing.</span></label>
        <label className="grid gap-1.5 text-xs text-[#aab2bc]">Discord channel link<input className={inputClass} value={url} disabled={Boolean(existing)} onChange={(event) => setUrl(event.target.value)} placeholder="https://discord.com/channels/server/channel" /></label>
        <label className="grid gap-1.5 text-xs text-[#aab2bc]">Trader's Discord user ID<input className={inputClass} value={authorId} disabled={Boolean(existing)} onChange={(event) => setAuthorId(event.target.value)} placeholder="Paste user ID" /></label>
        {existing && <p className="-mt-1 text-[11px] leading-5 text-[#74808c]">To change the channel or trader, add a new Discord. This prevents live routes from silently switching identity.</p>}
      </div>
      {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-100">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-[#9ba4af] hover:bg-white/[0.05]">Cancel</button><button type="submit" disabled={!name.trim() || !url.trim() || !authorId.trim() || busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Saving…' : 'Save Discord'}</button></div>
    </form>
  </div>
}

const discordUrl = (source: Pick<DiscordSource, 'guild_id' | 'channel_id' | 'thread_id'>) => `https://discord.com/channels/${source.guild_id}/${source.channel_id}${source.thread_id ? `/${source.thread_id}` : ''}`
const inputClass = 'h-10 rounded-lg border border-white/[0.1] bg-black/20 px-3 text-sm text-white outline-none focus:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-55'

export default DiscordSourcesPage
