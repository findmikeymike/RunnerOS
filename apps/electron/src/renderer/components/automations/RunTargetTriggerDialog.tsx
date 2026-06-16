import * as React from 'react'
import { toast } from 'sonner'
import { GitBranch, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import { useWorkflows } from '@/hooks/useWorkflows'
import type { AppEvent } from './types'

type TargetKind = 'workflow' | 'agent'
type WorkflowOption = ReturnType<typeof useWorkflows>['activeWorkflows'][number]
type WorkflowInput = NonNullable<WorkflowOption['metadata']['trigger']['inputs']>[number]
type PollFingerprint = 'body' | 'etag' | 'last-modified' | 'status'
type TriggerKind =
  | 'WebhookReceive'
  | 'SchedulerTick'
  | 'FileWatch'
  | 'PollUrl'
  | 'MessageReceive'
  | 'LabelAdd'
  | 'LabelRemove'
  | 'SessionStatusChange'
  | 'FlagChange'
  | 'PermissionModeChange'

interface RunTargetTriggerDialogProps {
  trigger?: React.ReactNode
}

const TRIGGER_OPTIONS: Array<{ value: TriggerKind; label: string; description: string }> = [
  { value: 'WebhookReceive', label: 'Webhook', description: 'POST data from another app or script.' },
  { value: 'SchedulerTick', label: 'Schedule', description: 'Run on a cron schedule.' },
  { value: 'FileWatch', label: 'File change', description: 'Run when a matching file changes.' },
  { value: 'PollUrl', label: 'URL poll', description: 'Run when a URL fingerprint changes.' },
  { value: 'MessageReceive', label: 'Chat message', description: 'Run when an inbound chat message matches.' },
  { value: 'LabelAdd', label: 'Label added', description: 'Run when a label is added.' },
  { value: 'LabelRemove', label: 'Label removed', description: 'Run when a label is removed.' },
  { value: 'SessionStatusChange', label: 'Status changed', description: 'Run when a session status changes.' },
  { value: 'FlagChange', label: 'Flag changed', description: 'Run when a session is flagged or unflagged.' },
  { value: 'PermissionModeChange', label: 'Permission changed', description: 'Run when permission mode changes.' },
]

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'automation'
}

function defaultInputValue(input: WorkflowInput, triggerKind: TriggerKind): string {
  if (input.default !== undefined) return String(input.default)
  if (input.type === 'string') {
    if (triggerKind === 'WebhookReceive') return '$CRAFT_BODY_RAW'
    if (triggerKind === 'FileWatch') return '$CRAFT_PATH'
    if (triggerKind === 'PollUrl') return '$CRAFT_BODY'
    if (triggerKind === 'MessageReceive') return '$CRAFT_TEXT'
  }
  return ''
}

function coerceWorkflowInputs(
  workflow: WorkflowOption,
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const input of workflow.metadata.trigger.inputs ?? []) {
    const value = values[input.name] ?? ''
    if (value === '') continue
    if (input.type === 'number') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) throw new Error(`Workflow input "${input.name}" must be a number.`)
      out[input.name] = parsed
    } else if (input.type === 'boolean') {
      out[input.name] = value === 'true'
    } else {
      out[input.name] = value
    }
  }
  return out
}

function validateWorkflowInputs(
  workflow: WorkflowOption,
  values: Record<string, string>,
): string | null {
  for (const input of workflow.metadata.trigger.inputs ?? []) {
    const value = values[input.name] ?? ''
    if (input.required && value === '') return `Missing required workflow input: ${input.name}`
    if (value && input.type === 'number' && !Number.isFinite(Number(value))) return `Workflow input "${input.name}" must be a number.`
  }
  return null
}

function buildTriggerFields(
  triggerKind: TriggerKind,
  fields: {
    webhookSlug: string
    webhookSecretEnv: string
    cron: string
    timezone: string
    watchPath: string
    watchGlob: string
    pollUrl: string
    pollIntervalSec: string
    pollFingerprint: PollFingerprint
    matcher: string
  },
): Record<string, unknown> {
  if (triggerKind === 'WebhookReceive') {
    return {
      slug: fields.webhookSlug,
      ...(fields.webhookSecretEnv ? { secretEnv: fields.webhookSecretEnv } : { allowUnauthenticated: true }),
      allowedMethods: ['POST'],
    }
  }
  if (triggerKind === 'SchedulerTick') {
    return {
      cron: fields.cron,
      timezone: fields.timezone,
    }
  }
  if (triggerKind === 'FileWatch') {
    return {
      watchPath: fields.watchPath,
      watchGlob: fields.watchGlob,
      watchChangeTypes: ['add', 'change'],
      watchDebounceMs: 1500,
    }
  }
  if (triggerKind === 'PollUrl') {
    return {
      pollUrl: fields.pollUrl,
      pollIntervalSec: Number(fields.pollIntervalSec),
      pollFingerprint: fields.pollFingerprint,
    }
  }
  return fields.matcher ? { matcher: fields.matcher } : {}
}

