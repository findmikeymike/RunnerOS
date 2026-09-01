import * as React from 'react'
import { CalendarClock, ChevronDown, FolderOpen, Repeat2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ScheduledWorkComposer, type ScheduledWorkComposerEntry } from '@/components/calendar/ScheduledWorkComposer'
import { AutomationWorkDialog } from '@/components/automations/AutomationWorkDialog'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useOutputs } from '@/hooks/useOutputs'
import { useAppShellContext } from '@/context/AppShellContext'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { cn } from '@/lib/utils'
import {
  humanizeWorkflowInputName,
  orderWorkflowInputs,
  validateWorkflowInputValues,
  workflowInputControl,
  workflowNumberMax,
  workflowOutputAssetPath,
} from '@/lib/workflow-input-presentation'
import {
  buildCampaignSchedulePlanFromComposer,
  buildHqSchedulePlanFromComposer,
  composerDefinitionDigest,
  type ScheduledWorkComposerDraft,
} from '@/lib/scheduled-work-composer'
import type { VaultAssetRecord } from '@craft-agent/shared/artist-vault'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import type { WorkflowTriggerInput } from '@craft-agent/shared/workflows'
import type { WorkflowDTO, WorkflowRunDTO } from '../../shared/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow: WorkflowDTO
  workspaceId: string
  /** Pre-fill form fields (used by the Rerun button on the Run page). */
  initialInputs?: Record<string, unknown>
  /** Called only after the run exists. Failures must not strand the user before navigation. */
  onStarted?: (run: WorkflowRunDTO) => void | Promise<void>
  /** Optional fast escape hatch for prefilled reruns that need a fresh planning conversation. */
  onManagerSetup?: () => void
  managerSetupBusy?: boolean
}

