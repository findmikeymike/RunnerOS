import * as React from 'react'
import {
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileOutput,
  Send,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import type { ScheduledWorkInputRef, ScheduledWorkOwner } from '@craft-agent/shared/scheduled-work'
import type { OutputKind } from '@craft-agent/shared/outputs'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import type { WorkflowDTO } from '../../../shared/types'
import { useAgents } from '@/hooks/useAgents'
import { useOutputs, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { useWorkflows } from '@/hooks/useWorkflows'
import { cn } from '@/lib/utils'
import {
  composerDefinitionDigest,
  composerReviewSentence,
  createScheduledWorkComposerDraft,
  selectScheduledWorkComposerType,
  validateComposerDraft,
  validateComposerSection,
  type ScheduledWorkComposerDraft,
  type ScheduledWorkComposerFollowUp,
  type ScheduledWorkComposerSection,
  type ScheduledWorkComposerType,
} from '@/lib/scheduled-work-composer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export interface ScheduledWorkComposerEntry {
  owner: ScheduledWorkOwner
  date: string
  mode?: 'event' | 'job'
  title?: string
  inputRefs?: ScheduledWorkInputRef[]
  suggestedType?: ScheduledWorkComposerType
}

export interface ScheduledWorkComposerProps {
  open: boolean
  entry: ScheduledWorkComposerEntry
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: ScheduledWorkComposerDraft) => Promise<void> | void
  allowedTypes?: ScheduledWorkComposerType[]
  allowFollowUps?: boolean
  timingMode?: 'scheduled' | 'triggered'
}

type ComposerSection = ScheduledWorkComposerSection
type SocialProfile = { platform: string; profileId: string; label: string; accountSetId: string; ready: boolean }

const QUEUE_OPTIONS: Array<{
  type: ScheduledWorkComposerType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { type: 'event', label: 'Event / Reminder', description: 'Date, deadline, meeting, or checkpoint', icon: CalendarDays },
  { type: 'agent-task', label: 'Agent Task', description: 'One agent completes a defined deliverable', icon: Bot },
  { type: 'workflow-run', label: 'Workflow Run', description: 'Run an activated multi-step workflow', icon: Workflow },
  { type: 'social-publish', label: 'Social Publish', description: 'Publish one exact asset to one profile', icon: Send },
  { type: 'review', label: 'Review / Approval', description: 'Request a decision on an Output or Final', icon: CheckCircle2 },
]

const INPUT_CLASS = 'h-10 w-full rounded-[6px] border border-white/[0.08] bg-white/[0.025] px-3 text-sm text-white/80 outline-none placeholder:text-white/28 focus:border-white/20'

