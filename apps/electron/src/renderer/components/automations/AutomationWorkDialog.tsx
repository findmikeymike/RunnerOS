import * as React from 'react'
import { CalendarClock, FileSearch, Link2, MessageSquare, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScheduledWorkComposer } from '@/components/calendar/ScheduledWorkComposer'
import { Switch } from '@/components/ui/switch'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { isArtistHQWorkspace } from '@/lib/artist-workspace'
import { buildAutomationQueueWorkAction, type ScheduledWorkComposerDraft, type ScheduledWorkComposerType } from '@/lib/scheduled-work-composer'
import { cn } from '@/lib/utils'
import type { AutomationTrigger } from './types'

type WorkTrigger = Extract<AutomationTrigger, 'SchedulerTick' | 'FileWatch' | 'WebhookReceive' | 'PollUrl' | 'MessageReceive'>

const TRIGGERS: Array<{
  event: WorkTrigger
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { event: 'SchedulerTick', label: 'Schedule', description: 'At a recurring time', icon: CalendarClock },
  { event: 'FileWatch', label: 'File change', description: 'When matching files change', icon: FileSearch },
  { event: 'WebhookReceive', label: 'Webhook', description: 'From another service', icon: Webhook },
  { event: 'PollUrl', label: 'URL change', description: 'When a page or feed changes', icon: Link2 },
  { event: 'MessageReceive', label: 'Message', description: 'When an inbound message matches', icon: MessageSquare },
]

const INPUT_CLASS = 'h-9 w-full rounded-[6px] border border-border/50 bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-foreground/25'

