import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { FileText, Film, ImageIcon, Music2, Package, Search, X, Maximize2, Minimize2, ArrowUpRight, FileBarChart2, Code2, Database, Box, Layers, Receipt, Globe } from 'lucide-react'
import { buildRunnerOutputAssetUrl } from '@craft-agent/shared/outputs/web-preview'
import { CompactPageHeader } from '@/components/app-shell/CompactPageHeader'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useOutputLibrary } from '@/hooks/useOutputLibrary'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'
import { outputLibraryKey, isVisibleLibraryOutput, outputLibraryStatus } from '@/lib/output-library'
import { isArtistCampaignWorkspace, isArtistHQWorkspace } from '@/lib/artist-workspace'
import { cn } from '@/lib/utils'
import { routes } from '../../shared/routes'
import type { OutputsNavigationState } from '../../shared/types'
import OutputDetailPage from './OutputDetailPage'

export default function OutputsLibraryPage({ navigation }: { navigation: OutputsNavigationState }) {
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const { navigate } = useNavigation()
  const [search, setSearch] = React.useState('')
  const [finalsOnly, setFinalsOnly] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const lastRow = React.useRef<HTMLButtonElement | null>(null)
  const searchInput = React.useRef<HTMLInputElement | null>(null)
  const allScope = navigation.outputScope === 'all'
  const scopeWorkspaceId = allScope ? undefined : navigation.outputScopeWorkspaceId ?? activeWorkspaceId ?? undefined
  const ownerId = navigation.outputWorkspaceId ?? activeWorkspaceId ?? ''
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const transport = useTransportConnectionState()
  const transportReady = typeof window.electronAPI.getTransportConnectionState !== 'function' || transport !== null
  const remoteActive = transport?.mode === 'remote' || Boolean(activeWorkspace?.remoteServer)
  const { outputs, loading, error, refresh, finalOutputKeys } = useOutputLibrary({
    workspaces: transportReady ? workspaces : [], activeWorkspaceId, remoteActive, scopeWorkspaceId,
  })
  const workspaceName = (id: string) => {
    const workspace = workspaces.find((entry) => entry.id === id)
    return isArtistHQWorkspace(workspace, workspaces) ? 'Artist HQ' : workspace?.name ?? 'Workspace unavailable'
  }
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === ownerId)
  const ownerAvailable = Boolean(transportReady && selectedWorkspace && (remoteActive ? ownerId === activeWorkspaceId : !selectedWorkspace.remoteServer))
  const selectOutput = (output: OutputSummaryDTO, row: HTMLButtonElement) => {
    lastRow.current = row
    navigate(routes.view.outputLibrary(allScope ? 'all' : 'workspace', scopeWorkspaceId, {
      workspaceId: output.workspaceId!, outputId: output.id,
    }))
  }
  const closePreview = () => {
    setExpanded(false)
    navigate(routes.view.outputLibrary(allScope ? 'all' : 'workspace', scopeWorkspaceId))
  }
  const visible = outputs.filter((output) => {
    if (!isVisibleLibraryOutput(output)) return false
    if (finalsOnly && !finalOutputKeys.has(outputLibraryKey(output.workspaceId!, output.id))) return false
    const haystack = [output.title, output.summary, output.kind, creatorLabel(output), workspaceName(output.workspaceId!)].join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  })
  const selected = outputs.find((output) => output.id === navigation.outputId && output.workspaceId === ownerId)
  const selectableWorkspaces = workspaces.filter((workspace) => remoteActive ? workspace.id === activeWorkspaceId : !workspace.remoteServer)

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#050505] text-foreground">
      <div className="shrink-0 px-5 pt-4 xl:px-8 xl:pt-5">
        <CompactPageHeader eyebrow={allScope ? 'All work' : workspaceName(scopeWorkspaceId ?? '')} title="Outputs" tone="orange" className="mb-4" />
      </div>
      <div className="relative flex min-h-0 flex-1">
        <section aria-label="Output library" className={cn('flex min-w-0 flex-1 flex-col px-5 pb-5 xl:px-8', navigation.outputId && 'basis-[36%]')}>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-white/50 transition-colors focus-within:border-white/25">
              <Search className="h-4 w-4 shrink-0" />
              <input ref={searchInput} aria-label="Search outputs" placeholder="Search outputs" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40" />
            </label>
            <div className="flex rounded-lg border border-white/10 p-1" aria-label="Output status">
              {['All work', 'Finals'].map((label, index) => <button key={label} type="button" aria-pressed={finalsOnly === Boolean(index)} onClick={() => setFinalsOnly(Boolean(index))} className={cn('rounded-md px-3 py-1 text-xs focus-visible:outline focus-visible:outline-orange-400', finalsOnly === Boolean(index) ? 'bg-white/10 text-white' : 'text-white/55')}>{label}</button>)}
            </div>
            <select aria-label="Output workspace" value={allScope ? 'all' : scopeWorkspaceId ?? ''} onChange={(event) => navigate(event.target.value === 'all' ? routes.view.outputLibrary('all') : routes.view.outputLibrary('workspace', event.target.value))} className="max-w-full rounded-lg border border-white/10 bg-[#101010] px-3 py-2 text-xs text-white/75">
              <option value="all">All workspaces</option>
              {selectableWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspaceName(workspace.id)}</option>)}
            </select>
          </div>
          {allScope && workspaces.some((workspace) => remoteActive ? workspace.id !== activeWorkspaceId : Boolean(workspace.remoteServer)) && <p className="mb-3 text-xs text-white/55">Remote work is available when you open its workspace.</p>}
          {error && <div role="alert" className="mb-3 text-sm text-amber-200">{error} <button className="underline" onClick={() => void refresh()}>Retry</button></div>}
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
            {loading && outputs.length === 0 ? <p role="status" className="py-12 text-center text-sm text-white/55">Loading outputs…</p> : visible.length === 0 ? <div className="py-12 text-center"><Package className="mx-auto mb-3 h-7 w-7 text-white/35" /><p className="text-sm text-white/75">{search || finalsOnly ? 'No matching outputs' : 'Your useful work will appear here'}</p><p className="mt-2 text-xs text-white/45">{search || finalsOnly ? 'Try another search or show all work.' : 'Documents, visuals, videos, and other work ready to review or use.'}</p></div> : <ul className="space-y-2 pb-2">
              {visible.map((output) => {
                const key = outputLibraryKey(output.workspaceId!, output.id)
                const isSelected = navigation.outputId === output.id && ownerId === output.workspaceId
                const isFinal = finalOutputKeys.has(key)
                const status = outputLibraryStatus(output, isFinal)
                return <li key={key} className="min-w-0"><button type="button" aria-current={isSelected ? 'true' : undefined} onClick={(event) => selectOutput(output, event.currentTarget)} className={cn('group flex w-full items-center gap-3.5 rounded-xl border bg-gradient-to-b from-white/[0.035] to-transparent px-3 py-3 text-left backdrop-blur-xl shadow-minimal transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400', isSelected ? 'border-orange-400/30 bg-[#211b17]/90' : 'border-white/[0.09] bg-[#141416]/90 hover:border-white/15 hover:bg-[#1a1a1d]/90')}>
                  <OutputThumbnail output={output} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-6 text-white/90" title={output.title}>{output.title}</span>
                    <p className="mt-0.5 truncate text-xs leading-5 text-white/50" title={creatorLabel(output)}>
                      {kindLabel(output)}<span className="mx-1.5 text-white/20">·</span>{output.origin?.agentName ?? output.origin?.agentSlug ?? (output.origin?.source === 'workflow' ? 'Workflow' : creatorLabel(output))}
                      {allScope && <><span className="mx-1.5 text-white/20">·</span>{workspaceName(output.workspaceId!)}</>}
                    </p>
                  </div>
                  {status && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px]', status === 'Final' ? 'bg-orange-400/10 text-orange-300' : status === 'Failed' ? 'bg-red-400/10 text-red-300' : 'bg-white/[0.06] text-white/65')}>{status}</span>}
                  <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-white/20 transition-colors group-hover:text-white/65 group-focus-visible:text-white/65" />
                </button></li>
              })}
            </ul>}
          </div>
        </section>
        <DialogPrimitive.Root open={Boolean(navigation.outputId)} modal={false} onOpenChange={(open) => { if (!open) closePreview() }}>
          {navigation.outputId && <DialogPrimitive.Content aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()} onCloseAutoFocus={(event) => { event.preventDefault(); (lastRow.current?.isConnected ? lastRow.current : searchInput.current)?.focus({ preventScroll: true }) }} className={cn('z-20 flex min-h-0 min-w-0 flex-col border-l border-white/10 bg-[#0a0a0a] shadow-strong outline-none', expanded ? 'absolute inset-0' : 'w-[64%] min-w-[320px]')}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
              <DialogPrimitive.Title className="truncate text-xs text-white/60">{selected ? workspaceName(ownerId) : 'Output preview'}</DialogPrimitive.Title>
              <div className="flex gap-1"><Button variant="ghost" size="icon" className="size-9 shrink-0 text-white/75 hover:bg-white/10 hover:text-white" aria-label={expanded ? 'Reduce preview' : 'Expand preview'} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</Button><DialogPrimitive.Close asChild><Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-lg border border-white/15 bg-white/[0.08] text-white hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Close output preview" title="Close preview (Esc)"><X className="size-5" aria-hidden="true" /></Button></DialogPrimitive.Close></div>
            </div>
            <div className="min-h-0 flex-1">
              {ownerAvailable ? <OutputDetailPage key={outputLibraryKey(ownerId, navigation.outputId)} remote={remoteActive} workspaceId={ownerId} outputId={navigation.outputId} currentCampaignId={isArtistCampaignWorkspace(selectedWorkspace) ? ownerId : undefined} /> : <p role="alert" className="p-6 text-sm text-white/60">Open this output’s workspace to preview it.</p>}
            </div>
          </DialogPrimitive.Content>}
        </DialogPrimitive.Root>
      </div>
    </div>
  )
}