export function ScheduledWorkComposer({ open, entry, disabled, onOpenChange, onSubmit, allowedTypes, allowFollowUps = true, timingMode = 'scheduled' }: ScheduledWorkComposerProps) {
  const [draft, setDraft] = React.useState(() => createEntryDraft(entry))
  const [section, setSection] = React.useState<ComposerSection>(() => initialSection(entry))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [profiles, setProfiles] = React.useState<SocialProfile[]>([])
  const [vaultAssets, setVaultAssets] = React.useState<VaultAssetRecord[]>([])
  const [releaseKitItems, setReleaseKitItems] = React.useState<ReleaseKitItem[]>([])
  const [releaseKitLoading, setReleaseKitLoading] = React.useState(false)
  const { activeAgents, loading: agentsLoading } = useAgents(entry.owner.workspaceId)
  const { activeWorkflows, loading: workflowsLoading } = useWorkflows(entry.owner.workspaceId)
  const { outputs, loading: outputsLoading } = useOutputs(entry.owner.workspaceId)

  React.useEffect(() => {
    if (!open) return
    setDraft(createEntryDraft(entry))
    setSection(initialSection(entry))
    setError(null)
  }, [entry, open])

  React.useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all([
      window.electronAPI.listSocialAccounts(),
      window.electronAPI.getArtistVaultManifest(entry.owner.workspaceId),
    ]).then(([doctor, manifest]) => {
      if (!active) return
      setProfiles(doctor.platforms.flatMap((group) => group.profiles.map((profile) => ({
        platform: profile.platform,
        profileId: profile.profile,
        label: `${profile.platform} @${profile.profile}`,
        accountSetId: profile.accountGroup ?? '',
        ready: profile.ready || (profile.localSessionExists && Boolean(profile.accountHandle || profile.accountUrl)),
      }))))
      setVaultAssets(manifest.assets.filter((asset) => asset.status !== 'missing' && asset.status !== 'archived'))
    }).catch(() => {
      if (!active) return
      setProfiles([])
      setVaultAssets([])
    })
    return () => { active = false }
  }, [entry.owner.workspaceId, open])

  React.useEffect(() => {
    if (!open || entry.owner.scope !== 'campaign') {
      setReleaseKitItems([])
      setReleaseKitLoading(false)
      return
    }
    let active = true
    setReleaseKitLoading(true)
    void window.electronAPI.getReleaseKit(entry.owner.workspaceId).then((manifest) => {
      if (active) setReleaseKitItems(manifest.items.filter((item) => item.status === 'ready'))
    }).catch(() => {
      if (active) setReleaseKitItems([])
    }).finally(() => {
      if (active) setReleaseKitLoading(false)
    })
    return () => { active = false }
  }, [entry.owner.scope, entry.owner.workspaceId, open])

  const chooseType = React.useCallback((type: ScheduledWorkComposerType) => {
    setDraft((current) => selectScheduledWorkComposerType(current, type))
    setSection(type === 'agent-task' || type === 'event' ? 'inputs' : 'runner')
    setError(null)
  }, [])

  const submit = React.useCallback(async () => {
    const submittedDraft = timingMode === 'triggered' && draft.type !== 'event'
      ? withCurrentTiming(draft)
      : draft
    const invalidSection = visibleSections(submittedDraft, allowFollowUps, timingMode).find(candidate => (
      validateSection(submittedDraft, candidate, activeAgents, activeWorkflows, profiles)
    ))
    const validationError = invalidSection
      ? validateSection(submittedDraft, invalidSection, activeAgents, activeWorkflows, profiles)
      : validateComposerDraft(submittedDraft) ?? validateLiveTarget(submittedDraft, activeAgents, activeWorkflows, profiles)
    if (validationError) {
      if (invalidSection) setSection(invalidSection)
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(submittedDraft)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setBusy(false)
    }
  }, [activeAgents, activeWorkflows, allowFollowUps, draft, onOpenChange, onSubmit, profiles, timingMode])

  const queueOptions = QUEUE_OPTIONS.filter((option) => option.type !== 'event' && (!allowedTypes || allowedTypes.includes(option.type)))
  const sections = visibleSections(draft, allowFollowUps, timingMode)
  const activeSection = sections.includes(section) ? section : sections[0]
  const activeIndex = Math.max(0, sections.indexOf(activeSection))
  const isLastSection = activeIndex === sections.length - 1
  const goBack = () => {
    setError(null)
    if (activeIndex > 0) setSection(sections[activeIndex - 1])
  }
  const goNext = () => {
    const validationError = validateSection(draft, activeSection, activeAgents, activeWorkflows, profiles)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    if (!isLastSection) setSection(sections[activeIndex + 1])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] w-[min(620px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-white/[0.08] bg-[#090909] p-0 text-white shadow-modal-small max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-screen max-sm:rounded-none"
      >
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold tracking-normal">{timingMode === 'triggered' ? 'Queue tracked work' : 'Schedule'}</DialogTitle>
          <DialogDescription className="sr-only">{timingMode === 'triggered' ? 'Choose work to run whenever this automation fires.' : 'Create a calendar event or queue executable work.'}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-5 flex items-start gap-3">
            {activeIndex > 0 ? (
              <button type="button" onClick={goBack} className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/50 hover:bg-white/[0.05] hover:text-white" aria-label="Previous step">
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : null}
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/32">Step {activeIndex + 1} of {sections.length}</div>
              <h3 className="mt-1 text-sm font-semibold text-white/84">{sectionTitle(activeSection, draft)}</h3>
            </div>
          </div>

          {activeSection === 'what' ? <QueueTypeList options={queueOptions} onChoose={chooseType} /> : null}
          {activeSection === 'runner' && draft.type !== 'event' ? (
            <RunnerSection
              draft={draft}
              agents={activeAgents}
              workflows={activeWorkflows}
              profiles={profiles}
              loading={runnerLoading(draft, agentsLoading, workflowsLoading)}
              onChange={setDraft}
              onComplete={() => { if (!isLastSection) setSection(sections[activeIndex + 1]) }}
            />
          ) : null}
          {activeSection === 'inputs' ? (
            <InputsSection
              draft={draft}
              outputs={outputs}
              vaultAssets={vaultAssets}
              releaseKitItems={releaseKitItems}
              loading={outputsLoading || releaseKitLoading}
              onChange={setDraft}
            />
          ) : null}
          {activeSection === 'timing' ? <TimingSection draft={draft} onChange={setDraft} /> : null}
          {activeSection === 'then' && draft.type !== 'event' ? (
            <ThenSection draft={draft} agents={activeAgents} workflows={activeWorkflows} profiles={profiles} onChange={setDraft} />
          ) : null}
          {activeSection === 'safeguards' && draft.type !== 'event' ? <SafeguardsSection draft={draft} onChange={setDraft} /> : null}
        </div>

        <div className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0b] px-5 py-4">
          {isLastSection ? <p className="mb-3 text-xs leading-5 text-white/48">{composerReviewSentence(timingMode === 'triggered' ? { ...draft, date: '', time: '' } : draft)}</p> : null}
          {error ? <p className="mb-3 text-xs text-red-300/80">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            {isLastSection ? (
              <Button type="button" onClick={submit} disabled={disabled || busy}>{busy ? 'Saving...' : draft.type === 'event' ? 'Add event' : 'Queue work'}</Button>
            ) : activeSection !== 'what' && activeSection !== 'runner' ? (
              <Button type="button" onClick={goNext}>Next</Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function withCurrentTiming<T extends Exclude<ScheduledWorkComposerDraft, { type: 'event' }>>(draft: T): T {
  const now = new Date()
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return { ...draft, date, time }
}

function QueueTypeList({ options, onChoose }: { options: typeof QUEUE_OPTIONS; onChoose: (type: ScheduledWorkComposerType) => void }) {
  return (
    <div className="divide-y divide-white/[0.05]">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.type}
            type="button"
            onClick={() => onChoose(option.type)}
            className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-white/[0.025]"
          >
            <Icon className="h-4 w-4 text-white/48" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white/78">{option.label}</div>
              <div className="mt-0.5 text-xs text-white/36">{option.description}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-white/28" />
          </button>
        )
      })}
    </div>
  )
}

function runnerLoading(draft: Exclude<ScheduledWorkComposerDraft, { type: 'event' }>, agentsLoading: boolean, workflowsLoading: boolean): boolean {
  if (draft.type === 'agent-task' || draft.type === 'review') return agentsLoading
  if (draft.type === 'workflow-run') return workflowsLoading
  return false
}

function RunnerSection({ draft, agents, workflows, profiles, loading, onChange, onComplete }: {
  draft: Exclude<ScheduledWorkComposerDraft, { type: 'event' }>
  agents: ReturnType<typeof useAgents>['activeAgents']
  workflows: WorkflowDTO[]
  profiles: SocialProfile[]
  loading: boolean
  onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>>
  onComplete: () => void
}) {
  if (loading) return <EmptyLine>Loading available targets...</EmptyLine>
  if (draft.type === 'agent-task') {
    return <ChoiceList choices={agents.map((agent) => ({ id: agent.slug, label: agent.metadata.name, description: agent.metadata.description }))} selected={draft.agentSlug} empty="No active agents. Activate one from Agents." onSelect={(id) => {
      const agent = agents.find((candidate) => candidate.slug === id)
      onChange({ ...draft, agentSlug: id, agentName: agent?.metadata.name ?? id })
      onComplete()
    }} />
  }
  if (draft.type === 'workflow-run') {
    return <ChoiceList choices={workflows.map((workflow) => ({ id: workflow.slug, label: workflow.metadata.name, description: `${workflow.metadata.steps.length} steps · ${workflow.metadata.description}` }))} selected={draft.workflowSlug} empty="No active workflows. Activate one from Workflows." onSelect={(id) => {
      const workflow = workflows.find((candidate) => candidate.slug === id)
      if (!workflow) return
      const triggerInputs = Object.fromEntries((workflow.metadata.trigger.inputs ?? []).map((input) => [input.name, input.default ?? defaultTriggerValue(input.type)]))
      onChange({
        ...draft,
        workflowSlug: workflow.slug,
        workflowName: workflow.metadata.name,
        workflowDigest: composerDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }),
        triggerInputs,
      })
      onComplete()
    }} />
  }
  if (draft.type === 'social-publish') {
    return <ChoiceList choices={profiles.map((profile) => ({ id: `${profile.platform}/${profile.profileId}`, label: profile.label, description: profile.ready ? 'Ready' : 'Login or setup required', disabled: !profile.ready }))} selected={draft.profileId ? `${draft.platform}/${draft.profileId}` : ''} empty="No social profiles configured." onSelect={(id) => {
      const profile = profiles.find((candidate) => `${candidate.platform}/${candidate.profileId}` === id)
      if (!profile) return
      onChange({ ...draft, platform: profile.platform, profileId: profile.profileId, profileLabel: profile.label, accountSetId: profile.accountSetId, platformOptions: defaultSocialPlatformOptions(profile.platform) })
      onComplete()
    }} />
  }
  return (
    <ChoiceList
      choices={[
        { id: 'user', label: 'You', description: 'Decision stays in RunnerOS' },
        ...agents.map((agent) => ({ id: `agent:${agent.slug}`, label: agent.metadata.name, description: agent.metadata.description })),
      ]}
      selected={draft.reviewerType === 'user' ? 'user' : `agent:${draft.reviewerId}`}
      empty="No reviewers available."
      onSelect={(id) => {
        if (id === 'user') onChange({ ...draft, reviewerType: 'user', reviewerId: '', reviewerName: 'You' })
        else {
          const slug = id.slice('agent:'.length)
          const agent = agents.find((candidate) => candidate.slug === slug)
          onChange({ ...draft, reviewerType: 'agent', reviewerId: slug, reviewerName: agent?.metadata.name ?? slug })
        }
        onComplete()
      }}
    />
  )
}

