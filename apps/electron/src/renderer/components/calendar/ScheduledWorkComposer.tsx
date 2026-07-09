import * as React from 'react'
import {
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  FileOutput,
  Send,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import type { ScheduledWorkInputRef, ScheduledWorkOwner } from '@craft-agent/shared/scheduled-work'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'
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
  type ScheduledWorkComposerDraft,
  type ScheduledWorkComposerType,
} from '@/lib/scheduled-work-composer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export interface ScheduledWorkComposerEntry {
  owner: ScheduledWorkOwner
  date: string
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
}

type ComposerSection = 'what' | 'runner' | 'inputs' | 'timing' | 'safeguards'
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

export function ScheduledWorkComposer({ open, entry, disabled, onOpenChange, onSubmit }: ScheduledWorkComposerProps) {
  const [draft, setDraft] = React.useState(() => createScheduledWorkComposerDraft(entry))
  const [section, setSection] = React.useState<ComposerSection>('what')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [profiles, setProfiles] = React.useState<SocialProfile[]>([])
  const [vaultAssets, setVaultAssets] = React.useState<VaultAssetRecord[]>([])
  const [explicitActiveAgentSlugs, setExplicitActiveAgentSlugs] = React.useState<string[]>([])
  const { allAgents, loading: agentsLoading } = useAgents(entry.owner.workspaceId)
  const activeAgents = React.useMemo(
    () => allAgents.filter((agent) => explicitActiveAgentSlugs.includes(agent.slug)),
    [allAgents, explicitActiveAgentSlugs],
  )
  const { activeWorkflows, loading: workflowsLoading } = useWorkflows(entry.owner.workspaceId)
  const { outputs, loading: outputsLoading } = useOutputs(entry.owner.workspaceId)

  React.useEffect(() => {
    if (!open) return
    setDraft(createScheduledWorkComposerDraft(entry))
    setSection('what')
    setError(null)
  }, [entry, open])

  React.useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all([
      window.electronAPI.listSocialAccounts(),
      window.electronAPI.getArtistVaultManifest(entry.owner.workspaceId),
      window.electronAPI.listActiveAgentDefinitions(entry.owner.workspaceId),
    ]).then(([doctor, manifest, activeSlugs]) => {
      if (!active) return
      setProfiles(doctor.platforms.flatMap((group) => group.profiles.map((profile) => ({
        platform: profile.platform,
        profileId: profile.profile,
        label: `${profile.platform} @${profile.profile}`,
        accountSetId: profile.accountGroup ?? '',
        ready: profile.ready,
      }))))
      setVaultAssets(manifest.assets.filter((asset) => asset.status !== 'missing' && asset.status !== 'archived'))
      setExplicitActiveAgentSlugs(activeSlugs)
    }).catch(() => {
      if (!active) return
      setProfiles([])
      setVaultAssets([])
      setExplicitActiveAgentSlugs([])
    })
    return () => { active = false }
  }, [entry.owner.workspaceId, open])

  const chooseType = React.useCallback((type: ScheduledWorkComposerType) => {
    setDraft((current) => selectScheduledWorkComposerType(current, type))
    setSection(type === 'event' ? 'inputs' : 'runner')
    setError(null)
  }, [])

  const submit = React.useCallback(async () => {
    const validationError = validateComposerDraft(draft)
      ?? validateLiveTarget(draft, activeAgents, activeWorkflows, profiles)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(draft)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setBusy(false)
    }
  }, [activeAgents, activeWorkflows, draft, onOpenChange, onSubmit, profiles])

  const sections = visibleSections(draft)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] w-[min(620px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-white/[0.08] bg-[#090909] p-0 text-white shadow-modal-small max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-screen max-sm:rounded-none"
      >
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold tracking-normal">Schedule</DialogTitle>
          <DialogDescription className="sr-only">Create a calendar event or queue executable work.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {sections.map((item) => (
            <ComposerSectionRow
              key={item}
              section={item}
              active={section === item}
              title={sectionTitle(item)}
              summary={sectionSummary(item, draft)}
              onOpen={() => setSection(item)}
            >
              {item === 'what' ? <QueueTypeList draft={draft} onChoose={chooseType} /> : null}
              {item === 'runner' && draft.type !== 'event' ? (
                <RunnerSection
                  draft={draft}
                  agents={activeAgents}
                  workflows={activeWorkflows}
                  profiles={profiles}
                  loading={agentsLoading || workflowsLoading}
                  onChange={setDraft}
                />
              ) : null}
              {item === 'inputs' ? (
                <InputsSection
                  draft={draft}
                  outputs={outputs}
                  vaultAssets={vaultAssets}
                  loading={outputsLoading}
                  onChange={setDraft}
                />
              ) : null}
              {item === 'timing' ? <TimingSection draft={draft} onChange={setDraft} /> : null}
              {item === 'safeguards' && draft.type !== 'event' ? <SafeguardsSection draft={draft} onChange={setDraft} /> : null}
            </ComposerSectionRow>
          ))}
        </div>

        <div className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0b] px-5 py-4">
          <p className="mb-3 text-xs leading-5 text-white/48">{composerReviewSentence(draft)}</p>
          {error ? <p className="mb-3 text-xs text-red-300/80">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={submit} disabled={disabled || busy}>{busy ? 'Saving...' : draft.type === 'event' ? 'Add event' : 'Queue work'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ComposerSectionRow({ section, active, title, summary, onOpen, children }: {
  section: ComposerSection
  active: boolean
  title: string
  summary: string
  onOpen: () => void
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-white/[0.06] last:border-b-0" data-composer-section={section}>
      <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 py-3 text-left">
        <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px]', active ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-white/45')}>
          {active ? <ChevronRight className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-white/82">{title}</div>
          {!active && summary ? <div className="mt-0.5 truncate text-[11px] text-white/38">{summary}</div> : null}
        </div>
      </button>
      {active ? <div className="pb-5 pl-9">{children}</div> : null}
    </section>
  )
}

function QueueTypeList({ draft, onChoose }: { draft: ScheduledWorkComposerDraft; onChoose: (type: ScheduledWorkComposerType) => void }) {
  return (
    <div className="divide-y divide-white/[0.05]">
      {QUEUE_OPTIONS.map((option) => {
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
            {draft.type === option.type ? <Check className="h-4 w-4 text-emerald-300/70" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function RunnerSection({ draft, agents, workflows, profiles, loading, onChange }: {
  draft: Exclude<ScheduledWorkComposerDraft, { type: 'event' }>
  agents: ReturnType<typeof useAgents>['activeAgents']
  workflows: WorkflowDTO[]
  profiles: SocialProfile[]
  loading: boolean
  onChange: React.Dispatch<React.SetStateAction<ScheduledWorkComposerDraft>>
}) {
  if (loading) return <EmptyLine>Loading available targets...</EmptyLine>
  if (draft.type === 'agent-task') {
    return <ChoiceList choices={agents.map((agent) => ({ id: agent.slug, label: agent.metadata.name, description: agent.metadata.description }))} selected={draft.agentSlug} empty="No active agents. Activate one from Agents." onSelect={(id) => {
      const agent = agents.find((candidate) => candidate.slug === id)
      onChange({ ...draft, agentSlug: id, agentName: agent?.metadata.name ?? id })
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
    }} />
  }
  if (draft.type === 'social-publish') {
    return <ChoiceList choices={profiles.map((profile) => ({ id: `${profile.platform}/${profile.profileId}`, label: profile.label, description: profile.ready ? 'Ready' : 'Login or setup required', disabled: !profile.ready }))} selected={draft.profileId ? `${draft.platform}/${draft.profileId}` : ''} empty="No social profiles configured." onSelect={(id) => {
      const profile = profiles.find((candidate) => `${candidate.platform}/${candidate.profileId}` === id)
      if (!profile) return
      onChange({ ...draft, platform: profile.platform, profileId: profile.profileId, profileLabel: profile.label, accountSetId: profile.accountSetId })
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
      }}
    />
  )
}

function InputsSection({ draft, outputs, vaultAssets, loading, onChange }: {
  draft: ScheduledWorkComposerDraft
  outputs: OutputSummaryDTO[]
  vaultAssets: VaultAssetRecord[]
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
        <Field label="Caption">
          <Textarea className="min-h-24 border-white/[0.08] bg-white/[0.025] text-white/80" value={draft.caption} onChange={(event) => update({ caption: event.target.value })} placeholder="Final post text" />
        </Field>
      ) : null}
      {workDraft ? (
        <InputReferencePicker
          selected={workDraft.inputRefs}
          outputs={outputs}
          vaultAssets={vaultAssets}
          loading={loading}
          single={socialOrReview}
          includeVault={!socialOrReview}
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

function InputReferencePicker({ selected, outputs, vaultAssets, loading, single, includeVault, onChange }: {
  selected: ScheduledWorkInputRef[]
  outputs: OutputSummaryDTO[]
  vaultAssets: VaultAssetRecord[]
  loading: boolean
  single: boolean
  includeVault: boolean
  onChange: (refs: ScheduledWorkInputRef[]) => void
}) {
  const choices = [
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
  const selectedIds = new Set(selected.map(inputRefId))
  return (
    <Field label="Inputs">
      {loading ? <EmptyLine>Loading Outputs...</EmptyLine> : choices.length === 0 ? <EmptyLine>No Outputs, Finals, or Vault assets available.</EmptyLine> : (
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
      <Field label={draft.type === 'event' ? 'Starts' : timingLabel(draft.type)}><input type="date" className={INPUT_CLASS} value={draft.date} onChange={(event) => update({ date: event.target.value })} /></Field>
      <Field label="Time"><input type="time" className={INPUT_CLASS} value={draft.time} onChange={(event) => update({ time: event.target.value })} /></Field>
      {draft.type === 'event' ? <Field label="Ends"><input type="time" className={INPUT_CLASS} value={draft.endTime} onChange={(event) => update({ endTime: event.target.value })} /></Field> : null}
      {draft.type === 'agent-task' || draft.type === 'review' ? (
        <>
          <Field label={draft.type === 'review' ? 'Decision due' : 'Due date'}><input type="date" className={INPUT_CLASS} value={draft.dueDate} onChange={(event) => update({ dueDate: event.target.value })} /></Field>
          <Field label="Due time"><input type="time" className={INPUT_CLASS} value={draft.dueTime} onChange={(event) => update({ dueTime: event.target.value })} /></Field>
        </>
      ) : null}
      <div className="col-span-2 text-[11px] text-white/34">{draft.timezone}</div>
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

function visibleSections(draft: ScheduledWorkComposerDraft): ComposerSection[] {
  return draft.type === 'event' ? ['what', 'inputs', 'timing'] : ['what', 'runner', 'inputs', 'timing', 'safeguards']
}

function sectionTitle(section: ComposerSection): string {
  if (section === 'what') return 'What should happen?'
  if (section === 'runner') return 'Who or what should do it?'
  if (section === 'inputs') return 'What should it use or produce?'
  if (section === 'timing') return 'When should it happen?'
  return 'Safeguards'
}

function sectionSummary(section: ComposerSection, draft: ScheduledWorkComposerDraft): string {
  if (section === 'what') return QUEUE_OPTIONS.find((option) => option.type === draft.type)?.label ?? ''
  if (section === 'runner') {
    if (draft.type === 'agent-task') return draft.agentName || 'Choose agent'
    if (draft.type === 'workflow-run') return draft.workflowName || 'Choose workflow'
    if (draft.type === 'social-publish') return draft.profileLabel || 'Choose profile'
    if (draft.type === 'review') return draft.reviewerName || 'Choose reviewer'
  }
  if (section === 'inputs') {
    if (draft.type === 'event') return draft.title || 'Add details'
    return `${draft.title || 'Add details'}${draft.inputRefs.length ? ` · ${draft.inputRefs.length} input${draft.inputRefs.length === 1 ? '' : 's'}` : ''}`
  }
  if (section === 'timing') return `${draft.date}${draft.time ? ` at ${draft.time}` : ''}`
  if (draft.type === 'agent-task') return draft.permissionMode === 'safe' ? 'Run automatically' : 'Ask before starting'
  if (draft.type === 'social-publish') return 'Exact approval required'
  return 'Completion required'
}

function timingLabel(type: Exclude<ScheduledWorkComposerType, 'event'>): string {
  if (type === 'agent-task') return 'Start work at'
  if (type === 'workflow-run') return 'Run at'
  if (type === 'social-publish') return 'Publish at'
  return 'Request review at'
}

function inputRefId(ref: ScheduledWorkInputRef): string {
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
