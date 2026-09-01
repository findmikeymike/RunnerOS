import * as React from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
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
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useOutputs } from '@/hooks/useOutputs'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import {
  humanizeWorkflowInputName,
  orderWorkflowInputs,
  validateWorkflowInputValues,
  workflowInputControl,
  workflowNumberMax,
  workflowOutputAssetPath,
} from '@/lib/workflow-input-presentation'
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
}

export function WorkflowRunInputDialog({ open, onOpenChange, workflow, workspaceId, initialInputs, onStarted }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { workspaces } = useAppShellContext()
  const { start } = useWorkflowRuns(workspaceId)
  const { outputs, loading: outputsLoading, getOutput } = useOutputs(workspaceId)
  const workspaceRootPath = workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath
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

  React.useEffect(() => {
    if (open) {
      setValues(buildInitialFormValues())
      setSubmitting(false)
      setMoreOpen(false)
      setFieldError(null)
    }
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

  const handleSubmit = async () => {
    const validationError = validateWorkflowInputValues(inputs, values)
    if (validationError) {
      setFieldError(validationError)
      if (groupedInputs.optional.some((input) => input.name === validationError.inputName)) setMoreOpen(true)
      window.setTimeout(() => document.getElementById(`workflow-input-${validationError.inputName}`)?.focus(), 0)
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const i of inputs) {
        const value = values[i.name]
        if (!i.required && (value === '' || value == null)) continue
        payload[i.name] = value
      }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[min(600px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-white/[0.08] bg-[#090909] p-0 text-white max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-screen max-sm:rounded-none">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-5 py-4 pr-12">
          <DialogTitle className="text-white">{t('workflows.run.title', { name: workflow.metadata.name })}</DialogTitle>
          <DialogDescription className="text-white/48">{workflow.metadata.description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
          <Button className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('workflows.run.starting') : t('workflows.run.run')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface WorkflowAssetOption {
  id: string
  label: string
  value: string
  outputId?: string
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