function InputsSection({ draft, outputs, vaultAssets, releaseKitItems, loading, onChange }: {
  draft: ScheduledWorkComposerDraft
  outputs: OutputSummaryDTO[]
  vaultAssets: VaultAssetRecord[]
  releaseKitItems: ReleaseKitItem[]
  loading: boolean
  onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>>
}) {
  const update = (patch: Record<string, unknown>) => onChange((current) => ({ ...current, ...patch }) as ScheduledWorkComposerDraft)
  const workDraft = draft.type === 'event' ? null : draft
  const socialOrReview = draft.type === 'social-publish' || draft.type === 'review'
  return (
    <div className="space-y-4">
      <Field label="Title">
        <input className={INPUT_CLASS} value={draft.title} onChange={(event) => update({ title: event.target.value })} placeholder={draft.type === 'event' ? 'Release day' : 'Launch work'} />
      </Field>
      {draft.type === 'agent-task' ? (
        <Field label="Brief">
          <Textarea className="min-h-24 border-white/[0.08] bg-white/[0.025] text-white/80" value={draft.brief} onChange={(event) => update({ brief: event.target.value })} placeholder="Describe the deliverable and success criteria" />
        </Field>
      ) : null}
      {draft.type === 'workflow-run' ? <WorkflowInputs draft={draft} onChange={onChange} /> : null}
      {draft.type === 'social-publish' ? (
        <>
          <Field label={draft.platform === 'youtube' ? 'Title' : 'Caption'}>
            <Textarea className="min-h-24 border-white/[0.08] bg-white/[0.025] text-white/80" value={draft.caption} onChange={(event) => update({ caption: event.target.value })} placeholder={draft.platform === 'youtube' ? 'Final video title' : 'Final post text'} />
          </Field>
          {draft.platform === 'youtube' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Post type">
                <select className={INPUT_CLASS} value={String(draft.platformOptions.postType ?? 'video')} onChange={(event) => update({ platformOptions: { ...draft.platformOptions, postType: event.target.value } })}>
                  <option value="video">Video</option>
                  <option value="short" disabled>Short (not yet verifiable)</option>
                </select>
              </Field>
              <Field label="Visibility">
                <select className={INPUT_CLASS} value={String(draft.platformOptions.visibility ?? 'private')} onChange={(event) => update({ platformOptions: { ...draft.platformOptions, visibility: event.target.value } })}>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </Field>
              <Field label="Made for kids">
                <select className={INPUT_CLASS} value={String(draft.platformOptions.madeForKids ?? 'no')} onChange={(event) => update({ platformOptions: { ...draft.platformOptions, madeForKids: event.target.value } })}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </Field>
            </div>
          ) : null}
        </>
      ) : null}
      {workDraft ? (
        <InputReferencePicker
          selected={workDraft.inputRefs}
          outputs={outputs}
          vaultAssets={vaultAssets}
          releaseKitItems={releaseKitItems}
          loading={loading}
          single={socialOrReview}
          includeVault={!socialOrReview}
          releaseKitOnly={draft.type === 'social-publish' && draft.owner.scope === 'campaign'}
          onChange={(inputRefs) => onChange({ ...workDraft, inputRefs } as ScheduledWorkComposerDraft)}
        />
      ) : null}
      {draft.type === 'agent-task' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deliverable">
            <select className={INPUT_CLASS} value={draft.expectedOutput.requirement} onChange={(event) => update({ expectedOutput: { ...draft.expectedOutput, requirement: event.target.value } })}>
              <option value="none">No required Output</option>
              <option value="optional">Optional Output</option>
              <option value="required">Required Output</option>
            </select>
          </Field>
          {draft.expectedOutput.requirement !== 'none' ? (
            <Field label="Output kind">
              <select className={INPUT_CLASS} value={draft.expectedOutput.kind ?? ''} onChange={(event) => update({ expectedOutput: { ...draft.expectedOutput, kind: event.target.value || undefined } })}>
                <option value="">Any Output</option>
                {['report', 'document', 'image', 'video', 'audio', 'dataset', 'code', 'receipt', 'other'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </Field>
          ) : <div />}
          {draft.expectedOutput.requirement !== 'none' ? (
            <Field label="Output title">
              <input className={INPUT_CLASS} value={draft.expectedOutput.title ?? ''} onChange={(event) => update({ expectedOutput: { ...draft.expectedOutput, title: event.target.value || undefined } })} placeholder="Optional" />
            </Field>
          ) : null}
        </div>
      ) : null}
      <Field label="Notes">
        <Textarea className="min-h-16 border-white/[0.08] bg-white/[0.025] text-white/80" value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Optional" />
      </Field>
    </div>
  )
}

