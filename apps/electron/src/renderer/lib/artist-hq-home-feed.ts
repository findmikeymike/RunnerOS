import type { ScheduledWorkOrder, ScheduledWorkStatus } from '@craft-agent/shared/scheduled-work'
import { buildArtistTimeline, resolveCampaignFocusByReleaseDate } from '@craft-agent/shared/hq-state'
import type { AutomationListItem } from '@/components/automations/types'
import type { ArtistCalendarEvent } from '@/lib/artist-calendar'
import type { SessionMeta } from '@/atoms/sessions'

export interface HqCampaignSummary {
  id: string
  name: string
  primary?: boolean
  releaseDate?: string
  missionTitle?: string
}

export interface HqCampaignFocus {
  campaign: HqCampaignSummary
  label: 'Current campaign' | 'Next campaign' | 'Latest campaign' | 'Release date needed'
  dateLabel?: string
}

export interface HqHomeTimelineItem {
  id: string
  title: string
  when: string
  sortKey: string
  kind: 'calendar' | 'scheduled-work'
  status?: ScheduledWorkStatus
}

export interface HqHomeWorkerItem {
  id: string
  title: string
  detail: string
  status: string
  kind: 'automation' | 'scheduled-work' | 'session'
}

export interface HqHomeProjectCard {
  id: string
  title: string
  detail: string
  status: 'active' | 'waiting' | 'planned'
  kind: 'campaign' | 'scheduled-work'
  workspaceId?: string
}

export interface HqHomeProjectColumn {
  id: 'focus' | 'active' | 'waiting' | 'upcoming'
  label: string
  cards: HqHomeProjectCard[]
}

const ACTIVE_WORK_STATUSES = new Set<ScheduledWorkStatus>(['waiting', 'scheduled', 'running'])
const WAITING_WORK_STATUSES = new Set<ScheduledWorkStatus>(['needs-setup', 'needs-approval', 'awaiting-review', 'needs-attention'])

/**
 * The 7-day home strip, expressed as a thin view over the shared artist
 * timeline (spec 20 §11) so merge/dedup logic exists once. Display labels and
 * the untimed-items-sort-last convention stay here.
 */
export function buildHqThisWeekItems(
  events: ArtistCalendarEvent[],
  work: ScheduledWorkOrder[],
  now = new Date(),
  limit = 4,
): HqHomeTimelineItem[] {
  // Orders carry the user's timezone from creation; anchor the week to it so
  // sorting matches what the calendar displays regardless of process TZ.
  const timezone = work.find((order) => order.timezone)?.timezone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = localDateKey(now)
  const timeline = buildArtistTimeline({
    now,
    from: today,
    to: addDaysKey(today, 6),
    timezone,
    hqWorkspaceId: 'hq',
    hqEvents: events,
    hqOrders: work,
    campaigns: [],
    goals: [],
  })

  return timeline.entries
    .filter((entry) => entry.status !== 'done')
    .map((entry) => ({
      id: entry.origin.kind === 'scheduled-work' ? `work:${entry.origin.sourceId}` : `event:${entry.origin.sourceId}`,
      title: entry.title,
      when: relativeDateLabel(entry.date, today, entry.time),
      sortKey: `${entry.date}T${entry.time || '23:59'}`,
      kind: entry.origin.kind === 'scheduled-work' ? 'scheduled-work' as const : 'calendar' as const,
      ...(entry.origin.kind === 'scheduled-work' && entry.status
        ? { status: entry.status as ScheduledWorkStatus }
        : {}),
    }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.title.localeCompare(right.title))
    .slice(0, limit)
}

export function buildHqWorkerItems(
  automations: AutomationListItem[],
  work: ScheduledWorkOrder[],
  sessions: SessionMeta[] = [],
  limit = 5,
): HqHomeWorkerItem[] {
  const items: HqHomeWorkerItem[] = []

  for (const automation of automations.filter((item) => item.enabled)) {
    items.push({
      id: `automation:${automation.id}`,
      title: automation.name,
      detail: automation.event === 'SchedulerTick'
        ? automation.cron ? `Recurring schedule · ${automation.cron}` : 'Recurring schedule'
        : automation.summary || automation.event,
      status: automation.lastExecutedAt ? 'active' : 'ready',
      kind: 'automation',
    })
  }

  for (const order of work) {
    if (order.deletedAt || !ACTIVE_WORK_STATUSES.has(order.status)) continue
    const worker = order.execution.type === 'agent-task'
      ? `@${order.execution.agentSlug}`
      : order.execution.type === 'workflow-run'
        ? order.execution.workflowSlug
        : order.type
    items.push({
      id: `work:${order.id}`,
      title: order.title,
      detail: worker,
      status: order.status,
      kind: 'scheduled-work',
    })
  }

  for (const session of sessions) {
    if (!session.isProcessing || session.isArchived) continue
    const receipt = session.launchReceipt
    const isWorker = Boolean(
      session.spawnedFromAgent
      || receipt?.agent
      || receipt?.workflow
      || receipt?.automation
      || receipt?.scheduledWork,
    )
    if (!isWorker) continue
    const title = session.name?.trim()
      || receipt?.summary?.trim()
      || receipt?.agent?.name
      || receipt?.workflow?.slug
      || 'Active worker'
    const detail = receipt?.agent?.slug
      ? `@${receipt.agent.slug}`
      : session.spawnedFromAgent?.agentSlug
        ? `@${session.spawnedFromAgent.agentSlug}`
        : receipt?.workflow?.slug
          ? `Workflow · ${receipt.workflow.slug}`
          : receipt?.automation?.name
            ? `Automation · ${receipt.automation.name}`
            : 'Manual worker'
    items.push({
      id: `session:${session.id}`,
      title,
      detail,
      status: 'running',
      kind: 'session',
    })
  }

  return dedupeByTitle(items)
    .sort((left, right) => workerStatusRank(left.status) - workerStatusRank(right.status) || left.title.localeCompare(right.title))
    .slice(0, limit)
}

export function buildHqProjectColumns(
  campaigns: HqCampaignSummary[],
  work: ScheduledWorkOrder[],
): HqHomeProjectColumn[] {
  const primary = campaigns.find((campaign) => campaign.primary) ?? campaigns[0]
  const remaining = campaigns.filter((campaign) => campaign.id !== primary?.id)
  const activeWork = work
    .filter((order) => !order.deletedAt && ACTIVE_WORK_STATUSES.has(order.status))
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
  const waitingWork = work
    .filter((order) => !order.deletedAt && WAITING_WORK_STATUSES.has(order.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return [
    {
      id: 'focus',
      label: 'Focus',
      cards: primary ? [campaignCard(primary, 'active')] : [],
    },
    {
      id: 'active',
      label: 'Active',
      cards: activeWork.slice(0, 4).map(workCard),
    },
    {
      id: 'waiting',
      label: 'Waiting',
      cards: waitingWork.slice(0, 4).map(workCard),
    },
    {
      id: 'upcoming',
      label: 'Upcoming',
      cards: remaining.slice(0, 4).map((campaign) => campaignCard(campaign, 'planned')),
    },
  ]
}

/** Thin view over the shared focus selection (spec 20 §11) — one 45-day rule. */
export function resolveHqCampaignFocus(
  campaigns: HqCampaignSummary[],
  now = new Date(),
): HqCampaignFocus | null {
  const selected = resolveCampaignFocusByReleaseDate(
    campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      releaseDate: campaign.releaseDate,
      primary: campaign.primary,
    })),
    now,
  )
  if (!selected) return null
  const campaign = campaigns.find((candidate) => candidate.id === selected.id)
  if (!campaign) return null
  return {
    campaign,
    label: selected.label,
    ...(selected.releaseDate ? { dateLabel: formatReleaseDate(selected.releaseDate) } : {}),
  }
}

