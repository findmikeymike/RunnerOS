import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import { loadGlobalWorkflow, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { listOutputManifests, readOutputFinalsRegistry } from '@craft-agent/shared/outputs'
import { loadArtistVaultManifest } from '@craft-agent/shared/artist-vault'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendar,
  type CampaignCalendarItem,
} from '@craft-agent/shared/campaign-calendar'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  applyScheduledWorkMutation,
  emptyScheduledWorkDocument,
  migrateCampaignCalendarJobs,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  scheduledWorkDefinitionDigest,
  serializeScheduledWorkBody,
  type ScheduledWorkDocument,
  type ScheduleCampaignWorkInput,
  type ScheduleCampaignWorkResult,
  type CancelCampaignWorkInput,
  type CancelCampaignWorkResult,
  type DecideCampaignWorkInput,
  type DecideCampaignWorkResult,
  type ScheduledWorkMutation,
  type ScheduledWorkMutationResult,
  type ScheduledWorkParseResult,
} from '@craft-agent/shared/scheduled-work'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'

export interface ScheduledWorkMigrationResult {
  updated: boolean
  migrated: number
  work: ScheduledWorkDocument
  calendar: CampaignCalendar
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.scheduledWork.GET,
  RPC_CHANNELS.scheduledWork.MUTATE,
  RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN,
] as const

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function broadcastChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