function WorkflowInputs({ draft, onChange }: {
  draft: Extract<ScheduledWorkComposerDraft, { type: 'workflow-run' }>
  onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>>
}) {
  const { activeWorkflows } = useWorkflows(draft.owner.workspaceId)
  const workflow = activeWorkflows.find((candidate) => candidate.slug === draft.workflowSlug)
  if (!workflow) return <EmptyLine>Choose a workflow first.</EmptyLine>
  return (
    <div className="space-y-3">
      {(workflow.metadata.trigger.inputs ?? []).map((input) => (
        <Field key={input.name} label={input.name} hint={input.description}>
          {input.type === 'boolean' ? (
            <label className="flex h-10 items-center gap-2 text-sm text-white/68">
              <input type="checkbox" checked={Boolean(draft.triggerInputs[input.name])} onChange={(event) => onChange({ ...draft, triggerInputs: { ...draft.triggerInputs, [input.name]: event.target.checked } })} />
              Enabled
            </label>
          ) : (
            <input
              className={INPUT_CLASS}
              type={input.type === 'number' ? 'number' : 'text'}
              min={input.type === 'number' ? input.min : undefined}
              max={input.type === 'number'
                ? (input.maxFrom && typeof draft.triggerInputs[input.maxFrom] === 'number'
                    ? Math.min(input.max ?? Number.POSITIVE_INFINITY, draft.triggerInputs[input.maxFrom] as number)
                    : input.max)
                : undefined}
              step={input.type === 'number' ? (input.integer ? 1 : 'any') : undefined}
              value={String(draft.triggerInputs[input.name] ?? '')}
              onChange={(event) => onChange({ ...draft, triggerInputs: { ...draft.triggerInputs, [input.name]: input.type === 'number' ? Number(event.target.value) : event.target.value } })}
              required={input.required}
            />
          )}
        </Field>
      ))}
    </div>
  )
}

