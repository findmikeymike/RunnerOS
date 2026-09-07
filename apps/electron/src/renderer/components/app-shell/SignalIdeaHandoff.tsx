import * as React from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import type { SignalEntryReference, SignalRetrievedEntry } from '@craft-agent/shared/shared-intel'
import type { AgentDefinitionDTO, Workspace } from '../../../shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { launchSignalIdea, signalCampaignChoices, SignalDraftSaveError, sameSignalReference, resolvedSignalIdea } from '@/lib/signal-idea-handoff'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { navigate, routes } from '@/lib/navigate'

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40'

export function SignalIdeasActions({ workspaceId, outputId, revision, onDevelop }: {
  workspaceId: string; outputId: string; revision: string; onDevelop: (reference: SignalEntryReference) => void
}) {
  const [ideas, setIdeas] = React.useState<SignalRetrievedEntry[]>([])
  React.useEffect(() => {
    let current = true
    setIdeas([])
    void window.electronAPI.getSignalIdeas(workspaceId, outputId).then(result => {
      if (current && result.ok) setIdeas(result.entries.filter(entry => entry.kind === 'idea'
        && entry.reference.hqWorkspaceId === workspaceId && entry.reference.outputId === outputId))
    }).catch(() => {})
    return () => { current = false }
  }, [workspaceId, outputId, revision])
  if (!ideas.length) return null
  return <div aria-label="Develop report ideas" className="space-y-2 border-t border-white/10 px-4 py-3">
    {ideas.map(idea => <div key={idea.reference.entryId} className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1 break-words text-sm text-white/75">{idea.title}</span>
      <button className={button} onClick={() => onDevelop(idea.reference)} aria-label={`Develop this idea: ${idea.title}`}><ArrowRight size={14} />Develop this idea</button>
    </div>)}
  </div>
}