export function WorkflowRunInputDialog({ open, onOpenChange, workflow, workspaceId, initialInputs, onStarted, onManagerSetup, managerSetupBusy = false }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { workspaces } = useAppShellContext()
  const { start } = useWorkflowRuns(workspaceId)
  const { outputs, loading: outputsLoading, getOutput } = useOutputs(workspaceId)
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
  const workspaceRootPath = workspace?.rootPath
  const isHq = isArtistHQWorkspace(workspace, workspaces)
  const inputs = React.useMemo(() => workflow.metadata.trigger.inputs ?? [], [workflow.metadata.trigger.inputs])
  const groupedInputs = React.useMemo(() => orderWorkflowInputs(inputs), [inputs])

  const buildInitialFormValues = React.useCallback(() => {
    const values: Record<string, string | number | boolean> = {}
    for (const i of inputs) {
      const fromPrior = initialInputs?.[i.name]
      const seed = fromPrior !== undefined ? fromPrior : i.default
      if (i.type === 'boolean') {
        values[i.name] = Boolean(seed ?? false)
      } else if (i.type === 'number') {
        values[i.name] = typeof seed === 'number' ? seed : (seed != null && !Number.isNaN(Number(seed)) ? Number(seed) : '')
      } else {
        values[i.name] = seed != null ? String(seed) : ''
      }
    }
    return values
  }, [inputs, initialInputs])

  const [values, setValues] = React.useState<Record<string, string | number | boolean>>(buildInitialFormValues)
  const [submitting, setSubmitting] = React.useState(false)
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [fieldError, setFieldError] = React.useState<{ inputName: string; message: string } | null>(null)
  const [vaultAssets, setVaultAssets] = React.useState<VaultAssetRecord[]>([])
  const [releaseKitItems, setReleaseKitItems] = React.useState<ReleaseKitItem[]>([])
  const [assetsLoading, setAssetsLoading] = React.useState(false)
  const [actionChoiceOpen, setActionChoiceOpen] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [automationTriggerOpen, setAutomationTriggerOpen] = React.useState(false)
  const [automationFlowOpen, setAutomationFlowOpen] = React.useState(false)
  const [preparedInputs, setPreparedInputs] = React.useState<Record<string, unknown> | null>(null)

  const workflowPrefill = React.useMemo<ScheduledWorkComposerEntry['workflow']>(() => ({
    slug: workflow.slug,
    name: workflow.metadata.name,
    digest: composerDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }),
    triggerInputs: preparedInputs ?? {},
  }), [preparedInputs, workflow])

  const scheduleEntry = React.useMemo<ScheduledWorkComposerEntry | null>(() => {
    if (!workspace || !preparedInputs) return null
    const now = new Date()
    return {
      owner: isHq
        ? { scope: 'hq', workspaceId }
        : { scope: 'campaign', workspaceId, campaignId: workspaceId },
      date: [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'),
      mode: 'job',
      title: workflow.metadata.name,
      suggestedType: 'workflow-run',
      workflow: workflowPrefill,
    }
  }, [isHq, preparedInputs, workflow.metadata.name, workflowPrefill, workspace, workspaceId])

  React.useEffect(() => {
    if (open) {
      setValues(buildInitialFormValues())
      setSubmitting(false)
      setMoreOpen(false)
      setFieldError(null)
      setActionChoiceOpen(false)
      setScheduleOpen(false)
      setAutomationTriggerOpen(false)
      setAutomationFlowOpen(false)
      setPreparedInputs(null)
      return
    }
    setActionChoiceOpen(false)
    setScheduleOpen(false)
    setAutomationTriggerOpen(false)
    setAutomationFlowOpen(false)
    setPreparedInputs(null)
  }, [open, buildInitialFormValues])

  React.useEffect(() => {
    if (!open) return
    let active = true
    setAssetsLoading(true)
    void Promise.all([
      window.electronAPI.getArtistVaultManifest(workspaceId).then((manifest) => manifest.assets).catch(() => []),
      window.electronAPI.getReleaseKit(workspaceId).then((manifest) => manifest.items).catch(() => []),
    ]).then(([vault, releaseKit]) => {
      if (!active) return
      setVaultAssets(vault.filter((asset) => asset.status !== 'missing' && asset.status !== 'archived' && asset.usableByAgents))
      setReleaseKitItems(releaseKit.filter((item) => item.status === 'ready'))
    }).finally(() => {
      if (active) setAssetsLoading(false)
    })
    return () => { active = false }
  }, [open, workspaceId])

  const assetOptions = React.useMemo(() => [
    ...releaseKitItems.map((item) => ({ id: `release-kit:${item.id}`, label: `Release Kit · ${item.title}`, value: item.relativePath })),
    ...vaultAssets.flatMap((asset) => {
      const value = asset.absolutePath || asset.relativePath
      return value ? [{ id: `vault:${asset.id}`, label: `Vault · ${asset.label}`, value }] : []
    }),
    ...outputs.map((output) => ({ id: `output:${output.id}`, label: `Output · ${output.title}`, value: '', outputId: output.id })),
  ], [outputs, releaseKitItems, vaultAssets])

  const chooseAsset = React.useCallback(async (option: WorkflowAssetOption): Promise<string | null> => {
    if (option.value) return option.value
    if (!option.outputId || !workspaceRootPath) return null
    const manifest = await getOutput(option.outputId)
    const assetPath = manifest?.primary?.path ?? manifest?.assets.find((asset) => asset.role === 'primary')?.path ?? manifest?.assets[0]?.path
    return assetPath ? workflowOutputAssetPath(workspaceRootPath, option.outputId, assetPath) : null
  }, [getOutput, workspaceRootPath])

  const updateValue = React.useCallback((name: string, value: string | number | boolean) => {
    setValues((previous) => ({ ...previous, [name]: value }))
    setFieldError((current) => current?.inputName === name ? null : current)
  }, [])

  const preparePayload = React.useCallback((): Record<string, unknown> | null => {
    const validationError = validateWorkflowInputValues(inputs, values)
    if (validationError) {
      setFieldError(validationError)
      if (groupedInputs.optional.some((input) => input.name === validationError.inputName)) setMoreOpen(true)
      window.setTimeout(() => document.getElementById(`workflow-input-${validationError.inputName}`)?.focus(), 0)
      return null
    }
    const payload: Record<string, unknown> = {}
    for (const input of inputs) {
      const value = values[input.name]
      if (!input.required && (value === '' || value == null)) continue
      payload[input.name] = value
    }
    return payload
  }, [groupedInputs.optional, inputs, values])

  const handleSubmit = async () => {
    const payload = preparePayload()
    if (!payload) return
    setSubmitting(true)
    try {
      const created = await start(workflow.slug, payload)
      try {
        await onStarted?.(created)
      } catch (err) {
        toast.error('Workflow started, but its originating item could not be linked.', {
          description: err instanceof Error ? err.message : String(err),
        })
      }
      onOpenChange(false)
      navigate(routes.view.workflowRun(created.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const openScheduleChoice = React.useCallback(() => {
    const payload = preparePayload()
    if (!payload) return
    setPreparedInputs(payload)
    setActionChoiceOpen(true)
  }, [preparePayload])

  const submitScheduledWork = React.useCallback(async (draft: ScheduledWorkComposerDraft) => {
    if (draft.type !== 'workflow-run') throw new Error('Scheduled workflow setup changed unexpectedly.')
    if (draft.owner.scope === 'hq') {
      await window.electronAPI.scheduleHqWork(workspaceId, buildHqSchedulePlanFromComposer(draft))
    } else {
      const plan = buildCampaignSchedulePlanFromComposer(draft)
      if ('orders' in plan) await window.electronAPI.scheduleCampaignWorkChain(workspaceId, plan)
      else await window.electronAPI.scheduleCampaignWork(workspaceId, plan)
    }
    toast.success(`${workflow.metadata.name} scheduled`)
    onOpenChange(false)
  }, [onOpenChange, workflow.metadata.name, workspaceId])

  const openScheduleOnce = React.useCallback(() => {
    setActionChoiceOpen(false)
    setScheduleOpen(true)
  }, [])

  const openRepeat = React.useCallback(() => {
    setActionChoiceOpen(false)
    setAutomationFlowOpen(true)
    setAutomationTriggerOpen(true)
  }, [])

  return (
    <>
    <Dialog open={open && !scheduleOpen && !automationFlowOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[min(600px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-white/[0.08] bg-[#090909] p-0 text-white max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-screen max-sm:rounded-none">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-5 py-4 pr-12">
          <DialogTitle className="text-white">{actionChoiceOpen ? `Schedule ${workflow.metadata.name}` : t('workflows.run.title', { name: workflow.metadata.name })}</DialogTitle>
          <DialogDescription className="text-white/48">{actionChoiceOpen ? 'Choose a one-time run or make it repeat automatically.' : workflow.metadata.description}</DialogDescription>
        </DialogHeader>

        {actionChoiceOpen ? (
          <div className="space-y-2 p-4">
            <WorkflowActionChoice icon={CalendarClock} title="Once" description="Choose a date and time for one future run." onClick={openScheduleOnce} />
            <WorkflowActionChoice icon={Repeat2} title="Repeat or trigger" description="Run on a schedule, file change, webhook, URL change, or message." onClick={openRepeat} />
            <div className="pt-2">
              <Button variant="ghost" className="text-white/52 hover:text-white" onClick={() => setActionChoiceOpen(false)}>Back</Button>
            </div>
          </div>
        ) : (
          <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {onManagerSetup ? (
            <button
              type="button"
              onClick={onManagerSetup}
              disabled={managerSetupBusy}
              className="mb-4 flex w-full items-start gap-2.5 rounded-[9px] bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35 disabled:cursor-wait disabled:opacity-55"
            >
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-200/65" />
              <span>
                <span className="block text-[11.5px] font-medium text-white/68">{managerSetupBusy ? 'Opening Artist Manager…' : 'Set up with Artist Manager'}</span>
                <span className="mt-0.5 block text-[10.5px] leading-4 text-white/36">Rethink the goal, assets, or timing before rerunning.</span>
              </span>
            </button>
          ) : null}
          {inputs.length === 0 && (
            <p className="rounded-[9px] bg-white/[0.035] px-3 py-3 text-xs text-white/48">{t('workflows.run.noInputs')}</p>
          )}
          <div className="space-y-4">
            {groupedInputs.required.map((input) => (
              <FriendlyWorkflowField key={input.name} input={input} workflowSlug={workflow.slug} value={values[input.name]} values={values} error={fieldError?.inputName === input.name ? fieldError.message : undefined} assetOptions={assetOptions} assetsLoading={assetsLoading || outputsLoading} onChooseAsset={chooseAsset} onChange={(value) => updateValue(input.name, value)} />
            ))}
          </div>

          {groupedInputs.optional.length > 0 ? (
            <div className={cn('mt-5', groupedInputs.required.length > 0 && 'border-t border-white/[0.06] pt-4')}>
              <button type="button" onClick={() => setMoreOpen((value) => !value)} className="flex w-full items-center justify-between rounded-[8px] px-1 py-1.5 text-left text-xs font-medium text-white/54 hover:text-white/78" aria-expanded={moreOpen}>
                More options
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')} />
              </button>
              {moreOpen ? (
                <div className="mt-4 space-y-4">
                  {groupedInputs.optional.map((input) => (
                    <FriendlyWorkflowField key={input.name} input={input} workflowSlug={workflow.slug} value={values[input.name]} values={values} error={fieldError?.inputName === input.name ? fieldError.message : undefined} assetOptions={assetOptions} assetsLoading={assetsLoading || outputsLoading} onChooseAsset={chooseAsset} onChange={(value) => updateValue(input.name, value)} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.07] bg-[#090909]/95 px-5 py-4 backdrop-blur">
          <Button variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="border-white/[0.08] bg-white/[0.035] text-white/66 hover:bg-white/[0.07] hover:text-white" onClick={openScheduleChoice} disabled={submitting}>Schedule</Button>
            <Button className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('workflows.run.starting') : 'Run now'}
            </Button>
          </div>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
    {scheduleEntry ? (
      <ScheduledWorkComposer
        open={open && scheduleOpen}
        onOpenChange={setScheduleOpen}
        entry={scheduleEntry}
        allowedTypes={['workflow-run']}
        onSubmit={submitScheduledWork}
      />
    ) : null}
    <AutomationWorkDialog
      open={open && automationTriggerOpen}
      onOpenChange={setAutomationTriggerOpen}
      onFlowOpenChange={setAutomationFlowOpen}
      workflowPrefill={preparedInputs ? workflowPrefill : undefined}
      suggestedName={`${workflow.metadata.name} repeat`}
      onCreated={() => onOpenChange(false)}
      workspaceId={workspaceId}
    />
    </>
  )
}

interface WorkflowAssetOption {
  id: string
  label: string
  value: string
  outputId?: string
}

function WorkflowActionChoice({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-[10px] bg-white/[0.035] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/35"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.055] text-white/55 group-hover:text-orange-200/85">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white/84">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-white/42">{description}</span>
      </span>
    </button>
  )
}

function FriendlyWorkflowField({
  input,
  workflowSlug,
  value,
  values,
  error,
  assetOptions,
  assetsLoading,
  onChooseAsset,
  onChange,
}: {
  input: WorkflowTriggerInput
  workflowSlug: string
  value: string | number | boolean
  values: Record<string, string | number | boolean>
  error?: string
  assetOptions: WorkflowAssetOption[]
  assetsLoading: boolean
  onChooseAsset: (option: WorkflowAssetOption) => Promise<string | null>
  onChange: (value: string | number | boolean) => void
}) {
  const control = workflowInputControl(workflowSlug, input)
  const label = humanizeWorkflowInputName(input.name)
  const inputId = `workflow-input-${input.name}`
  const helpId = input.description ? `${inputId}-help` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const commonClass = cn('w-full rounded-[8px] border bg-white/[0.025] px-3 text-sm text-white/82 outline-none placeholder:text-white/25 focus:border-orange-300/35', error ? 'border-amber-400/45' : 'border-white/[0.09]')
  const [assetBusy, setAssetBusy] = React.useState(false)

  if (control === 'boolean') {
    return (
      <div className="flex items-start justify-between gap-4 rounded-[9px] bg-white/[0.025] px-3 py-3">
        <div className="min-w-0">
          <label htmlFor={inputId} className="text-xs font-medium text-white/72">{label}</label>
          {input.description ? <p id={helpId} className="mt-1 text-[10.5px] leading-4 text-white/38">{input.description}</p> : null}
          {error ? <p id={errorId} className="mt-1 text-[10.5px] text-amber-300/80">{error}</p> : null}
        </div>
        <Switch id={inputId} checked={Boolean(value)} onCheckedChange={onChange} aria-describedby={describedBy} />
      </div>
    )
  }

  return (
    <label htmlFor={inputId} className="block space-y-1.5">
      <span className="block text-xs font-medium text-white/72">{label}{input.required ? <span className="ml-0.5 text-orange-300/75">*</span> : null}</span>
      {input.description ? <span id={helpId} className="block text-[10.5px] leading-4 text-white/38">{input.description}</span> : null}
      {control === 'asset' ? (
        <div className="space-y-2">
          <div className="relative">
            <FolderOpen className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/34" />
            <select
              className={cn(commonClass, 'h-10 appearance-none pl-9')}
              value=""
              onChange={(event) => {
                const option = assetOptions.find((candidate) => candidate.id === event.target.value)
                if (!option) return
                setAssetBusy(true)
                void onChooseAsset(option).then((resolved) => {
                  if (resolved) onChange(resolved)
                  else toast.error('That Output does not contain a usable file.')
                }).catch((assetError) => {
                  toast.error('Could not load that asset.', { description: assetError instanceof Error ? assetError.message : String(assetError) })
                }).finally(() => setAssetBusy(false))
              }}
              disabled={assetsLoading || assetBusy || assetOptions.length === 0}
              aria-label={`Choose ${label.toLowerCase()} from existing assets`}
            >
              <option value="">{assetsLoading || assetBusy ? 'Loading existing assets…' : assetOptions.length > 0 ? 'Choose an existing asset…' : 'No existing assets found'}</option>
              {assetOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          <input id={inputId} className={cn(commonClass, 'h-10')} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} aria-invalid={Boolean(error)} placeholder="Or paste a file path" />
        </div>
      ) : control === 'long-text' ? (
        <textarea id={inputId} className={cn(commonClass, 'min-h-[84px] py-2.5 leading-5')} rows={3} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} aria-invalid={Boolean(error)} />
      ) : (
        <input
          id={inputId}
          className={cn(commonClass, 'h-10')}
          type={control === 'number' ? 'number' : 'text'}
          min={control === 'number' ? input.min : undefined}
          max={control === 'number' ? workflowNumberMax(input, values) : undefined}
          step={control === 'number' ? (input.integer ? 1 : 'any') : undefined}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(control === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
        />
      )}
      {error ? <span id={errorId} className="block text-[10.5px] text-amber-300/80">{error}</span> : null}
    </label>
  )
}