function readScheduledWork(rootPath: string, workspaceId: string): ScheduledWorkParseResult {
  return parseScheduledWorkDocResult(loadContextDoc(rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
}

function readCampaignCalendar(rootPath: string, workspaceId: string) {
  return parseCampaignCalendarDocResult(loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspaceId)
}

function writeScheduledWork(rootPath: string, work: ScheduledWorkDocument): void {
  upsertContextDoc(rootPath, {
    slug: SCHEDULED_WORK_CONTEXT_SLUG,
    metadata: scheduledWorkMetadata(),
    body: serializeScheduledWorkBody(work),
  })
}

function writeCampaignCalendar(rootPath: string, calendar: CampaignCalendar): void {
  upsertContextDoc(rootPath, {
    slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
    metadata: campaignCalendarMetadata(),
    body: serializeCampaignCalendarBody(calendar),
  })
}

function sameScheduledWorkContent(left: ScheduledWorkDocument, right: ScheduledWorkDocument): boolean {
  return JSON.stringify({
    version: left.version,
    workspaceId: left.workspaceId,
    items: left.items,
  }) === JSON.stringify({
    version: right.version,
    workspaceId: right.workspaceId,
    items: right.items,
  })
}

export function registerScheduledWorkHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.scheduledWork.GET,
    async (_ctx, workspaceId: string): Promise<ScheduledWorkParseResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return readScheduledWork(rootPath, workspaceId)
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.MUTATE,
    async (_ctx, workspaceId: string, mutation: ScheduledWorkMutation): Promise<ScheduledWorkMutationResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const parsed = readScheduledWork(rootPath, workspaceId)
        if (!parsed.ok) throw new Error(parsed.error)
        const result = applyScheduledWorkMutation(parsed.work, mutation)
        if (!result.ok) return result
        writeScheduledWork(rootPath, result.work)
        broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
        return result
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN,
    async (_ctx, workspaceId: string, input: CancelCampaignWorkInput): Promise<CancelCampaignWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        const existingOrder = scheduled.work.items.find((candidate) => candidate.id === input.orderId && !candidate.deletedAt)
        const existingCalendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === input.calendarItemId)
        if (!existingOrder || !existingCalendarItem
          || existingOrder.calendarLink.itemId !== existingCalendarItem.id
          || existingCalendarItem.scheduledWorkId !== existingOrder.id) {
          throw new Error('Linked campaign work was not found.')
        }
        if (existingOrder.status === 'done') throw new Error('Completed work cannot be canceled.')
        const now = new Date().toISOString()
        const workResult = existingOrder.status === 'canceled'
          ? { ok: true as const, work: scheduled.work, item: existingOrder }
          : applyScheduledWorkMutation(scheduled.work, {
              operation: 'cancel',
              id: existingOrder.id,
              expectedUpdatedAt: existingOrder.updatedAt,
            }, now)
        if (!workResult.ok) throw new Error(workResult.error)
        const calendarItem = existingCalendarItem.deletedAt
          ? existingCalendarItem
          : { ...existingCalendarItem, status: 'canceled' as const, deletedAt: now, updatedAt: now }
        const calendar = existingCalendarItem.deletedAt
          ? parsedCalendar.calendar
          : {
              ...parsedCalendar.calendar,
              items: parsedCalendar.calendar.items.map((candidate) => candidate.id === calendarItem.id ? calendarItem : candidate),
              updatedAt: now,
            }

        if (existingOrder.status !== 'canceled') writeScheduledWork(rootPath, workResult.work)
        if (!existingCalendarItem.deletedAt) writeCampaignCalendar(rootPath, calendar)
        if (existingOrder.status !== 'canceled' || !existingCalendarItem.deletedAt) {
          broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
        }
        return {
          updated: existingOrder.status !== 'canceled' || !existingCalendarItem.deletedAt,
          work: workResult.work,
          order: workResult.item,
          calendar,
          calendarItem,
        }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN,
    async (_ctx, workspaceId: string, input: DecideCampaignWorkInput): Promise<DecideCampaignWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        const order = scheduled.work.items.find((candidate) => candidate.id === input.orderId && !candidate.deletedAt)
        const linkedItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === input.calendarItemId && !candidate.deletedAt)
        if (!order || !linkedItem
          || order.calendarLink.itemId !== linkedItem.id
          || linkedItem.scheduledWorkId !== order.id) {
          throw new Error('Linked campaign work was not found.')
        }
        const notes = input.notes?.trim() || undefined
        if (input.decision === 'changes-requested' && !notes) {
          throw new Error('Explain the changes requested.')
        }
        const alreadyDecided = order.reviewDecision !== undefined
        if (alreadyDecided && (order.reviewDecision!.decision !== input.decision || order.reviewDecision!.notes !== notes)) {
          throw new Error('Scheduled work already has a different review decision.')
        }
        if (!alreadyDecided && order.updatedAt !== input.expectedUpdatedAt) {
          throw new Error(`Scheduled work order changed before this decision: ${order.id}`)
        }
        if (!alreadyDecided && order.status !== 'awaiting-review') {
          throw new Error('Only work awaiting review can receive a decision.')
        }
        const now = new Date().toISOString()
        const reviewer = order.execution.type === 'review'
          ? { reviewerType: order.execution.reviewerType, reviewerId: order.execution.reviewerId }
          : { reviewerType: 'user' as const, reviewerId: undefined }
        const reviewDecision = { decision: input.decision, notes, decidedAt: now, ...reviewer }
        const nextOrder = alreadyDecided ? order : {
          ...order,
          status: input.decision === 'approved' ? 'done' as const : 'needs-attention' as const,
          reviewDecision,
          result: order.type === 'review'
            ? { type: 'review' as const, decision: input.decision, notes }
            : order.result,
          attention: input.decision === 'changes-requested'
            ? { reason: 'changes-requested' as const, message: notes! }
            : undefined,
          updatedAt: now,
        }
        const nextWork = alreadyDecided ? scheduled.work : {
          ...scheduled.work,
          items: scheduled.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate),
          updatedAt: now,
        }
        const calendarStatus = input.decision === 'approved' ? 'done' as const : 'failed' as const
        const calendarItem = {
          ...linkedItem,
          status: calendarStatus,
          updatedAt: now,
        }
        const calendarAlreadyUpdated = linkedItem.status === calendarStatus
        const calendar = calendarAlreadyUpdated ? parsedCalendar.calendar : {
          ...parsedCalendar.calendar,
          items: parsedCalendar.calendar.items.map((candidate) => candidate.id === calendarItem.id ? calendarItem : candidate),
          updatedAt: now,
        }
        if (!alreadyDecided) writeScheduledWork(rootPath, nextWork)
        if (!calendarAlreadyUpdated) writeCampaignCalendar(rootPath, calendar)
        if (!alreadyDecided || !calendarAlreadyUpdated) {
          broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
        }
        return { work: nextWork, order: nextOrder, calendar, calendarItem }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN,
    async (_ctx, workspaceId: string, input: ScheduleCampaignWorkInput): Promise<ScheduleCampaignWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const validation = applyScheduledWorkMutation(emptyScheduledWorkDocument(workspaceId), {
          operation: 'upsert',
          order: input.order,
          expectedUpdatedAt: null,
        }, input.order?.updatedAt)
        if (!validation.ok) throw new Error(validation.error)
        const validatedInput = { ...input, order: validation.item }
        assertCampaignScheduleInput(workspaceId, validatedInput)
        await validateScheduleRuntime(deps, rootPath, validatedInput.order)
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        if (parsedCalendar.calendar.campaignId !== workspaceId) {
          throw new Error(`Campaign Calendar belongs to workspace ${parsedCalendar.calendar.campaignId}, not ${workspaceId}.`)
        }

        const existingOrder = scheduled.work.items.find((candidate) => candidate.id === validatedInput.order.id)
        if (existingOrder && !sameScheduleIdentity(existingOrder, validatedInput.order)) {
          throw new Error(`Scheduled work id already exists with different execution data: ${validatedInput.order.id}`)
        }
        const candidateOrder = existingOrder ?? validatedInput.order
        const workResult = existingOrder
          ? { ok: true as const, work: scheduled.work, item: existingOrder }
          : applyScheduledWorkMutation(scheduled.work, {
              operation: 'upsert',
              order: candidateOrder,
              expectedUpdatedAt: null,
            }, candidateOrder.updatedAt)
        if (!workResult.ok) throw new Error(workResult.error)
        const order = workResult.item

        const existingCalendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === validatedInput.calendarItem.id)
        if (existingCalendarItem && existingCalendarItem.scheduledWorkId !== order.id) {
          throw new Error(`Campaign Calendar item id already belongs to different work: ${validatedInput.calendarItem.id}`)
        }
        if (existingCalendarItem) assertCampaignShellMatchesOrder(order, existingCalendarItem)
        const calendarItem = existingCalendarItem ?? validatedInput.calendarItem
        const calendar = existingCalendarItem
          ? parsedCalendar.calendar
          : {
              ...parsedCalendar.calendar,
              items: [...parsedCalendar.calendar.items, calendarItem],
              updatedAt: new Date().toISOString(),
            }

        if (!existingOrder) writeScheduledWork(rootPath, workResult.work)
        if (!existingCalendarItem) writeCampaignCalendar(rootPath, calendar)
        if (!existingOrder || !existingCalendarItem) {
          broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
        }

        return {
          updated: !existingOrder || !existingCalendarItem,
          work: workResult.work,
          order,
          calendar,
          calendarItem,
        }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN,
    async (_ctx, workspaceId: string): Promise<ScheduledWorkMigrationResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const calendar = readCampaignCalendar(rootPath, workspaceId)
        if (!calendar.ok) throw new Error(calendar.error)

        const migrated = migrateCampaignCalendarJobs(calendar.calendar, scheduled.work)
        const workChanged = !sameScheduledWorkContent(scheduled.work, migrated.work)
        const calendarChanged = migrated.calendar !== calendar.calendar

        if (workChanged) writeScheduledWork(rootPath, migrated.work)
        if (calendarChanged) writeCampaignCalendar(rootPath, migrated.calendar)
        if (workChanged || calendarChanged) {
          broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
        }

        return {
          updated: workChanged || calendarChanged,
          migrated: migrated.migrated,
          work: migrated.work,
          calendar: migrated.calendar,
        }
      })
    },
  )
}