export interface AutomationWorkDialogProps {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AutomationWorkDialog({ trigger, open, onOpenChange }: AutomationWorkDialogProps) {
  const workspace = useActiveWorkspace()
  const { workspaces } = useAppShellContext()
  const [internalTriggerOpen, setInternalTriggerOpen] = React.useState(false)
  const [composerOpen, setComposerOpen] = React.useState(false)
  const [event, setEvent] = React.useState<WorkTrigger>('SchedulerTick')
  const [name, setName] = React.useState('')
  const [cron, setCron] = React.useState('0 9 * * *')
  const [timezone, setTimezone] = React.useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [watchPath, setWatchPath] = React.useState('.')
  const [watchGlob, setWatchGlob] = React.useState('**/*')
  const [webhookSlug, setWebhookSlug] = React.useState('')
  const [secretEnv, setSecretEnv] = React.useState('')
  const [pollUrl, setPollUrl] = React.useState('')
  const [pollIntervalSec, setPollIntervalSec] = React.useState(300)
  const [messageMatcher, setMessageMatcher] = React.useState('')
  const [showOnCalendar, setShowOnCalendar] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const triggerOpen = open ?? internalTriggerOpen
  const setTriggerOpen = React.useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalTriggerOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange, open])

  const isHq = isArtistHQWorkspace(workspace ?? undefined, workspaces)
  const owner = React.useMemo(() => workspace
    ? isHq
      ? { scope: 'hq' as const, workspaceId: workspace.id }
      : { scope: 'campaign' as const, workspaceId: workspace.id, campaignId: workspace.id }
    : null, [isHq, workspace])
  const allowedTypes = React.useMemo<ScheduledWorkComposerType[]>(
    () => isHq || !showOnCalendar ? ['agent-task', 'workflow-run'] : ['agent-task', 'workflow-run', 'review', 'social-publish'],
    [isHq, showOnCalendar],
  )

  const continueToWork = React.useCallback(() => {
    const validationError = validateTrigger({ event, name, cron, watchPath, watchGlob, webhookSlug, secretEnv, pollUrl, pollIntervalSec, messageMatcher })
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setTriggerOpen(false)
    setComposerOpen(true)
  }, [cron, event, messageMatcher, name, pollIntervalSec, pollUrl, secretEnv, setTriggerOpen, watchGlob, watchPath, webhookSlug])

  const submit = React.useCallback(async (draft: ScheduledWorkComposerDraft) => {
    if (!workspace || draft.type === 'event') return
    const action = buildAutomationQueueWorkAction(draft, { calendarVisibility: showOnCalendar ? 'visible' : 'hidden' })
    const matcher = buildMatcher({ event, name, cron, timezone, watchPath, watchGlob, webhookSlug, secretEnv, pollUrl, pollIntervalSec, messageMatcher, action })
    await window.electronAPI.createAutomationFromTemplate(workspace.id, event, matcher)
    toast.success('Tracked-work automation created', { description: `${name.trim()} will queue ${draft.title.trim()} when it fires.` })
  }, [cron, event, messageMatcher, name, pollIntervalSec, pollUrl, secretEnv, showOnCalendar, timezone, watchGlob, watchPath, webhookSlug, workspace])

  const today = React.useMemo(() => {
    const now = new Date()
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  }, [])

  return (
    <>
      <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
        {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
        <DialogContent className="w-[min(560px,calc(100vw-24px))] max-w-none gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/40 px-5 py-4 pr-12">
            <DialogTitle className="text-base">Queue tracked work</DialogTitle>
            <DialogDescription>Choose what starts the work. You will choose the agent, workflow, review, or publishing step next.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-5 py-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {TRIGGERS.map((option) => {
                const Icon = option.icon
                const selected = option.event === event
                return (
                  <button
                    key={option.event}
                    type="button"
                    onClick={() => { setEvent(option.event); setError(null) }}
                    className={cn(
                      'flex min-h-20 flex-col items-start justify-between rounded-[6px] border p-2.5 text-left transition-colors',
                      selected ? 'border-foreground/30 bg-foreground/[0.07]' : 'border-border/45 hover:bg-foreground/[0.035]',
                    )}
                    title={option.description}
                  >
                    <Icon className="h-4 w-4 text-foreground/60" />
                    <span className="text-xs font-medium">{option.label}</span>
                  </button>
                )
              })}
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground/70">Automation name</span>
              <input className={INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly campaign post" />
            </label>

            <TriggerFields
              event={event}
              cron={cron}
              timezone={timezone}
              watchPath={watchPath}
              watchGlob={watchGlob}
              webhookSlug={webhookSlug}
              secretEnv={secretEnv}
              pollUrl={pollUrl}
              pollIntervalSec={pollIntervalSec}
              messageMatcher={messageMatcher}
              onCron={setCron}
              onTimezone={setTimezone}
              onWatchPath={setWatchPath}
              onWatchGlob={setWatchGlob}
              onWebhookSlug={setWebhookSlug}
              onSecretEnv={setSecretEnv}
              onPollUrl={setPollUrl}
              onPollIntervalSec={setPollIntervalSec}
              onMessageMatcher={setMessageMatcher}
            />

            <div className="flex items-center justify-between gap-4 border-t border-border/35 pt-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Show each run on Calendar</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Turn off for recurring background reports and maintenance.</p>
              </div>
              <Switch checked={showOnCalendar} onCheckedChange={setShowOnCalendar} aria-label="Show each run on Calendar" />
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/40 px-5 py-4">
            <Button variant="ghost" onClick={() => setTriggerOpen(false)}>Cancel</Button>
            <Button onClick={continueToWork}>Choose work</Button>
          </div>
        </DialogContent>
      </Dialog>

      {owner ? (
        <ScheduledWorkComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          entry={{ owner, date: today }}
          allowedTypes={allowedTypes}
          allowFollowUps={!isHq && showOnCalendar}
          timingMode="triggered"
          onSubmit={submit}
        />
      ) : null}
    </>
  )
}

interface TriggerFieldProps {
  event: WorkTrigger
  cron: string
  timezone: string
  watchPath: string
  watchGlob: string
  webhookSlug: string
  secretEnv: string
  pollUrl: string
  pollIntervalSec: number
  messageMatcher: string
  onCron: (value: string) => void
  onTimezone: (value: string) => void
  onWatchPath: (value: string) => void
  onWatchGlob: (value: string) => void
  onWebhookSlug: (value: string) => void
  onSecretEnv: (value: string) => void
  onPollUrl: (value: string) => void
  onPollIntervalSec: (value: number) => void
  onMessageMatcher: (value: string) => void
}

function TriggerFields(props: TriggerFieldProps) {
  if (props.event === 'SchedulerTick') return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Cron schedule"><input className={INPUT_CLASS} value={props.cron} onChange={(e) => props.onCron(e.target.value)} placeholder="0 9 * * *" /></Field>
      <Field label="Timezone"><input className={INPUT_CLASS} value={props.timezone} onChange={(e) => props.onTimezone(e.target.value)} placeholder="America/Chicago" /></Field>
    </div>
  )
  if (props.event === 'FileWatch') return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Folder"><input className={INPUT_CLASS} value={props.watchPath} onChange={(e) => props.onWatchPath(e.target.value)} placeholder="content" /></Field>
      <Field label="File pattern"><input className={INPUT_CLASS} value={props.watchGlob} onChange={(e) => props.onWatchGlob(e.target.value)} placeholder="**/*.md" /></Field>
    </div>
  )
  if (props.event === 'WebhookReceive') return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Webhook slug"><input className={INPUT_CLASS} value={props.webhookSlug} onChange={(e) => props.onWebhookSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="campaign-ready" /></Field>
      <Field label="Signing secret environment variable"><input className={INPUT_CLASS} value={props.secretEnv} onChange={(e) => props.onSecretEnv(e.target.value.toUpperCase())} placeholder="CRAFT_WH_CAMPAIGN_SECRET" /></Field>
    </div>
  )
  if (props.event === 'PollUrl') return (
    <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
      <Field label="URL"><input className={INPUT_CLASS} value={props.pollUrl} onChange={(e) => props.onPollUrl(e.target.value)} placeholder="https://example.com/feed.json" /></Field>
      <Field label="Every (seconds)"><input className={INPUT_CLASS} type="number" min={30} value={props.pollIntervalSec} onChange={(e) => props.onPollIntervalSec(Number(e.target.value))} /></Field>
    </div>
  )
  return <Field label="Message pattern"><input className={INPUT_CLASS} value={props.messageMatcher} onChange={(e) => props.onMessageMatcher(e.target.value)} placeholder="campaign approved" /></Field>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-medium text-foreground/70">{label}</span>{children}</label>
}