export function hqHeaderNextLabel(
  nextMoveTitle: string | undefined,
  timeline: HqHomeTimelineItem[],
): string {
  const nextTimeline = timeline[0]
  if (nextTimeline) return `${nextTimeline.when}: ${nextTimeline.title}`
  return nextMoveTitle?.trim() || 'Build the next move'
}

export function shouldRefreshHqStateOnOpen(generatedAt: string | undefined, now = new Date()): boolean {
  if (!generatedAt) return true
  const generated = Date.parse(generatedAt)
  if (Number.isNaN(generated)) return true
  return now.getTime() - generated >= 12 * 60 * 60 * 1000
}

function campaignCard(campaign: HqCampaignSummary, status: HqHomeProjectCard['status']): HqHomeProjectCard {
  return {
    id: `campaign:${campaign.id}`,
    title: campaign.name,
    detail: status === 'active' ? 'Open the primary campaign workspace' : 'Open campaign workspace',
    status,
    kind: 'campaign',
    workspaceId: campaign.id,
  }
}

function workCard(order: ScheduledWorkOrder): HqHomeProjectCard {
  return {
    id: `work:${order.id}`,
    title: order.title,
    detail: `${order.status.replaceAll('-', ' ')} · ${formatWorkOwner(order)}`,
    status: WAITING_WORK_STATUSES.has(order.status) ? 'waiting' : 'active',
    kind: 'scheduled-work',
  }
}

function formatWorkOwner(order: ScheduledWorkOrder): string {
  if (order.execution.type === 'agent-task') return `@${order.execution.agentSlug}`
  if (order.execution.type === 'workflow-run') return order.execution.workflowSlug
  return order.type.replaceAll('-', ' ')
}

function formatReleaseDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(year!, month! - 1, day!))
}

function dedupeByTitle(items: HqHomeWorkerItem[]): HqHomeWorkerItem[] {
  const bestByTitle = new Map<string, HqHomeWorkerItem>()
  for (const item of items) {
    const key = item.title.trim().toLowerCase()
    const current = bestByTitle.get(key)
    if (!current || workerStatusRank(item.status) < workerStatusRank(current.status)) {
      bestByTitle.set(key, item)
    }
  }
  return [...bestByTitle.values()]
}

function workerStatusRank(status: string): number {
  if (status === 'running') return 0
  if (status === 'scheduled' || status === 'active') return 1
  if (status === 'waiting') return 2
  return 3
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function addDaysKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const value = new Date(year!, month! - 1, day!)
  value.setDate(value.getDate() + days)
  return localDateKey(value)
}

function relativeDateLabel(dateKey: string, todayKey: string, time?: string): string {
  const days = dayDistance(todayKey, dateKey)
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : weekdayLabel(dateKey)
  return time ? `${day} ${time}` : day
}

function dayDistance(left: string, right: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year!, month! - 1, day!)
  }
  return Math.round((parse(right) - parse(left)) / (24 * 60 * 60 * 1000))
}

function weekdayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(year!, month! - 1, day!))
}