function assertCampaignScheduleInput(workspaceId: string, input: ScheduleCampaignWorkInput): void {
  const { order, calendarItem } = input
  if (order.owner.scope !== 'campaign'
    || order.owner.workspaceId !== workspaceId
    || order.owner.campaignId !== workspaceId
    || order.calendarLink.calendar !== 'campaign') {
    throw new Error('Scheduled work owner does not match the campaign workspace.')
  }
  if (calendarItem.id !== order.calendarLink.itemId
    || calendarItem.scheduledWorkId !== order.id
    || calendarItem.kind !== 'scheduled-job'
    || calendarItem.source !== 'user'
    || calendarItem.status !== order.status
    || (order.status !== 'scheduled' && order.status !== 'needs-approval')
    || order.approvals.length > 0
    || order.runs.length > 0
    || order.result
    || order.deletedAt
    || (calendarItem.approvals?.length ?? 0) > 0
    || calendarItem.runHistory.length > 0
    || calendarItem.job
    || calendarItem.deletedAt) {
    throw new Error('Campaign Calendar shell does not match the scheduled work order.')
  }
  assertCampaignShellMatchesOrder(order, calendarItem)
}

function assertCampaignShellMatchesOrder(order: ScheduledWorkDocument['items'][number], calendarItem: CampaignCalendarItem): void {
  const localStart = formatInTimezone(order.startAt, order.timezone)
  const finalRefs = order.inputRefs
    .filter((ref) => ref.kind === 'final')
    .map((ref) => ({ outputId: ref.outputId, assetId: ref.assetId, slot: ref.slot, label: ref.label }))
  const outputRefs = order.inputRefs
    .filter((ref) => ref.kind === 'output')
    .map((ref) => ({ outputId: ref.outputId, title: ref.title, kind: ref.outputKind }))
  const assetRefs = order.inputRefs
    .filter((ref) => ref.kind === 'vault')
    .map((ref) => ({ assetId: ref.assetId, label: ref.label, kind: ref.assetKind }))
  const expectedSocialProfiles = order.execution.type === 'social-publish'
    ? [{ platform: order.execution.platform, profileId: order.execution.profileId }]
    : []
  const actualSocialProfiles = (calendarItem.socialProfileRefs ?? [])
    .map((ref) => ({ platform: ref.platform, profileId: ref.profileId }))
  const expectedAccountSetId = order.execution.type === 'social-publish' ? order.execution.accountSetId : undefined

  if (calendarItem.title !== order.title
    || calendarItem.date !== localStart.date
    || calendarItem.time !== localStart.time
    || calendarItem.timezone !== order.timezone
    || calendarItem.accountSetId !== expectedAccountSetId
    || calendarItem.personIds.length > 0
    || !sameJson(calendarItem.finalRefs, finalRefs)
    || !sameJson(calendarItem.outputRefs, outputRefs)
    || !sameJson(calendarItem.assetRefs, assetRefs)
    || !sameJson(actualSocialProfiles, expectedSocialProfiles)) {
    throw new Error('Campaign Calendar shell does not match the scheduled work order.')
  }
}