export function SignalIdeaHandoff({ reference, onClose }: { reference: SignalEntryReference; onClose: () => void }) {
  const shell = useAppShellContext()
  const [campaigns, setCampaigns] = React.useState<Workspace[]>([])
  const [agents, setAgents] = React.useState<AgentDefinitionDTO[]>([])
  const [destination, setDestination] = React.useState('')
  const [active, setActive] = React.useState<boolean | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [failedSeed, setFailedSeed] = React.useState<SignalDraftSaveError | null>(null)
  const epoch = React.useRef(0)
  const locked = React.useRef(false)
  const target = destination === 'manager' ? reference.hqWorkspaceId : destination
  const slug = destination === 'manager' ? 'concierge' : 'content-genius'
  const worker = agents.find(agent => agent.slug === slug)
  React.useEffect(() => {
    const token = ++epoch.current
    void Promise.all([window.electronAPI.getWorkspaces(), window.electronAPI.listAllAgentDefinitions()]).then(([workspaces, definitions]) => {
      if (epoch.current !== token) return
      setCampaigns(signalCampaignChoices(workspaces, reference.hqWorkspaceId)); setAgents(definitions); setLoading(false)
    }).catch(cause => { if (epoch.current === token) { setError(String(cause)); setLoading(false) } })
    return () => { epoch.current++ }
  }, [reference.hqWorkspaceId])
  React.useEffect(() => {
    let current = true; setActive(null)
    if (target && worker) void window.electronAPI.listActiveAgentDefinitions(target).then(slugs => {
      if (current) setActive(slugs.includes(slug))
    }).catch(cause => { if (current) setError(String(cause)) })
    return () => { current = false }
  }, [target, slug, worker])
  const close = () => { epoch.current++; onClose() }
  const focusDraft = async (id: string, restore: boolean, isCurrent: () => boolean) => {
    const stored = (await window.electronAPI.getAllDrafts())[id]
    if (!isCurrent()) throw new Error('Idea handoff cancelled.')
    const route = routes.view.allSessions(id)
    if (shell.activeWorkspaceId !== target) {
      if (!shell.onSelectWorkspaceAndNavigate) throw new Error('Workspace navigation is unavailable.')
      await shell.onSelectWorkspaceAndNavigate(target, route)
      if (stored) shell.restoreDraft?.(id, stored)
    } else {
      if (restore && stored) shell.restoreDraft?.(id, stored)
      navigate(route)
    }
  }
  const recoverDraft = async (save: boolean) => {
    if (!failedSeed || locked.current) return
    locked.current = true; setBusy(true)
    const token = epoch.current
    try {
      if (save) {
        resolvedSignalIdea(await window.electronAPI.resolveSignalIdea(target, reference), reference)
        const pending = await window.electronAPI.getSignalHandoff(failedSeed.sessionId)
        if (!pending || !sameSignalReference(pending, reference)) throw new Error('This draft is no longer attached to the selected idea.')
        const stored = (await window.electronAPI.getAllDrafts())[failedSeed.sessionId]
        // An uncertain prior save or another window's edits must win over retry text.
        if (!stored && !shell.getDraft(failedSeed.sessionId) && !shell.getDraftAttachmentRefs(failedSeed.sessionId).length) {
          await window.electronAPI.setDraft(failedSeed.sessionId, { text: failedSeed.draft })
        }
      }
      await focusDraft(failedSeed.sessionId, true, () => epoch.current === token)
      if (epoch.current === token) close()
    } catch (cause) { if (epoch.current === token) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { locked.current = false; if (epoch.current === token) setBusy(false) }
  }
  const launch = async () => {
    if (locked.current || !worker || !target || active === null) return
    locked.current = true; setBusy(true); setError(null)
    const token = epoch.current
    const isCurrent = () => epoch.current === token
    const seeded = new Set<string>()
    try {
      // The button explicitly names activation when the selected worker is inactive.
      if (!active) await window.electronAPI.setAgentDefinitionActive(target, slug, true)
      if (!isCurrent()) return
      await launchSignalIdea(reference, {
        isCurrent,
        resolve: () => window.electronAPI.resolveSignalIdea(target, reference),
        find: () => window.electronAPI.findSignalHandoff(target, slug, reference),
        create: async () => {
          const [skills, sources] = await Promise.all([window.electronAPI.getSkills(target), window.electronAPI.getSources(target)])
          let createdId: string | undefined
          try {
            const session = await openAgentSessionComposer({ agent: worker, workspaceId: target,
              onCreateSession: async (...args) => { const created = await shell.onCreateSession(...args); createdId = created.id; return created },
              onInputChange: shell.onInputChange, skills, sources, navigateOnCreate: false, shouldContinue: isCurrent })
            return session.id
          } catch (cause) { if (createdId) await shell.onDeleteSession(createdId, true); throw cause }
        },
        bind: id => window.electronAPI.bindSignalHandoff(id, reference),
        discardBlank: async id => { await shell.onDeleteSession(id, true) },
        seed: async (id, text) => { await window.electronAPI.setDraft(id, { text }); seeded.add(id) },
        focus: id => focusDraft(id, seeded.has(id), isCurrent),
      })
      if (isCurrent()) close()
    } catch (cause) { if (isCurrent()) { if (cause instanceof SignalDraftSaveError) setFailedSeed(cause); setError(cause instanceof Error ? cause.message : String(cause)) } }
    finally { locked.current = false; if (isCurrent()) setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="w-[calc(100vw-2rem)] max-w-md bg-[#151719] p-5 text-white">
      <DialogHeader><DialogTitle>Develop this idea</DialogTitle><DialogDescription>Choose where to open the draft. Nothing runs until you send.</DialogDescription></DialogHeader>
      {loading ? <RefreshCw size={18} className="animate-spin" /> : <>
        <label className="space-y-2 text-sm">Destination<select aria-label="Idea destination" value={destination} disabled={busy || !!failedSeed} onChange={event => { setDestination(event.target.value); setError(null) }} className="mt-2 w-full rounded-md border border-white/15 bg-[#202225] px-3 py-2">
          <option value="">Choose a campaign or Artist Manager</option>
          {agents.some(agent => agent.slug === 'content-genius') ? campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name} / Content Genius</option>) : null}
          {agents.some(agent => agent.slug === 'concierge') ? <option value="manager">Artist HQ / Artist Manager</option> : null}
        </select></label>
        {!campaigns.length || !agents.some(agent => agent.slug === 'content-genius') ? <p className="text-xs text-white/55">Content Genius has no available campaign. Choose Artist Manager in HQ.</p> : null}
        {!agents.some(agent => agent.slug === 'concierge' || agent.slug === 'content-genius') ? <p className="text-xs text-white/55">No supported worker is installed.</p> : null}
      </>}
      {error ? <p role="alert" className="break-words text-sm text-red-300">{error}</p> : null}
      {failedSeed ? <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { void recoverDraft(true) }}>Retry saving research draft</button><button className={button} disabled={busy} onClick={() => { void recoverDraft(false) }}>Open existing draft</button></div> : null}
      <div className="flex justify-end gap-2"><button className={button} onClick={close}>Cancel</button><button className={button} disabled={busy || !!failedSeed || !worker || !target || active === null} onClick={() => { void launch() }}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <ArrowRight size={14} />}{active === false ? 'Activate and open draft' : 'Open draft'}</button></div>
    </DialogContent>
  </Dialog>
}
