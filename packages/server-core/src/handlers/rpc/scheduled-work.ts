import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createHash } from 'node:crypto'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import { loadGlobalWorkflow, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { listOutputManifests, readOutputFinalsRegistry } from '@craft-agent/shared/outputs'
import { refreshHqStateContextDocBestEffort } from '../../hq-state/refresh'
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
  type ScheduleCampaignChainInput,
  type ScheduleCampaignChainResult,
  type CancelCampaignWorkInput,
  type CancelCampaignWorkResult,
  type DecideCampaignWorkInput,
  type DecideCampaignWorkResult,
  type ResolveCampaignProducedOutputInput,
  type ResolveCampaignProducedOutputResult,
  type ApproveCampaignSocialWorkInput,
  type ApproveCampaignSocialWorkResult,
  type ScheduleHqWorkInput,
  type ScheduleHqWorkResult,
  type ScheduledWorkMutation,
  type ScheduledWorkMutationResult,
  type ScheduledWorkParseResult,
} from '@craft-agent/shared/scheduled-work'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
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
  RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN,
  RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.RESOLVE_CAMPAIGN_OUTPUT,
  RPC_CHANNELS.scheduledWork.APPROVE_CAMPAIGN_SOCIAL,
  RPC_CHANNELS.scheduledWork.SCHEDULE_HQ,
  RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN,
] as const

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function broadcastChanged(deps: HandlerDeps, workspaceId: string, rootPath: string): void {
  refreshHqStateContextDocBestEffort(rootPath)
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, loadAllContextDocs(rootPath))
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
        broadcastChanged(deps, workspaceId, rootPath)
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
          broadcastChanged(deps, workspaceId, rootPath)
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
        const decidedItems = scheduled.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate)
        const downstream = decidedItems.find((candidate) => candidate.chain?.predecessor?.orderId === nextOrder.id
          && candidate.chain.predecessor.releaseOn === 'creative-approval')
        const nextDownstream = downstream && !alreadyDecided ? {
          ...downstream,
          status: input.decision === 'approved' ? 'needs-approval' as const : 'canceled' as const,
          attention: input.decision === 'approved' ? undefined : { reason: 'changes-requested' as const, message: notes! },
          updatedAt: now,
        } : downstream
        const nextWork = alreadyDecided ? scheduled.work : {
          ...scheduled.work,
          items: decidedItems.map((candidate) => candidate.id === nextDownstream?.id ? nextDownstream : candidate),
          updatedAt: now,
        }
        const calendarStatus = input.decision === 'approved' ? 'done' as const : 'failed' as const
        const calendarItem = {
          ...linkedItem,
          status: calendarStatus,
          updatedAt: now,
        }
        const downstreamCalendarItem = nextDownstream
          ? parsedCalendar.calendar.items.find((candidate) => candidate.id === nextDownstream.calendarLink.itemId)
          : undefined
        const downstreamCalendarStatus = nextDownstream?.status === 'needs-approval' ? 'needs-approval' as const : nextDownstream ? 'canceled' as const : undefined
        const calendarAlreadyUpdated = linkedItem.status === calendarStatus
          && (!downstreamCalendarItem || downstreamCalendarItem.status === downstreamCalendarStatus)
        const calendar = calendarAlreadyUpdated ? parsedCalendar.calendar : {
          ...parsedCalendar.calendar,
          items: parsedCalendar.calendar.items.map((candidate) => {
            if (candidate.id === calendarItem.id) return calendarItem
            if (candidate.id === downstreamCalendarItem?.id && downstreamCalendarStatus) {
              return { ...candidate, status: downstreamCalendarStatus, updatedAt: now }
            }
            return candidate
          }),
          updatedAt: now,
        }
        if (!alreadyDecided) writeScheduledWork(rootPath, nextWork)
        if (!calendarAlreadyUpdated) writeCampaignCalendar(rootPath, calendar)
        if (!alreadyDecided || !calendarAlreadyUpdated) {
          broadcastChanged(deps, workspaceId, rootPath)
        }
        return { work: nextWork, order: nextOrder, calendar, calendarItem }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.RESOLVE_CAMPAIGN_OUTPUT,
    async (_ctx, workspaceId: string, input: ResolveCampaignProducedOutputInput): Promise<ResolveCampaignProducedOutputResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        const order = scheduled.work.items.find((candidate) => candidate.id === input.orderId && !candidate.deletedAt)
        const calendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === input.calendarItemId && !candidate.deletedAt)
        if (!order || !calendarItem || calendarItem.scheduledWorkId !== order.id || order.calendarLink.itemId !== calendarItem.id) {
          throw new Error('Linked campaign work was not found.')
        }
        if (order.updatedAt !== input.expectedUpdatedAt) throw new Error(`Scheduled work order changed before Output selection: ${order.id}`)
        if (order.status !== 'needs-attention'
          || (order.attention?.reason !== 'produced-output-missing' && order.attention?.reason !== 'produced-output-ambiguous')) {
          throw new Error('This work is not waiting for an exact produced Output.')
        }
        const predecessorId = order.chain?.predecessor?.orderId
        const parent = scheduled.work.items.find((candidate) => candidate.id === predecessorId && candidate.status === 'done')
        const parentOutputIds = parent?.result && 'outputIds' in parent.result ? parent.result.outputIds : []
        if (!parent || !parentOutputIds.includes(input.outputId)) throw new Error('Selected Output was not produced by the predecessor.')
        const manifest = listOutputManifests(rootPath).find((candidate) => candidate.id === input.outputId)
        if (!manifest) throw new Error('Selected Output no longer exists.')
        const producedRef = order.inputRefs.find((ref) => ref.kind === 'produced-output')
        if (!producedRef || (producedRef.selector?.kind && producedRef.selector.kind !== manifest.kind)) {
          throw new Error('Selected Output does not match the required kind.')
        }
        const now = new Date().toISOString()
        const resolution = { outputId: input.outputId, parentResultDigest: scheduledWorkDefinitionDigest(parent.result), source: 'user' as const, resolvedAt: now }
        const inputRefs = order.inputRefs.map((ref) => ref === producedRef ? { ...ref, resolution } : ref)
        let execution = order.execution
        if (execution.type === 'workflow-run' && producedRef.bindTo.kind === 'workflow-trigger') {
          execution = { ...execution, triggerInputs: { ...execution.triggerInputs, [producedRef.bindTo.input]: input.outputId } }
        }
        const nextOrder = { ...order, status: order.type === 'review' ? 'awaiting-review' as const : 'scheduled' as const, attention: undefined, inputRefs, execution, updatedAt: now }
        const work = { ...scheduled.work, items: scheduled.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate), updatedAt: now }
        const nextCalendarItem = { ...calendarItem, status: order.type === 'review' ? 'needs-approval' as const : 'scheduled' as const, updatedAt: now }
        const calendar = { ...parsedCalendar.calendar, items: parsedCalendar.calendar.items.map((candidate) => candidate.id === nextCalendarItem.id ? nextCalendarItem : candidate), updatedAt: now }
        writeScheduledWork(rootPath, work)
        writeCampaignCalendar(rootPath, calendar)
        broadcastChanged(deps, workspaceId, rootPath)
        return { work, order: nextOrder, calendar, calendarItem: nextCalendarItem }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.APPROVE_CAMPAIGN_SOCIAL,
    async (ctx, workspaceId: string, input: ApproveCampaignSocialWorkInput): Promise<ApproveCampaignSocialWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        const order = scheduled.work.items.find((candidate) => candidate.id === input.orderId && !candidate.deletedAt)
        const calendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === input.calendarItemId && !candidate.deletedAt)
        if (!order || !calendarItem || calendarItem.scheduledWorkId !== order.id || order.calendarLink.itemId !== calendarItem.id) {
          throw new Error('Linked campaign work was not found.')
        }
        if (order.updatedAt !== input.expectedUpdatedAt) throw new Error(`Scheduled work order changed before social approval: ${order.id}`)
        if (order.status !== 'needs-approval' || order.execution.type !== 'social-publish' || !order.socialAction) {
          throw new Error('Social work needs a current dry-run before approval.')
        }
        const now = new Date()
        if (Date.parse(order.startAt) - now.getTime() > 30 * 60 * 1000) {
          throw new Error('Social approval opens 30 minutes before the scheduled publish time.')
        }
        if (order.socialAction.payloadDigest !== order.executionKey.payloadDigest
          || order.socialAction.platform !== order.execution.platform
          || order.socialAction.profileId !== order.execution.profileId) {
          throw new Error('Social dry-run no longer matches the work order.')
        }
        assertNativeSocialPreview(order)
        const expiresAt = new Date(Math.max(now.getTime(), Date.parse(order.startAt)) + 30 * 60 * 1000).toISOString()
        const approval = {
          id: `scheduled-social-approval-${order.id}-${now.getTime()}`,
          approvedAt: now.toISOString(),
          expiresAt,
          actionId: order.socialAction.actionId,
          actionDigest: order.socialAction.actionDigest,
          mediaDigest: order.socialAction.mediaDigest,
          payloadDigest: order.socialAction.payloadDigest,
          platform: order.socialAction.platform,
          profileId: order.socialAction.profileId,
          approvedBy: { type: 'user' as const, clientId: ctx.clientId },
        }
        const nextOrder = { ...order, socialApproval: approval, updatedAt: now.toISOString() }
        const work = { ...scheduled.work, items: scheduled.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate), updatedAt: now.toISOString() }
        writeScheduledWork(rootPath, work)
        broadcastChanged(deps, workspaceId, rootPath)
        return { work, order: nextOrder, calendar: parsedCalendar.calendar, calendarItem }
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
          broadcastChanged(deps, workspaceId, rootPath)
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
    RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN,
    async (_ctx, workspaceId: string, input: ScheduleCampaignChainInput): Promise<ScheduleCampaignChainResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        assertCampaignChainInput(workspaceId, input)
        for (let index = 0; index < input.orders.length; index += 1) {
          const order = input.orders[index]!
          const shell = input.calendarItems[index]!
          const validation = applyScheduledWorkMutation(emptyScheduledWorkDocument(workspaceId), {
            operation: 'upsert', order, expectedUpdatedAt: null,
          }, order.updatedAt)
          if (!validation.ok) throw new Error(validation.error)
          assertCampaignScheduleInput(workspaceId, { order: validation.item, calendarItem: shell }, true)
          await validateScheduleRuntime(deps, rootPath, validation.item)
        }
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)

        const resolvedOrders = input.orders.map((candidate) => {
          const existing = scheduled.work.items.find((item) => item.id === candidate.id)
          if (existing && !sameScheduleIdentity(existing, candidate)) {
            throw new Error(`Scheduled work id already exists with different execution data: ${candidate.id}`)
          }
          return existing ?? candidate
        }) as [ScheduledWorkDocument['items'][number], ScheduledWorkDocument['items'][number]]
        const missingOrders = resolvedOrders.filter((order) => !scheduled.work.items.some((item) => item.id === order.id))
        const work = missingOrders.length === 0 ? scheduled.work : {
          ...scheduled.work,
          items: [...scheduled.work.items, ...missingOrders],
          updatedAt: new Date().toISOString(),
        }

        const resolvedShells = input.calendarItems.map((candidate, index) => {
          const existing = parsedCalendar.calendar.items.find((item) => item.id === candidate.id)
          if (existing && existing.scheduledWorkId !== resolvedOrders[index]!.id) {
            throw new Error(`Campaign Calendar item id already belongs to different work: ${candidate.id}`)
          }
          if (existing) assertCampaignShellMatchesOrder(resolvedOrders[index]!, existing)
          return existing ?? candidate
        }) as [CampaignCalendarItem, CampaignCalendarItem]
        const missingShells = resolvedShells.filter((item) => !parsedCalendar.calendar.items.some((candidate) => candidate.id === item.id))
        const calendar = missingShells.length === 0 ? parsedCalendar.calendar : {
          ...parsedCalendar.calendar,
          items: [...parsedCalendar.calendar.items, ...missingShells],
          updatedAt: new Date().toISOString(),
        }
        if (missingOrders.length > 0) writeScheduledWork(rootPath, work)
        if (missingShells.length > 0) writeCampaignCalendar(rootPath, calendar)
        if (missingOrders.length > 0 || missingShells.length > 0) {
          broadcastChanged(deps, workspaceId, rootPath)
        }
        return {
          updated: missingOrders.length > 0 || missingShells.length > 0,
          work,
          orders: resolvedOrders,
          calendar,
          calendarItems: resolvedShells,
        }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.SCHEDULE_HQ,
    async (_ctx, workspaceId: string, input: ScheduleHqWorkInput): Promise<ScheduleHqWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextLock(rootPath, async () => {
        if (!input.requestId.trim() || input.orders.length !== 1) throw new Error('HQ work plan is invalid.')
        for (const order of input.orders) {
          const validation = applyScheduledWorkMutation(emptyScheduledWorkDocument(workspaceId), { operation: 'upsert', order, expectedUpdatedAt: null }, order.updatedAt)
          if (!validation.ok) throw new Error(validation.error)
          if (order.owner.scope !== 'hq' || order.owner.workspaceId !== workspaceId || order.owner.campaignId || order.calendarLink.calendar !== 'hq') {
            throw new Error('Scheduled work owner does not match the HQ workspace.')
          }
          if ((order.type !== 'agent-task' && order.type !== 'workflow-run') || order.status !== 'scheduled' || order.chain) {
            throw new Error('HQ Calendar currently supports standalone agent and workflow work only.')
          }
          await validateScheduleRuntime(deps, rootPath, order)
        }
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const resolvedOrders = input.orders.map((candidate) => {
          const existing = scheduled.work.items.find((item) => item.id === candidate.id)
          if (existing && !sameScheduleIdentity(existing, candidate)) throw new Error(`Scheduled work id already exists with different execution data: ${candidate.id}`)
          return existing ?? candidate
        })
        const missingOrders = resolvedOrders.filter((order) => !scheduled.work.items.some((candidate) => candidate.id === order.id))
        const work = missingOrders.length ? { ...scheduled.work, items: [...scheduled.work.items, ...missingOrders], updatedAt: new Date().toISOString() } : scheduled.work
        const artistCalendar = readArtistCalendar(rootPath)
        for (const order of resolvedOrders) {
          const existingEvent = artistCalendar.events.find((event) => event.id === order.calendarLink.itemId)
          if (existingEvent && existingEvent.scheduledWorkId !== order.id) throw new Error(`Artist Calendar event id already belongs to different work: ${existingEvent.id}`)
        }
        const missingEvents = resolvedOrders.filter((order) => !artistCalendar.events.some((event) => event.id === order.calendarLink.itemId)).map(hqEventFromOrder)
        if (missingOrders.length) writeScheduledWork(rootPath, work)
        if (missingEvents.length) writeArtistCalendar(rootPath, { ...artistCalendar, events: [...artistCalendar.events, ...missingEvents], updatedAt: new Date().toISOString() })
        if (missingOrders.length || missingEvents.length) broadcastChanged(deps, workspaceId, rootPath)
        return { updated: Boolean(missingOrders.length || missingEvents.length), work, orders: resolvedOrders }
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
          broadcastChanged(deps, workspaceId, rootPath)
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

function assertCampaignScheduleInput(workspaceId: string, input: ScheduleCampaignWorkInput, allowWaiting = false): void {
  const { order, calendarItem } = input
  const expectedShellStatus = order.status === 'waiting' ? 'draft' : order.status
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
    || calendarItem.status !== expectedShellStatus
    || (order.status !== 'scheduled' && order.status !== 'needs-approval' && !(allowWaiting && order.status === 'waiting'))
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

function assertCampaignChainInput(workspaceId: string, input: ScheduleCampaignChainInput): void {
  const [root, child] = input.orders
  const [rootShell, childShell] = input.calendarItems
  const chainId = `campaign-chain-${input.requestId}`
  const allowedPair = (root.type === 'agent-task' && (child.type === 'review' || child.type === 'workflow-run'))
    || (root.type === 'workflow-run' && child.type === 'review')
    || (root.type === 'review' && child.type === 'social-publish')
  const producedRefs = child.inputRefs.filter((ref) => ref.kind === 'produced-output')
  const validInputs = root.type === 'review'
    ? root.inputRefs.length === 1
      && child.inputRefs.length === 1
      && JSON.stringify(root.inputRefs) === JSON.stringify(child.inputRefs)
      && (root.inputRefs[0]?.kind === 'final' || root.inputRefs[0]?.kind === 'output')
    : producedRefs.length === 1
      && (child.type === 'review'
        ? producedRefs[0]?.bindTo.kind === 'review-target'
        : producedRefs[0]?.bindTo.kind === 'workflow-trigger')
  const duplicateReviewGate = root.execution.type === 'agent-task'
    && child.type === 'review'
    && root.execution.expectedOutput.reviewRequired === true
  if (!input.requestId.trim()
    || !allowedPair
    || !validInputs
    || duplicateReviewGate
    || root.id !== `${chainId}-0`
    || child.id !== `${chainId}-1`
    || rootShell.id !== `${chainId}-calendar-0`
    || childShell.id !== `${chainId}-calendar-1`
    || root.status !== 'scheduled'
    || child.status !== 'waiting'
    || root.owner.workspaceId !== workspaceId
    || child.owner.workspaceId !== workspaceId
    || root.chain?.chainId !== chainId
    || root.chain.stepId !== `${chainId}-step-0`
    || root.chain.ordinal !== 0
    || root.chain.predecessor
    || child.chain?.chainId !== chainId
    || child.chain.stepId !== `${chainId}-step-1`
    || child.chain.ordinal !== 1
    || child.chain.predecessor?.orderId !== root.id
    || child.chain.predecessor.stepId !== root.chain.stepId
    || child.chain.predecessor.releaseOn !== (root.type === 'review' ? 'creative-approval' : 'success')) {
    throw new Error('Campaign work chain is invalid.')
  }
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

function assertNativeSocialPreview(order: ScheduledWorkDocument['items'][number]): void {
  if (order.execution.type !== 'social-publish' || !order.socialAction) throw new Error('Social dry-run is missing.')
  const dryRun = order.socialAction.dryRun
  const action = dryRun.action
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Social dry-run action is missing.')
  const record = action as Record<string, unknown>
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload as Record<string, unknown> : {}
  const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options) ? record.options as Record<string, unknown> : {}
  const digest = `sha256:${createHash('sha256').update(stableSocialStringify({ action, browserPlan: dryRun.browserPlan, mediaDigest: order.socialAction.mediaDigest })).digest('hex')}`
  const youtubeSettingsMatch = order.execution.platform !== 'youtube' || (
    payload.postType === (typeof order.execution.platformOptions?.postType === 'string' ? order.execution.platformOptions.postType : 'video')
    && payload.visibility === (typeof order.execution.platformOptions?.visibility === 'string' ? order.execution.platformOptions.visibility : 'private')
    && payload.madeForKids === (typeof order.execution.platformOptions?.madeForKids === 'string' ? order.execution.platformOptions.madeForKids : 'no')
  )
  if (record.actionId !== order.socialAction.actionId
    || record.platform !== order.execution.platform
    || record.profile !== order.execution.profileId
    || payload.text !== order.execution.caption
    || options.idempotencyKey !== order.executionKey.idempotencyKey
    || options.dryRun !== true
    || !youtubeSettingsMatch
    || digest !== order.socialAction.actionDigest) {
    throw new Error('Social dry-run no longer matches the work order.')
  }
}

function stableSocialStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSocialStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSocialStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

type ArtistCalendarServerEvent = {
  id: string
  date: string
  title: string
  time?: string
  notes?: string
  scheduledWorkId?: string
  workspaceLinks: unknown[]
  relatedPersonIds: string[]
  createdAt: string
  updatedAt: string
}

type ArtistCalendarServerDocument = { version: 1; events: ArtistCalendarServerEvent[]; updatedAt: string }
const ARTIST_CALENDAR_CONTEXT_SLUG = 'artist-calendar'

function readArtistCalendar(rootPath: string): ArtistCalendarServerDocument {
  const doc = loadContextDoc(rootPath, ARTIST_CALENDAR_CONTEXT_SLUG)
  if (!doc) return { version: 1, events: [], updatedAt: new Date().toISOString() }
  const match = doc.body.match(/```json\s*([\s\S]*?)```/i)
  if (!match?.[1]) throw new Error('Artist Calendar JSON block is missing.')
  const parsed = JSON.parse(match[1]) as Partial<ArtistCalendarServerDocument>
  if (parsed.version !== 1 || !Array.isArray(parsed.events)) throw new Error('Artist Calendar JSON has an unsupported shape.')
  return { version: 1, events: parsed.events as ArtistCalendarServerEvent[], updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString() }
}

function writeArtistCalendar(rootPath: string, calendar: ArtistCalendarServerDocument): void {
  upsertContextDoc(rootPath, {
    slug: ARTIST_CALENDAR_CONTEXT_SLUG,
    metadata: { name: 'Artist Calendar', description: 'Global dates, deadlines, meetings, releases, reminders, and scheduled work.', routing: { mode: 'broadcast' }, enabled: true },
    body: ['This is global artist calendar context. Treat it as long-term creator context, not one-campaign context.', '', '```json', JSON.stringify(calendar, null, 2), '```'].join('\n'),
  })
}

function hqEventFromOrder(order: ScheduledWorkDocument['items'][number]): ArtistCalendarServerEvent {
  const local = formatInTimezone(order.startAt, order.timezone)
  return {
    id: order.calendarLink.itemId,
    date: local.date,
    time: local.time,
    title: order.title,
    scheduledWorkId: order.id,
    workspaceLinks: [],
    relatedPersonIds: [],
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }
}


function sameScheduleIdentity(left: ScheduledWorkDocument['items'][number], right: ScheduledWorkDocument['items'][number]): boolean {
  return sameJson({
    id: left.id,
    owner: left.owner,
    calendarLink: left.calendarLink,
    title: left.title,
    type: left.type,
    status: left.status,
    startAt: left.startAt,
    dueAt: left.dueAt,
    timezone: left.timezone,
    execution: left.execution,
    inputRefs: left.inputRefs,
    executionKey: left.executionKey,
    chain: left.chain,
  }, {
    id: right.id,
    owner: right.owner,
    calendarLink: right.calendarLink,
    title: right.title,
    type: right.type,
    status: right.status,
    startAt: right.startAt,
    dueAt: right.dueAt,
    timezone: right.timezone,
    execution: right.execution,
    inputRefs: right.inputRefs,
    executionKey: right.executionKey,
    chain: right.chain,
  })
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