export function RunTargetTriggerDialog({ trigger }: RunTargetTriggerDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [targetKind, setTargetKind] = React.useState<TargetKind>('workflow')
  const [triggerKind, setTriggerKind] = React.useState<TriggerKind>('WebhookReceive')
  const [selectedSlug, setSelectedSlug] = React.useState('')
  const [prompt, setPrompt] = React.useState('Handle this trigger.\n\nEvent: $CRAFT_EVENT\nPayload: $CRAFT_EVENT_DATA')
  const [webhookSlug, setWebhookSlug] = React.useState('')
  const [webhookSecretEnv, setWebhookSecretEnv] = React.useState('')
  const [cron, setCron] = React.useState('0 9 * * *')
  const [timezone, setTimezone] = React.useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [watchPath, setWatchPath] = React.useState('.')
  const [watchGlob, setWatchGlob] = React.useState('**/*.md')
  const [pollUrl, setPollUrl] = React.useState('')
  const [pollIntervalSec, setPollIntervalSec] = React.useState('600')
  const [pollFingerprint] = React.useState<PollFingerprint>('body')
  const [matcherRegex, setMatcherRegex] = React.useState('')
  const [workflowInputValues, setWorkflowInputValues] = React.useState<Record<string, string>>({})
  const workspace = useActiveWorkspace()
  const workflows = useWorkflows(open ? workspace?.id : null)
  const agents = useAgents(open ? workspace?.id : null)

  const workflowOptions = workflows.activeWorkflows
  const agentOptions = agents.activeAgents
  const targetOptions = targetKind === 'workflow' ? workflowOptions : agentOptions

  React.useEffect(() => {
    if (!open) return
    const first = targetOptions[0]?.slug ?? ''
    if (!selectedSlug || !targetOptions.some((target) => target.slug === selectedSlug)) {
      setSelectedSlug(first)
    }
  }, [open, selectedSlug, targetOptions])

  const selectedWorkflow = workflowOptions.find((workflow) => workflow.slug === selectedSlug)
  const selectedAgent = agentOptions.find((agent) => agent.slug === selectedSlug)
  const triggerMeta = TRIGGER_OPTIONS.find((option) => option.value === triggerKind)!
  const workflowInputError = targetKind === 'workflow' && selectedWorkflow
    ? validateWorkflowInputs(selectedWorkflow, workflowInputValues)
    : null
  const triggerError = triggerKind === 'WebhookReceive' && !webhookSlug
    ? 'Webhook slug is required.'
    : triggerKind === 'SchedulerTick' && !cron
      ? 'Cron schedule is required.'
      : triggerKind === 'FileWatch' && (!watchPath || !watchGlob)
        ? 'Watch path and glob are required.'
        : triggerKind === 'PollUrl' && (!pollUrl || !/^https?:\/\//i.test(pollUrl))
          ? 'Poll URL must be http(s).'
          : triggerKind === 'PollUrl' && (!Number.isFinite(Number(pollIntervalSec)) || Number(pollIntervalSec) < 30)
            ? 'Poll interval must be at least 30 seconds.'
          : null
  const canSubmit = Boolean(workspace?.id && selectedSlug && (targetKind !== 'workflow' || selectedWorkflow) && !workflowInputError && !triggerError)

  React.useEffect(() => {
    if (!open || !selectedSlug) return
    const slug = slugify(selectedSlug)
    setWebhookSlug(slug)
    setWebhookSecretEnv(`CRAFT_WH_${slug.replace(/-/g, '_').toUpperCase()}_SECRET`)
  }, [open, selectedSlug])

  React.useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowInputValues({})
      return
    }
    setWorkflowInputValues(Object.fromEntries(
      (selectedWorkflow.metadata.trigger.inputs ?? []).map((input) => [input.name, defaultInputValue(input, triggerKind)]),
    ))
  }, [selectedWorkflow, triggerKind])

  const handleCreate = React.useCallback(async () => {
    if (!workspace?.id || !canSubmit) return
    setPending(true)
    try {
      const targetName = targetKind === 'workflow'
        ? selectedWorkflow?.metadata.name ?? selectedSlug
        : selectedAgent?.metadata.name ?? selectedSlug
      const createdMatcher = {
        name: `${triggerMeta.label} -> ${targetName}`,
        ...buildTriggerFields(triggerKind, {
          webhookSlug,
          webhookSecretEnv,
          cron,
          timezone,
          watchPath,
          watchGlob,
          pollUrl,
          pollIntervalSec,
          pollFingerprint,
          matcher: matcherRegex,
        }),
        actions: targetKind === 'workflow'
          ? [{
              type: 'workflow',
              workflowSlug: selectedSlug,
              triggerInputs: selectedWorkflow ? coerceWorkflowInputs(selectedWorkflow, workflowInputValues) : {},
            }]
          : [{
              type: 'prompt',
              agentSlug: selectedSlug,
              prompt,
            }],
      }
      await window.electronAPI.createAutomationFromTemplate(workspace.id, triggerKind as AppEvent, createdMatcher)
      toast.success(`Added trigger for ${targetName}`)
      setOpen(false)
    } catch (err) {
      toast.error('Failed to add trigger', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPending(false)
    }
  }, [canSubmit, cron, matcherRegex, pollFingerprint, pollIntervalSec, pollUrl, prompt, selectedAgent, selectedSlug, selectedWorkflow, targetKind, triggerKind, triggerMeta.label, timezone, watchGlob, watchPath, webhookSecretEnv, webhookSlug, workflowInputValues, workspace?.id])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="secondary" size="sm">
            <GitBranch className="h-3.5 w-3.5" />
            Run target
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create trigger</DialogTitle>
          <DialogDescription>
            Pick a trigger source, then run an active workflow or agent.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={targetKind === 'workflow' ? 'default' : 'secondary'} onClick={() => setTargetKind('workflow')}>
              Workflow
            </Button>
            <Button type="button" variant={targetKind === 'agent' ? 'default' : 'secondary'} onClick={() => setTargetKind('agent')}>
              Agent
            </Button>
          </div>

          <Field label="Trigger">
            <Select value={triggerKind} onValueChange={(value) => setTriggerKind(value as TriggerKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-foreground/50">{triggerMeta.description}</p>
          </Field>

          <Field label={targetKind === 'workflow' ? 'Workflow' : 'Agent'}>
            <Select value={selectedSlug} onValueChange={setSelectedSlug} disabled={targetOptions.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={targetOptions.length ? 'Choose target' : `No active ${targetKind}s`} />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((target) => (
                  <SelectItem key={target.slug} value={target.slug}>
                    {target.metadata.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {triggerKind === 'WebhookReceive' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Webhook slug">
                <Input value={webhookSlug} onChange={(event) => setWebhookSlug(slugify(event.target.value))} />
              </Field>
              <Field label="Secret env">
                <Input value={webhookSecretEnv} onChange={(event) => setWebhookSecretEnv(event.target.value)} placeholder="Optional" />
              </Field>
            </div>
          )}

          {triggerKind === 'SchedulerTick' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cron">
                <Input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" />
              </Field>
              <Field label="Timezone">
                <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
              </Field>
            </div>
          )}

          {triggerKind === 'FileWatch' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Watch path">
                <Input value={watchPath} onChange={(event) => setWatchPath(event.target.value)} placeholder="." />
              </Field>
              <Field label="File glob">
                <Input value={watchGlob} onChange={(event) => setWatchGlob(event.target.value)} placeholder="**/*.md" />
              </Field>
            </div>
          )}

          {triggerKind === 'PollUrl' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="URL">
                <Input value={pollUrl} onChange={(event) => setPollUrl(event.target.value)} placeholder="https://example.com/feed.json" />
              </Field>
              <Field label="Interval seconds">
                <Input value={pollIntervalSec} onChange={(event) => setPollIntervalSec(event.target.value)} inputMode="numeric" />
              </Field>
            </div>
          )}

          {triggerKind !== 'WebhookReceive' && triggerKind !== 'SchedulerTick' && triggerKind !== 'FileWatch' && triggerKind !== 'PollUrl' && (
            <Field label="Matcher regex">
              <Input value={matcherRegex} onChange={(event) => setMatcherRegex(event.target.value)} placeholder="Optional" />
            </Field>
          )}

          {targetKind === 'agent' && (
            <Field label="Prompt">
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
            </Field>
          )}

          {targetKind === 'workflow' && selectedWorkflow && (selectedWorkflow.metadata.trigger.inputs ?? []).length > 0 && (
            <div className="grid gap-2">
              <div className="text-xs font-medium text-foreground/70">Workflow inputs</div>
              {(selectedWorkflow.metadata.trigger.inputs ?? []).map((input) => (
                <Field key={input.name} label={`${input.name}${input.required ? ' *' : ''}`}>
                  {input.type === 'boolean' ? (
                    <Select
                      value={workflowInputValues[input.name] ?? ''}
                      onValueChange={(value) => setWorkflowInputValues((prev) => ({ ...prev, [input.name]: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose value" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={workflowInputValues[input.name] ?? ''}
                      onChange={(event) => setWorkflowInputValues((prev) => ({ ...prev, [input.name]: event.target.value }))}
                      inputMode={input.type === 'number' ? 'decimal' : undefined}
                      placeholder={input.description ?? input.type}
                    />
                  )}
                </Field>
              ))}
            </div>
          )}

          {triggerKind === 'WebhookReceive' && webhookSlug && (
            <div className="rounded-md border border-border/40 bg-foreground/[0.025] p-3 text-xs text-foreground/60">
              Webhook slug: <span className="font-mono text-foreground/80">{webhookSlug}</span>
            </div>
          )}

          {(workflowInputError || triggerError) && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {workflowInputError || triggerError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} disabled={!canSubmit || pending}>
              {pending ? 'Adding...' : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add trigger
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground/70">{label}</span>
      {children}
    </label>
  )
}