function formatInTimezone(value: string, timezone: string): { date: string; time: string } {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Scheduled work start time is invalid.')
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
  } catch {
    throw new Error(`Scheduled work timezone is invalid: ${timezone}`)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameScheduleIdentity(left: ScheduledWorkDocument['items'][number], right: ScheduledWorkDocument['items'][number]): boolean {
  return left.id === right.id
    && left.owner.workspaceId === right.owner.workspaceId
    && left.calendarLink.calendar === right.calendarLink.calendar
    && left.calendarLink.itemId === right.calendarLink.itemId
    && left.executionKey.idempotencyKey === right.executionKey.idempotencyKey
    && left.executionKey.payloadDigest === right.executionKey.payloadDigest
}

async function validateScheduleRuntime(deps: HandlerDeps, rootPath: string, order: ScheduledWorkDocument['items'][number]): Promise<void> {
  if (order.execution.type === 'agent-task') {
    if (!readActivatedAgents(rootPath).active.includes(order.execution.agentSlug)) {
      throw new Error(`Agent is not active in this workspace: ${order.execution.agentSlug}`)
    }
    if (!loadGlobalAgent(order.execution.agentSlug)) {
      throw new Error(`Agent definition was not found: ${order.execution.agentSlug}`)
    }
  }
  if (order.execution.type === 'workflow-run') {
    if (!readActivatedWorkflows(rootPath).active.includes(order.execution.workflowSlug)) {
      throw new Error(`Workflow is not active in this workspace: ${order.execution.workflowSlug}`)
    }
    const workflow = loadGlobalWorkflow(order.execution.workflowSlug)
    if (!workflow) throw new Error(`Workflow definition was not found: ${order.execution.workflowSlug}`)
    const digest = scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body })
    if (digest !== order.execution.workflowDigest) {
      throw new Error(`Workflow changed before it could be scheduled: ${order.execution.workflowSlug}`)
    }
  }
  if (order.execution.type === 'social-publish') {
    if (!deps.validateSocialProfile) throw new Error('Social profile validation is unavailable on this host.')
    const profile = await deps.validateSocialProfile({
      platform: order.execution.platform,
      profileId: order.execution.profileId,
    })
    if (!profile.ready) throw new Error(profile.reason ?? 'Social profile is not ready.')
  }

  const outputs = new Map(listOutputManifests(rootPath).map((output) => [output.id, output]))
  const finals = readOutputFinalsRegistry(rootPath).finals
  const vault = loadArtistVaultManifest(rootPath, order.owner.workspaceId)
  for (const ref of order.inputRefs) {
    if (ref.kind === 'output' && !outputs.has(ref.outputId)) {
      throw new Error(`Referenced Output was not found: ${ref.outputId}`)
    }
    if (ref.kind === 'final') {
      const matchingFinal = finals.some((final) => final.outputId === ref.outputId
        && (!ref.assetId || final.assetId === ref.assetId)
        && (!ref.slot || final.slot === ref.slot))
      if (!outputs.has(ref.outputId) || !matchingFinal) {
        throw new Error(`Referenced Final was not found: ${ref.outputId}`)
      }
    }
    if (ref.kind === 'vault') {
      const asset = vault.assets.find((candidate) => candidate.id === ref.assetId)
      if (!asset || asset.status === 'missing' || asset.status === 'archived') {
        throw new Error(`Referenced Vault asset is unavailable: ${ref.assetId}`)
      }
    }
  }
}