function InputReferencePicker({ selected, outputs, vaultAssets, releaseKitItems, loading, single, includeVault, releaseKitOnly, onChange }: {
  selected: ScheduledWorkInputRef[]
  outputs: OutputSummaryDTO[]
  vaultAssets: VaultAssetRecord[]
  releaseKitItems: ReleaseKitItem[]
  loading: boolean
  single: boolean
  includeVault: boolean
  releaseKitOnly: boolean
  onChange: (refs: ScheduledWorkInputRef[]) => void
}) {
  const releaseKitChoices = releaseKitItems.map((item) => {
    const ref = { kind: 'release-kit' as const, itemId: item.id, sha256: item.sha256, label: item.title }
    return { id: inputRefId(ref), label: `Release Kit · ${item.title}`, ref }
  })
  const legacyChoices = [
    ...outputs.flatMap((output) => {
      const refs = [
        ...(output.finals ?? []).map((final) => ({ label: `${final.isPrimary ? 'Primary Final' : 'Final'} · ${output.title}`, ref: { kind: 'final' as const, outputId: output.id, assetId: final.assetId, slot: final.slot, label: output.title } })),
        { label: `Output · ${output.title}`, ref: { kind: 'output' as const, outputId: output.id, title: output.title, outputKind: output.kind } },
      ]
      return refs.map((choice) => ({ ...choice, id: inputRefId(choice.ref) }))
    }),
    ...(includeVault ? vaultAssets : []).map((asset) => {
      const ref = { kind: 'vault' as const, assetId: asset.id, label: asset.label, assetKind: asset.kind }
      return { id: inputRefId(ref), label: `Vault · ${asset.label}`, ref }
    }),
  ]
  const choices = releaseKitOnly ? releaseKitChoices : [...releaseKitChoices, ...legacyChoices]
  const selectedIds = new Set(selected.map(inputRefId))
  return (
    <Field label="Inputs">
      {loading ? <EmptyLine>Loading assets...</EmptyLine> : choices.length === 0 ? <EmptyLine>{releaseKitOnly ? 'No ready Release Kit items available.' : 'No Release Kit items, Outputs, Finals, or Vault assets available.'}</EmptyLine> : (
        <div className="max-h-44 overflow-y-auto border-y border-white/[0.06]">
          {choices.map((choice) => (
            <button key={choice.id} type="button" onClick={() => {
              if (selectedIds.has(choice.id)) onChange(selected.filter((ref) => inputRefId(ref) !== choice.id))
              else onChange(single ? [choice.ref] : [...selected, choice.ref])
            }} className="flex w-full items-center gap-2 border-b border-white/[0.04] px-2 py-2 text-left text-xs text-white/62 last:border-b-0 hover:bg-white/[0.025]">
              <span className={cn('flex size-4 items-center justify-center rounded-[3px] border', selectedIds.has(choice.id) ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-200' : 'border-white/15')}>
                {selectedIds.has(choice.id) ? <Check className="h-3 w-3" /> : null}
              </span>
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

function TimingSection({ draft, onChange }: { draft: ScheduledWorkComposerDraft; onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>> }) {
  const update = (patch: Record<string, unknown>) => onChange((current) => ({ ...current, ...patch }) as ScheduledWorkComposerDraft)
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={draft.type === 'event' ? 'Date' : timingLabel(draft.type)}><input type="date" className={INPUT_CLASS} value={draft.date} onChange={(event) => update({ date: event.target.value })} /></Field>
      <Field label={draft.type === 'event' ? 'Starts' : 'Start time'}><TimePicker value={draft.time} onChange={(time) => update({ time })} /></Field>
      {draft.type === 'event' ? <Field label="Ends"><TimePicker value={draft.endTime} onChange={(endTime) => update({ endTime })} /></Field> : null}
      {draft.type === 'review' ? (
        <>
          <Field label="Decision due"><input type="date" className={INPUT_CLASS} value={draft.dueDate} onChange={(event) => update({ dueDate: event.target.value })} /></Field>
          <Field label="Due time"><TimePicker value={draft.dueTime} onChange={(dueTime) => update({ dueTime })} /></Field>
        </>
      ) : null}
      <div className="col-span-2 text-[11px] text-white/34">{draft.timezone}</div>
    </div>
  )
}

function TimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [rawHour = '', rawMinute = '00'] = value.split(':')
  const hour24 = Number(rawHour)
  const hasTime = /^\d{2}:\d{2}$/.test(value)
  const hour12 = hasTime ? String(hour24 % 12 || 12) : ''
  const period = hasTime && hour24 >= 12 ? 'PM' : 'AM'
  const minuteOptions = React.useMemo(() => {
    const options = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'))
    if (hasTime && !options.includes(rawMinute)) options.push(rawMinute)
    return options.sort()
  }, [hasTime, rawMinute])
  const commit = (nextHour: string, nextMinute = rawMinute, nextPeriod = period) => {
    if (!nextHour) {
      onChange('')
      return
    }
    const baseHour = Number(nextHour) % 12
    const nextHour24 = baseHour + (nextPeriod === 'PM' ? 12 : 0)
    onChange(`${String(nextHour24).padStart(2, '0')}:${nextMinute || '00'}`)
  }

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
      <select aria-label="Hour" className={INPUT_CLASS} value={hour12} onChange={(event) => commit(event.target.value, rawMinute || '00', period)}>
        <option value="">Hour</option>
        {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
      </select>
      <select aria-label="Minute" className={INPUT_CLASS} value={hasTime ? rawMinute : '00'} disabled={!hasTime} onChange={(event) => commit(hour12, event.target.value, period)}>
        {minuteOptions.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
      </select>
      <div className="flex h-10 overflow-hidden rounded-[6px] border border-white/[0.08] bg-white/[0.025]">
        {(['AM', 'PM'] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={!hasTime}
            onClick={() => commit(hour12, rawMinute, option)}
            className={cn('min-w-10 px-2 text-xs font-medium transition-colors disabled:opacity-30', period === option && hasTime ? 'bg-white/12 text-white' : 'text-white/42 hover:bg-white/[0.05]')}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function SafeguardsSection({ draft, onChange }: { draft: Exclude<ScheduledWorkComposerDraft, { type: 'event' }>; onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>> }) {
  if (draft.type === 'social-publish') return <EmptyLine icon={ShieldCheck}>Exact approval will be required near publish time.</EmptyLine>
  if (draft.type === 'agent-task') {
    return (
      <div className="grid grid-cols-2 gap-2">
        {(['safe', 'ask'] as const).map((mode) => (
          <button key={mode} type="button" onClick={() => onChange({ ...draft, permissionMode: mode })} className={cn('h-10 rounded-[6px] border text-xs', draft.permissionMode === mode ? 'border-white/25 bg-white/10 text-white/80' : 'border-white/[0.07] text-white/42')}>
            {mode === 'safe' ? 'Run automatically' : 'Ask before starting'}
          </button>
        ))}
      </div>
    )
  }
  return <EmptyLine icon={ShieldCheck}>{draft.type === 'review' ? 'A recorded decision is required.' : 'The workflow must finish successfully.'}</EmptyLine>
}

function ThenSection({ draft, agents, workflows, profiles, onChange }: {
  draft: Exclude<ScheduledWorkComposerDraft, { type: 'event' }>
  agents: ReturnType<typeof useAgents>['activeAgents']
  workflows: WorkflowDTO[]
  profiles: SocialProfile[]
  onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>>
}) {
  const allowed: Array<ScheduledWorkComposerFollowUp['type']> = draft.type === 'agent-task'
    ? ['none', 'review', 'workflow-run']
    : draft.type === 'workflow-run'
      ? ['none', 'review']
      : draft.type === 'review'
        ? ['none', 'social-publish']
        : ['none']
  const choose = (type: ScheduledWorkComposerFollowUp['type']) => {
    let followUp: ScheduledWorkComposerFollowUp = { type: 'none' }
    if (type === 'review') followUp = { type, reviewerType: 'user', reviewerId: '', reviewerName: 'You' }
    if (type === 'workflow-run') followUp = { type, workflowSlug: '', workflowName: '', workflowDigest: '', triggerInputs: {}, outputInput: '' }
    if (type === 'social-publish') followUp = { type, platform: '', profileId: '', profileLabel: '', accountSetId: '', caption: '', platformOptions: {} }
    onChange({ ...draft, followUp } as ScheduledWorkComposerDraft)
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {allowed.map((type) => (
          <button key={type} type="button" onClick={() => choose(type)} className={cn('min-h-10 rounded-[6px] border px-3 text-xs font-medium', draft.followUp.type === type ? 'border-white/24 bg-white/10 text-white/80' : 'border-white/[0.07] text-white/42')}>
            {type === 'none' ? 'No follow-up' : type === 'review' ? 'Request review' : type === 'workflow-run' ? 'Run workflow' : 'Publish to social'}
          </button>
        ))}
      </div>
      {draft.followUp.type === 'review' ? (
        <>
          <ChoiceList
            choices={[{ id: 'user', label: 'You', description: 'Decision stays in RunnerOS' }, ...agents.map((agent) => ({ id: `agent:${agent.slug}`, label: agent.metadata.name, description: agent.metadata.description }))]}
            selected={draft.followUp.reviewerType === 'user' ? 'user' : `agent:${draft.followUp.reviewerId}`}
            empty="No reviewers available."
            onSelect={(id) => {
              const followUp = id === 'user'
                ? { ...draft.followUp, reviewerType: 'user' as const, reviewerId: '', reviewerName: 'You' }
                : { ...draft.followUp, reviewerType: 'agent' as const, reviewerId: id.slice(6), reviewerName: agents.find((agent) => agent.slug === id.slice(6))?.metadata.name ?? id.slice(6) }
              onChange({ ...draft, followUp } as ScheduledWorkComposerDraft)
            }}
          />
          <OutputKindSelector value={draft.followUp.outputKind} onChange={(outputKind) => onChange({ ...draft, followUp: { ...draft.followUp, outputKind } } as ScheduledWorkComposerDraft)} />
        </>
      ) : null}
      {draft.followUp.type === 'workflow-run' ? (
        <>
          <ChoiceList choices={workflows.map((workflow) => ({ id: workflow.slug, label: workflow.metadata.name, description: `${workflow.metadata.steps.length} steps · ${workflow.metadata.description}` }))} selected={draft.followUp.workflowSlug} empty="No active workflows." onSelect={(id) => {
            const workflow = workflows.find((candidate) => candidate.slug === id)
            if (!workflow || draft.followUp.type !== 'workflow-run') return
            const inputs = workflow.metadata.trigger.inputs ?? []
            onChange({ ...draft, followUp: { ...draft.followUp, workflowSlug: workflow.slug, workflowName: workflow.metadata.name, workflowDigest: composerDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }), triggerInputs: Object.fromEntries(inputs.map((input) => [input.name, input.default ?? defaultTriggerValue(input.type)])), outputInput: inputs[0]?.name ?? '' } } as ScheduledWorkComposerDraft)
          }} />
          {(() => {
            const workflowSlug = draft.followUp.type === 'workflow-run' ? draft.followUp.workflowSlug : ''
            const workflow = workflows.find((candidate) => candidate.slug === workflowSlug)
            const inputs = workflow?.metadata.trigger.inputs ?? []
            return inputs.length ? <Field label="Use produced Output as"><select className={INPUT_CLASS} value={draft.followUp.type === 'workflow-run' ? draft.followUp.outputInput : ''} onChange={(event) => draft.followUp.type === 'workflow-run' && onChange({ ...draft, followUp: { ...draft.followUp, outputInput: event.target.value } } as ScheduledWorkComposerDraft)}>{inputs.map((input) => <option key={input.name} value={input.name}>{input.name}</option>)}</select></Field> : <EmptyLine>The workflow needs a trigger input for the produced Output.</EmptyLine>
          })()}
          <OutputKindSelector value={draft.followUp.outputKind} onChange={(outputKind) => onChange({ ...draft, followUp: { ...draft.followUp, outputKind } } as ScheduledWorkComposerDraft)} />
        </>
      ) : null}
      {draft.followUp.type === 'social-publish' ? (
        <>
          <ChoiceList choices={profiles.map((profile) => ({ id: `${profile.platform}/${profile.profileId}`, label: profile.label, description: profile.ready ? 'Ready' : 'Login or setup required', disabled: !profile.ready }))} selected={draft.followUp.profileId ? `${draft.followUp.platform}/${draft.followUp.profileId}` : ''} empty="No social profiles configured." onSelect={(id) => {
            const profile = profiles.find((candidate) => `${candidate.platform}/${candidate.profileId}` === id)
            if (!profile || draft.followUp.type !== 'social-publish') return
            onChange({ ...draft, followUp: { ...draft.followUp, platform: profile.platform, profileId: profile.profileId, profileLabel: profile.label, accountSetId: profile.accountSetId, platformOptions: defaultSocialPlatformOptions(profile.platform) } } as ScheduledWorkComposerDraft)
          }} />
          <Field label={draft.followUp.platform === 'youtube' ? 'Title' : 'Caption'}><Textarea className="min-h-20 border-white/[0.08] bg-white/[0.025] text-white/80" value={draft.followUp.caption} onChange={(event) => draft.followUp.type === 'social-publish' && onChange({ ...draft, followUp: { ...draft.followUp, caption: event.target.value } } as ScheduledWorkComposerDraft)} /></Field>
          {draft.followUp.platform === 'youtube' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Post type"><select className={INPUT_CLASS} value={String(draft.followUp.platformOptions.postType ?? 'video')} onChange={(event) => draft.followUp.type === 'social-publish' && onChange({ ...draft, followUp: { ...draft.followUp, platformOptions: { ...draft.followUp.platformOptions, postType: event.target.value } } } as ScheduledWorkComposerDraft)}><option value="video">Video</option><option value="short" disabled>Short (not yet verifiable)</option></select></Field>
              <Field label="Visibility"><select className={INPUT_CLASS} value={String(draft.followUp.platformOptions.visibility ?? 'private')} onChange={(event) => draft.followUp.type === 'social-publish' && onChange({ ...draft, followUp: { ...draft.followUp, platformOptions: { ...draft.followUp.platformOptions, visibility: event.target.value } } } as ScheduledWorkComposerDraft)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></Field>
              <Field label="Made for kids"><select className={INPUT_CLASS} value={String(draft.followUp.platformOptions.madeForKids ?? 'no')} onChange={(event) => draft.followUp.type === 'social-publish' && onChange({ ...draft, followUp: { ...draft.followUp, platformOptions: { ...draft.followUp.platformOptions, madeForKids: event.target.value } } } as ScheduledWorkComposerDraft)}><option value="no">No</option><option value="yes">Yes</option></select></Field>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function OutputKindSelector({ value, onChange }: { value?: OutputKind; onChange: (value: OutputKind | undefined) => void }) {
  return <Field label="Produced Output kind"><select className={INPUT_CLASS} value={value ?? ''} onChange={(event) => onChange((event.target.value || undefined) as OutputKind | undefined)}><option value="">Any kind (must resolve exactly once)</option>{['report', 'document', 'image', 'video', 'audio', 'dataset', 'code', 'receipt', 'other'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></Field>
}

function defaultSocialPlatformOptions(platform: string): Record<string, unknown> {
  return platform === 'youtube' ? { postType: 'video', visibility: 'private', madeForKids: 'no' } : {}
}

function ChoiceList({ choices, selected, empty, onSelect }: { choices: Array<{ id: string; label: string; description: string; disabled?: boolean }>; selected: string; empty: string; onSelect: (id: string) => void }) {
  if (choices.length === 0) return <EmptyLine>{empty}</EmptyLine>
  return (
    <div className="divide-y divide-white/[0.05] border-y border-white/[0.06]">
      {choices.map((choice) => (
        <button key={choice.id} type="button" disabled={choice.disabled} onClick={() => onSelect(choice.id)} className="flex w-full items-center gap-3 px-2 py-3 text-left disabled:opacity-35">
          <span className={cn('flex size-4 items-center justify-center rounded-full border', selected === choice.id ? 'border-emerald-300/50 bg-emerald-300/15' : 'border-white/15')}>
            {selected === choice.id ? <span className="size-1.5 rounded-full bg-emerald-200" /> : null}
          </span>
          <div className="min-w-0">
            <div className="text-sm text-white/74">{choice.label}</div>
            <div className="mt-0.5 line-clamp-2 text-xs text-white/34">{choice.description}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-white/46">{label}</span>{children}{hint ? <span className="mt-1 block text-[10px] text-white/30">{hint}</span> : null}</label>
}

function EmptyLine({ icon: Icon = FileOutput, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <div className="flex min-h-12 items-center gap-2 border-y border-white/[0.06] px-2 text-xs text-white/38"><Icon className="h-4 w-4" />{children}</div>
}

function visibleSections(draft: ScheduledWorkComposerDraft, allowFollowUps: boolean, timingMode: 'scheduled' | 'triggered'): ComposerSection[] {
  if (draft.type === 'event') return timingMode === 'triggered' ? ['inputs'] : ['inputs', 'timing']
  const sections: ComposerSection[] = draft.type === 'agent-task'
    ? ['what', 'inputs', 'runner']
    : ['what', 'runner', 'inputs']
  if (timingMode === 'scheduled') sections.push('timing')
  if (allowFollowUps && draft.type !== 'social-publish') sections.push('then')
  sections.push('safeguards')
  return sections
}

function initialSection(entry: ScheduledWorkComposerEntry): ComposerSection {
  if (entry.mode === 'job' && !entry.suggestedType) return 'what'
  if (entry.suggestedType === 'event') return 'inputs'
  if (entry.suggestedType) return 'runner'
  return 'what'
}

function createEntryDraft(entry: ScheduledWorkComposerEntry): ScheduledWorkComposerDraft {
  return createScheduledWorkComposerDraft(
    entry.mode === 'job' && !entry.suggestedType
      ? { ...entry, suggestedType: 'agent-task' }
      : entry,
  )
}

function sectionTitle(section: ComposerSection, draft: ScheduledWorkComposerDraft): string {
  if (section === 'what') return 'Choose a job type'
  if (section === 'runner') {
    if (draft.type === 'agent-task') return 'Choose an agent'
    if (draft.type === 'workflow-run') return 'Choose a workflow'
    if (draft.type === 'social-publish') return 'Choose a social profile'
    return 'Choose a reviewer'
  }
  if (section === 'inputs') {
    if (draft.type === 'event') return 'Event details'
    if (draft.type === 'agent-task') return 'What should it produce?'
    if (draft.type === 'workflow-run') return 'What should the workflow use?'
    if (draft.type === 'social-publish') return 'What should be published?'
    return 'What needs review?'
  }
  if (section === 'timing') return 'When should it happen?'
  if (section === 'then') return 'Then'
  return 'Safeguards'
}

function timingLabel(type: Exclude<ScheduledWorkComposerType, 'event'>): string {
  if (type === 'agent-task') return 'Start work at'
  if (type === 'workflow-run') return 'Run at'
  if (type === 'social-publish') return 'Publish at'
  return 'Request review at'
}

function inputRefId(ref: ScheduledWorkInputRef): string {
  if (ref.kind === 'release-kit') return `release-kit:${ref.itemId}:${ref.sha256}`
  if (ref.kind === 'final') return `final:${ref.outputId}:${ref.assetId ?? ref.slot ?? ''}`
  if (ref.kind === 'output') return `output:${ref.outputId}`
  if (ref.kind === 'vault') return `vault:${ref.assetId}`
  return `produced-output:${ref.stepId}`
}

function defaultTriggerValue(type: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}

function validateLiveTarget(
  draft: ScheduledWorkComposerDraft,
  activeAgents: ReturnType<typeof useAgents>['activeAgents'],
  activeWorkflows: WorkflowDTO[],
  profiles: SocialProfile[],
): string | undefined {
  if (draft.type === 'agent-task' && !activeAgents.some((agent) => agent.slug === draft.agentSlug)) {
    return 'That agent is no longer active. Choose another agent.'
  }
  if (draft.type === 'workflow-run') {
    const workflow = activeWorkflows.find((candidate) => candidate.slug === draft.workflowSlug)
    if (!workflow) return 'That workflow is no longer active. Choose another workflow.'
    const currentDigest = composerDefinitionDigest({ metadata: workflow.metadata, body: workflow.body })
    if (currentDigest !== draft.workflowDigest) return 'That workflow changed. Choose it again to review the latest version.'
    const missing = (workflow.metadata.trigger.inputs ?? []).find((input) => {
      if (!input.required) return false
      const value = draft.triggerInputs[input.name]
      return value === undefined || value === null || (typeof value === 'string' && !value.trim())
    })
    if (missing) return `Add ${missing.name} before scheduling this workflow.`
  }
  if (draft.type === 'social-publish') {
    const profile = profiles.find((candidate) => candidate.platform === draft.platform && candidate.profileId === draft.profileId)
    if (!profile?.ready) return 'That social profile is no longer ready. Choose another profile or fix its login.'
  }
  return undefined
}

function validateSection(
  draft: ScheduledWorkComposerDraft,
  section: ComposerSection,
  activeAgents: ReturnType<typeof useAgents>['activeAgents'],
  activeWorkflows: WorkflowDTO[],
  profiles: SocialProfile[],
): string | undefined {
  const sectionError = validateComposerSection(draft, section)
  if (sectionError) return sectionError
  if (section === 'runner' || (section === 'inputs' && draft.type === 'workflow-run')) {
    return validateLiveTarget(draft, activeAgents, activeWorkflows, profiles)
  }
  return undefined
}