function kindLabel(output: OutputSummaryDTO) {
  return output.kind === 'other' ? 'File' : output.kind.charAt(0).toUpperCase() + output.kind.slice(1)
}
function creatorLabel(output: OutputSummaryDTO) {
  const origin = output.origin
  if (!origin) return 'Creator unavailable'
  const labels = [origin.agentName ?? origin.agentSlug, origin.workflowName].filter(Boolean)
  if (labels.length) return labels.join(' · ')
  return origin.source === 'manual' ? 'Added manually' : origin.source === 'workflow' ? 'Workflow' : origin.source === 'automation' ? 'Automation' : origin.source === 'deep-research' ? 'Deep Research' : 'Agent session'
}
const outputIcons = {
  report: FileBarChart2, document: FileText, image: ImageIcon, video: Film,
  audio: Music2, code: Code2, dataset: Database, model: Box,
  collection: Layers, receipt: Receipt, 'external-action': Globe, other: Package,
}

const outputColors: Record<OutputSummaryDTO['kind'], string> = {
  report: 'bg-gradient-to-br from-[#fcd34d] to-[#fbbf24]',
  document: 'bg-gradient-to-br from-[#fcd34d] to-[#fbbf24]',
  image: 'bg-gradient-to-br from-[#fb923c] to-[#f97316]',
  video: 'bg-[#ef2b10]',
  audio: 'bg-gradient-to-br from-emerald-400 to-emerald-500',
  code: 'bg-gradient-to-br from-cyan-400 to-cyan-500',
  dataset: 'bg-gradient-to-br from-teal-400 to-teal-500',
  model: 'bg-gradient-to-br from-indigo-400 to-indigo-500',
  collection: 'bg-gradient-to-br from-[#fb923c] to-[#f97316]',
  receipt: 'bg-gradient-to-br from-lime-300 to-lime-400',
  'external-action': 'bg-gradient-to-br from-rose-400 to-rose-500',
  other: 'bg-gradient-to-br from-slate-300 to-slate-400',
}

function OutputThumbnail({ output }: { output: OutputSummaryDTO }) {
  const asset = output.primary
  const image = asset && (asset.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(asset.path))
  const src = image ? buildRunnerOutputAssetUrl(output.workspaceId!, output.id, asset.path) : undefined
  const [failedSrc, setFailedSrc] = React.useState<string>()
  const Icon = outputIcons[output.kind] ?? Package
  return <div aria-hidden="true" className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-neutral-950', outputColors[output.kind] ?? outputColors.other)}>
    {src && failedSrc !== src ? <img loading="lazy" src={src} alt="" onError={() => setFailedSrc(src)} className="h-full w-full object-cover" /> : <Icon className="h-3 w-3" />}
  </div>
}
