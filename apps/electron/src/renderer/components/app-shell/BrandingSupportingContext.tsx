import * as React from 'react'
import { FileText, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { BrandingAttachment, BrandingState } from '@craft-agent/shared/artist-context'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const fieldNames: Record<string, string> = {
  creativeDna: 'Creative DNA', tensions: 'Tensions', fascinations: 'Fascinations',
  reactionHooks: 'Reaction hooks', mythology: 'Mythology', emotionalTerritory: 'Emotional territory',
  audienceGravity: 'Audience gravity', notes: 'Notes',
}
const secondary = 'rounded-full border border-white/10 px-4 py-2 text-xs text-white/75 hover:bg-white/5 disabled:opacity-40'
const primary = 'rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-black hover:bg-white disabled:opacity-40'
const input = 'w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white outline-none focus:border-white/30'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Mount with key={workspaceId}: drafts and in-flight mutations never cross HQ boundaries. */
export function BrandingSupportingContext({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = React.useState<BrandingState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [previewId, setPreviewId] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const alive = React.useRef(true)
  const mutationInFlight = React.useRef(false)
  const updateSequence = React.useRef(0)

  const refresh = React.useCallback(async () => {
    const sequence = ++updateSequence.current
    try {
      const result = await window.electronAPI.getBrandingState(workspaceId)
      if (alive.current && sequence === updateSequence.current) { setState(result); setError(null) }
    } catch (cause) {
      if (alive.current && sequence === updateSequence.current) setError(cause instanceof Error ? cause.message : 'Could not load supporting context.')
    }
  }, [workspaceId])

  React.useEffect(() => {
    alive.current = true
    const off = window.electronAPI.onBrandingStateChanged((id, next) => {
      if (id !== workspaceId || !alive.current) return
      ++updateSequence.current
      setState(next)
      setError(null)
    })
    void refresh()
    return () => { alive.current = false; off() }
  }, [workspaceId, refresh])

  async function mutate(action: () => Promise<BrandingState>, message: string): Promise<boolean> {
    if (mutationInFlight.current) return false
    mutationInFlight.current = true
    setBusy(true)
    try {
      // Events carry current state. Refresh after the mutation rather than letting an
      // older response replace a newer event from another window.
      await action()
      if (!alive.current) return false
      await refresh()
      toast.success(message)
      return true
    } catch (cause) {
      if (alive.current) {
        toast.error(cause instanceof Error ? cause.message : 'Could not save Branding changes.')
        await refresh()
      }
      return false
    } finally { mutationInFlight.current = false; if (alive.current) setBusy(false) }
  }

  const attachments = [...(state?.attachments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const proposals = (state?.proposals ?? []).filter(proposal => proposal.status === 'pending')
  const preview: BrandingAttachment | undefined = attachments.find(attachment => attachment.id === previewId)

  async function readFile(file: File | undefined) {
    if (!file) return
    if (!/\.(md|txt)$/i.test(file.name)) { toast.error('Choose a Markdown (.md) or text (.txt) document.'); return }
    if (file.size > 100_000) { toast.error('Choose a document smaller than 100 KB.'); return }
    try {
      const text = await file.text()
      if (text.length > 11_000) { toast.error('Keep each supporting document under 11,000 characters.'); return }
      if (alive.current) { setTitle(file.name.replace(/\.(md|txt)$/i, '').slice(0, 200)); setBody(text) }
    } catch { toast.error('Could not read this document.') }
  }

  return (
    <section className="mt-7 border-t border-white/10 pt-6" aria-label="Branding supporting context">
      {error ? <div role="alert" className="mb-4 text-sm text-red-200">{error} <button type="button" className="ml-2 underline" onClick={() => void refresh()}>Try again</button></div> : null}
      {!state && !error ? <p className="text-xs text-white/45">Loading supporting context…</p> : null}
      {proposals.length > 0 && <div className="mb-7">
        <h3 className="text-sm font-semibold text-white">Suggested updates</h3>
        <p className="mt-1 text-xs leading-5 text-white/45">Review the exact changes before they become your artist direction.</p>
        <div className="mt-3 space-y-3">{proposals.map(proposal => <details key={proposal.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <summary className="cursor-pointer text-sm text-white/85">{proposal.title}<span className="ml-3 text-xs text-white/40">{dateLabel(proposal.createdAt)}</span></summary>
          <div className="mt-4 space-y-4">
            {proposal.patches.map(patch => <div key={patch.field}>
              <h4 className="mb-2 text-xs font-semibold text-white/80">{fieldNames[patch.field] ?? patch.field}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="mb-1 text-[11px] text-white/40">Current</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-white/55">{patch.before || 'Not set'}</p></div>
                <div><p className="mb-1 text-[11px] text-orange-300/80">Suggested</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-white/85">{patch.after || 'Clear this field'}</p></div>
              </div>
            </div>)}
            {proposal.additions.map(attachment => <div key={attachment.id}><h4 className="text-xs font-semibold text-white/80">Add supporting context: {attachment.title}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/65">{attachment.body}</p></div>)}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy || !state} onClick={() => state && void mutate(() => window.electronAPI.applyBrandingProposal(workspaceId, { proposalId: proposal.id, expectedRevision: state.revision }), 'Artist direction updated')}>Apply to Branding</button>
              <button type="button" className={secondary} disabled={busy || !state} onClick={() => state && void mutate(() => window.electronAPI.dismissBrandingProposal(workspaceId, { proposalId: proposal.id, expectedRevision: state.revision }), 'Suggestion dismissed')}>Dismiss</button>
            </div>
          </div>
        </details>)}</div>
      </div>}
      <div className="flex items-start justify-between gap-4">
        <div><h3 className="text-sm font-semibold text-white">Supporting context</h3><p className="mt-1 max-w-xl text-xs leading-5 text-white/45">Agents can use everything attached here, favoring recent, relevant material. Your approved DNA comes first.</p></div>
        <button type="button" className={`${secondary} flex shrink-0 items-center gap-1.5`} disabled={!state || busy} onClick={() => setAdding(true)}><Plus className="size-3.5" />Add context</button>
      </div>
      {state && attachments.length === 0 ? <p className="mt-4 text-xs text-white/40">Add useful briefs, observations, or references from your work with Artist Direction.</p> : null}
      <div className="mt-3 divide-y divide-white/5">{attachments.map(attachment => <div key={attachment.id} className="flex items-center gap-3 py-3">
        <FileText className="size-4 shrink-0 text-white/40" />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPreviewId(attachment.id)}><span className="block truncate text-sm text-white/85">{attachment.title}</span><span className="mt-0.5 block text-xs text-white/40">{dateLabel(attachment.createdAt)}</span></button>
        <button type="button" className="rounded-full p-2 text-white/40 hover:bg-white/5 hover:text-white disabled:opacity-30" title="Remove from Branding. Original output stays saved." aria-label={`Remove ${attachment.title} from Branding`} disabled={busy || !state} onClick={() => state && void mutate(() => window.electronAPI.removeBrandingAttachment(workspaceId, { attachmentId: attachment.id, expectedRevision: state.revision }), 'Removed from Branding. Agents will no longer receive this attachment.')}><X className="size-4" /></button>
      </div>)}</div>
      <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreviewId(null) }}>
        <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle className="pr-6">{preview?.title}</DialogTitle><DialogDescription>{preview ? dateLabel(preview.createdAt) : ''} · Supporting artist context</DialogDescription></DialogHeader><div className="max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-white/75">{preview?.body}</div></DialogContent>
      </Dialog>
      <Dialog open={adding} onOpenChange={open => { if (!busy) setAdding(open) }}>
        <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Add supporting context</DialogTitle><DialogDescription>Available to agents as soon as you add it. Your core DNA stays unchanged.</DialogDescription></DialogHeader>
          <label className="space-y-1.5 text-xs text-white/60"><span>Title</span><input className={input} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="What should agents know?" disabled={busy} /></label>
          <label className="space-y-1.5 text-xs text-white/60"><span>Context</span><textarea className={`${input} min-h-48 max-h-[40vh] resize-y`} value={body} maxLength={11_000} onChange={event => setBody(event.target.value)} placeholder="Paste the useful observations, direction, or brief here." disabled={busy} /></label>
          <input ref={fileRef} type="file" accept=".md,.txt,text/plain,text/markdown" className="hidden" aria-label="Choose a supporting context document" onChange={event => { void readFile(event.target.files?.[0]); event.target.value = '' }} />
          <div className="flex items-center justify-between gap-3"><button type="button" className={secondary} disabled={busy} onClick={() => fileRef.current?.click()}>Import .md or .txt</button><button type="button" className={primary} disabled={busy || !state || !title.trim() || !body.trim()} onClick={async () => { if (!state) return; const saved = await mutate(() => window.electronAPI.addBrandingAttachment(workspaceId, { title: title.trim(), body: body.trim(), expectedRevision: state.revision }), 'Context added to Branding'); if (saved) { setAdding(false); setTitle(''); setBody('') } }}>{busy ? 'Adding…' : 'Add to Branding'}</button></div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