interface TriggerConfig {
  event: WorkTrigger
  name: string
  cron: string
  watchPath: string
  watchGlob: string
  webhookSlug: string
  secretEnv: string
  pollUrl: string
  pollIntervalSec: number
  messageMatcher: string
}

function validateTrigger(config: TriggerConfig): string | undefined {
  if (!config.name.trim()) return 'Add an automation name.'
  if (config.event === 'SchedulerTick' && !config.cron.trim()) return 'Add a cron schedule.'
  if (config.event === 'FileWatch' && (!config.watchPath.trim() || !config.watchGlob.trim())) return 'Choose a folder and file pattern.'
  if (config.event === 'WebhookReceive') {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(config.webhookSlug)) return 'Use a webhook slug with lowercase letters, numbers, and hyphens.'
    if (!/^CRAFT_WH_[A-Z0-9_]+$/.test(config.secretEnv)) return 'Use a CRAFT_WH_* environment variable for the signing secret.'
  }
  if (config.event === 'PollUrl') {
    try {
      const url = new URL(config.pollUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      return 'Add a valid HTTP or HTTPS URL.'
    }
    if (!Number.isInteger(config.pollIntervalSec) || config.pollIntervalSec < 30) return 'Polling must be at least every 30 seconds.'
  }
  if (config.event === 'MessageReceive' && config.messageMatcher) {
    try { new RegExp(config.messageMatcher) } catch { return 'Add a valid message pattern.' }
  }
  return undefined
}

function buildMatcher(config: TriggerConfig & { timezone: string; action: ReturnType<typeof buildAutomationQueueWorkAction> }): Record<string, unknown> {
  const base: Record<string, unknown> = { name: config.name.trim(), actions: [config.action] }
  if (config.event === 'SchedulerTick') return { ...base, cron: config.cron.trim(), timezone: config.timezone.trim() || 'UTC' }
  if (config.event === 'FileWatch') return { ...base, watchPath: config.watchPath.trim(), watchGlob: config.watchGlob.trim(), watchChangeTypes: ['add', 'change'], watchDebounceMs: 500 }
  if (config.event === 'WebhookReceive') return { ...base, slug: config.webhookSlug, secretEnv: config.secretEnv, allowedMethods: ['POST'] }
  if (config.event === 'PollUrl') return { ...base, pollUrl: config.pollUrl.trim(), pollIntervalSec: config.pollIntervalSec, pollMethod: 'GET', pollFingerprint: 'body' }
  return { ...base, matcher: config.messageMatcher.trim() || undefined }
}
