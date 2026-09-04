import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { loadGlobalAgent, readActivatedAgents } from '@craft-agent/shared/agent-definitions'
import { loadGlobalWorkflow, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import {
  listOutputManifests,
  readOutputFinalsRegistry,
  readOutputManifest,
  resolveOutputAssetPath,
  writeOutputManifest,
  type OutputAsset,
  type OutputManifest,
} from '@craft-agent/shared/outputs'
import { refreshArtistManagerStateForWorkspaceBestEffort } from '../../hq-state/refresh'
import { loadArtistVaultManifest } from '@craft-agent/shared/artist-vault'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  type ArtistCalendar,
  type ArtistCalendarEvent,
} from '@craft-agent/shared/artist-context'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  createCampaignCalendarItem,
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
  stableScheduledWorkAuthorizationStringify,
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
  type AuthorizeReleaseKitSocialInput,
  type AuthorizeReleaseKitSocialResult,
  type ReauthorizeReleaseKitSocialInput,
  type ReauthorizeReleaseKitSocialResult,
  type ReleaseKitSocialAuthorizationDefinition,
  type XEditorialSocialAuthorizationDefinition,
  type ScheduledSocialDefinitionChange,
  type ScheduledWorkAuthorization,
  type ScheduleHqWorkInput,
  type ScheduleHqWorkResult,
  type ScheduledWorkMutation,
  type ScheduledWorkMutationResult,
  type ScheduledWorkParseResult,
  type ManageGoalRunInput,
  type ManageGoalRunResult,
  type SupplyScheduledWorkInput,
  type SupplyScheduledWorkInputResult,
  isReleaseKitSocialAuthorizationDefinition,
} from '@craft-agent/shared/scheduled-work'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
} from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'
import {
  assertNoArtistSocialScheduleConflict,
  withArtistSocialScheduleLock,
  type ArtistSocialWorkEntry,
} from '../../scheduled-work/SocialPublishConflictGuard'
import { SocialVariantSetService } from '../../outputs/SocialVariantSetService'
import { supplyScheduledWorkInputs } from '../../scheduled-work/ScheduledWorkInputSupply'
import { assertTeamPermission } from '@craft-agent/shared/workspaces'
import { loadReleaseKitManifest, resolveVerifiedReleaseKitItemPath, resolveVerifiedReleaseKitItemPathWhileLocked, withReleaseKitLockAsync } from '@craft-agent/shared/release-kit'
import {
  isXEditorialSlateOutput,
  parseXEditorialSlate,
  stableXEditorialStringify,
  xStandardPostLengthError,
  type MutateXEditorialCandidateInput,
  type MutateXEditorialCandidateResult,
  type XEditorialCandidate,
  type XEditorialSlate,
} from '@craft-agent/shared/x-editorial'

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
  RPC_CHANNELS.scheduledWork.AUTHORIZE_RELEASE_KIT_SOCIAL,
  RPC_CHANNELS.scheduledWork.REAUTHORIZE_RELEASE_KIT_SOCIAL,
  RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE,
  RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN,
  RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN,
  RPC_CHANNELS.scheduledWork.RESOLVE_CAMPAIGN_OUTPUT,
  RPC_CHANNELS.scheduledWork.SUPPLY_INPUTS,
  RPC_CHANNELS.scheduledWork.APPROVE_CAMPAIGN_SOCIAL,
  RPC_CHANNELS.scheduledWork.MANAGE_GOAL_RUN,
  RPC_CHANNELS.scheduledWork.SCHEDULE_HQ,
  RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN,
] as const

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function broadcastChanged(deps: HandlerDeps, workspaceId: string, rootPath: string): void {
  refreshArtistManagerStateForWorkspaceBestEffort(rootPath)
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, loadAllContextDocs(rootPath))
}

function broadcastOutputChanged(deps: HandlerDeps, workspaceId: string): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.outputs.UPDATED, { to: 'workspace', workspaceId }, workspaceId)
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

function readArtistSocialWorkEntries(currentWorkspaceId: string): ArtistSocialWorkEntry[] {
  const currentWorkspace = getWorkspaceByNameOrId(currentWorkspaceId)
  if (!currentWorkspace) throw new Error(`Workspace not found: ${currentWorkspaceId}`)
  const artistWorkspaces = getWorkspaces()
    .filter((workspace) => workspace.artistWorkspaceScope === 'hq' || workspace.artistWorkspaceScope === 'campaign')
  if (!artistWorkspaces.some((workspace) => workspace.id === currentWorkspace.id)) artistWorkspaces.push(currentWorkspace)

  const entries: ArtistSocialWorkEntry[] = []
  const seen = new Set<string>()
  for (const workspace of artistWorkspaces) {
    const key = `${workspace.id}:${workspace.rootPath}`
    if (seen.has(key)) continue
    seen.add(key)
    const parsed = readScheduledWork(workspace.rootPath, workspace.id)
    if (!parsed.ok) {
      throw new Error(`Cannot verify social schedule conflicts because ${workspace.name} scheduled work is invalid: ${parsed.error}`)
    }
    for (const order of parsed.work.items) {
      entries.push({ workspaceId: workspace.id, workspaceName: workspace.name, order })
    }
  }
  return entries
}

function assertArtistSocialScheduleAvailable(workspaceId: string, order: ScheduledWorkDocument['items'][number]): void {
  if (order.execution.type !== 'social-publish') return
  const workspace = getWorkspaceByNameOrId(workspaceId)
  assertNoArtistSocialScheduleConflict(
    { workspaceId, workspaceName: workspace?.name, order },
    readArtistSocialWorkEntries(workspaceId),
  )
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
      assertTeamPermission(rootPath, 'files.write')
      if (mutation.operation === 'upsert' && (mutation.order.authorization || mutation.order.authorizationPolicy)) {
        throw new Error('Durable social authorization can only be minted by the host authorization command.')
      }
      const persist = () => withWorkspaceContextLock(rootPath, async () => {
        const parsed = readScheduledWork(rootPath, workspaceId)
        if (!parsed.ok) throw new Error(parsed.error)
        if (mutation.operation === 'upsert') {
          const existing = parsed.work.items.find((candidate) => candidate.id === mutation.order.id && !candidate.deletedAt)
          if (mutation.order.inputRequest
            || mutation.order.inputSupplyReceipt
            || existing?.inputRequest
            || existing?.inputSupplyReceipt) {
            throw new Error('Workflow input requests can only be changed by the host input-supply command.')
          }
        }
        const result = applyScheduledWorkMutation(parsed.work, mutation)
        if (!result.ok) return result
        assertArtistSocialScheduleAvailable(workspaceId, result.item)
        writeScheduledWork(rootPath, result.work)
        broadcastChanged(deps, workspaceId, rootPath)
        return result
      })
      return mutation.operation === 'upsert' && mutation.order.execution.type === 'social-publish'
        ? withArtistSocialScheduleLock(persist)
        : persist()
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.MANAGE_GOAL_RUN,
    async (_ctx, workspaceId: string, input: ManageGoalRunInput): Promise<ManageGoalRunResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      const result = await deps.sessionManager.manageGoalRun(workspaceId, rootPath, input)
      broadcastChanged(deps, workspaceId, rootPath)
      return result
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.SUPPLY_INPUTS,
    async (_ctx, workspaceId: string, input: SupplyScheduledWorkInput): Promise<SupplyScheduledWorkInputResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      return supplyScheduledWorkInputs(workspaceId, rootPath, {
        orderId: input.orderId,
        requestId: input.requestId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        values: input.values,
        source: 'list',
      }, {
        log: console,
        emitContextChanged: (changedWorkspaceId) => broadcastChanged(deps, changedWorkspaceId, rootPath),
      })
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN,
    async (_ctx, workspaceId: string, input: CancelCampaignWorkInput): Promise<CancelCampaignWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
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
      assertTeamPermission(rootPath, 'files.write')
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
      assertTeamPermission(rootPath, 'files.write')
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
      assertTeamPermission(rootPath, 'social.publish.approve')
      return withArtistSocialScheduleLock(() => withWorkspaceContextLock(rootPath, async () => {
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
        if (order.authorizationPolicy === 'durable-v1' || order.authorization) {
          throw new Error('This post was authorized when scheduled and cannot receive a separate manual approval.')
        }
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
        assertArtistSocialScheduleAvailable(workspaceId, nextOrder)
        const work = { ...scheduled.work, items: scheduled.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate), updatedAt: now.toISOString() }
        writeScheduledWork(rootPath, work)
        broadcastChanged(deps, workspaceId, rootPath)
        return { work, order: nextOrder, calendar: parsedCalendar.calendar, calendarItem }
      }))
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.AUTHORIZE_RELEASE_KIT_SOCIAL,
    async (ctx, workspaceId: string, input: AuthorizeReleaseKitSocialInput): Promise<AuthorizeReleaseKitSocialResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      assertTeamPermission(rootPath, 'social.publish.approve')
      return withArtistSocialScheduleLock(() => withReleaseKitLockAsync(rootPath, () => withWorkspaceContextLock(rootPath, async () => {
        const normalized = normalizeReleaseKitSocialInput(input)
        const manifest = loadReleaseKitManifest(rootPath, workspaceId, workspaceId)
        const item = manifest.items.find((candidate) => candidate.id === normalized.releaseKitItemId)
        if (!item) throw new Error(`Release Kit item not found: ${normalized.releaseKitItemId}`)
        if (item.status !== 'ready') throw new Error('This final must pass integrity verification before it can be scheduled.')
        const restriction = releaseKitSocialRestriction(item.usage.restrictions)
        if (restriction) throw new Error(restriction)
        resolveVerifiedReleaseKitItemPathWhileLocked(rootPath, workspaceId, workspaceId, item.id, item.sha256)
        const variantService = new SocialVariantSetService({
          getWorkspace: (id) => getWorkspaceByNameOrId(id) ?? undefined,
          emitOutputsUpdated: (id) => broadcastOutputChanged(deps, id),
        })
        const variantBinding = await variantService.assertReleaseKitSocialVariantAllowed(workspaceId, item, normalized)

        const startAt = new Date(normalized.startAt)
        if (startAt.getTime() <= Date.now()) throw new Error('Choose a future publish time.')
        const localStart = formatInTimezone(normalized.startAt, normalized.timezone)
        const requestId = normalized.requestId
        const orderId = `scheduled-work-${requestId}`
        const calendarItemId = `campaign-item-${requestId}`
        const releaseKitRef = { itemId: item.id, sha256: item.sha256, label: item.title }
        const definition: ReleaseKitSocialAuthorizationDefinition = {
          title: normalized.title ?? `Post ${item.title}`,
          releaseKitRef,
          platform: normalized.platform,
          profileId: normalized.profileId,
          accountSetId: normalized.accountSetId,
          caption: normalized.caption,
          platformOptions: normalized.platformOptions,
          startAt: normalized.startAt,
          timezone: normalized.timezone,
        }
        const payloadDigest = `sha256:${createHash('sha256').update(stableScheduledWorkAuthorizationStringify(definition)).digest('hex')}`
        const now = new Date().toISOString()
        const authorization: ScheduledWorkAuthorization = {
          id: `scheduled-work-authorization-${requestId}`,
          authorizedAt: now,
          expiresAt: new Date(startAt.getTime() + 30 * 60 * 1000).toISOString(),
          payloadDigest,
          authorizedBy: { type: 'user', clientId: ctx.clientId, source: normalized.source },
          definition,
        }
        const order: ScheduledWorkDocument['items'][number] = {
          version: 1,
          id: orderId,
          owner: { scope: 'campaign', workspaceId, campaignId: workspaceId },
          calendarLink: { calendar: 'campaign', itemId: calendarItemId },
          title: definition.title,
          type: 'social-publish',
          status: 'needs-approval',
          startAt: definition.startAt,
          timezone: definition.timezone,
          execution: {
            type: 'social-publish', platform: definition.platform, profileId: definition.profileId,
            accountSetId: definition.accountSetId, caption: definition.caption, platformOptions: definition.platformOptions,
          },
          inputRefs: [{ kind: 'release-kit', ...releaseKitRef }],
          approvals: [], runs: [], authorization, authorizationPolicy: 'durable-v1',
          executionKey: { payloadDigest, idempotencyKey: `${orderId}:${payloadDigest}` },
          createdAt: now, updatedAt: now,
        }
        const calendarItem = createCampaignCalendarItem({
          id: calendarItemId, campaignId: workspaceId, date: localStart.date, time: localStart.time,
          timezone: definition.timezone, title: definition.title, kind: 'scheduled-job', status: 'needs-approval',
          releaseKitRefs: [releaseKitRef], accountSetId: definition.accountSetId,
          socialProfileRefs: [{ platform: definition.platform, profileId: definition.profileId }], scheduledWorkId: orderId,
        })
        assertCampaignScheduleInput(workspaceId, { order, calendarItem }, false, true)

        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        const existingOrder = scheduled.work.items.find((candidate) => candidate.id === order.id)
        const existingCalendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === calendarItem.id)
        if (existingOrder || existingCalendarItem) {
          if (!existingOrder || !existingCalendarItem || !sameScheduleIdentity(existingOrder, order)) {
            throw new Error(`Schedule request id already exists with different details: ${requestId}`)
          }
          if (variantBinding) variantService.linkScheduledUse(variantBinding, item.id, existingOrder.id)
          return { updated: false, work: scheduled.work, order: existingOrder, calendar: parsedCalendar.calendar, calendarItem: existingCalendarItem }
        }
        const equivalentOrder = scheduled.work.items.find((candidate) => !candidate.deletedAt
          && candidate.status !== 'canceled'
          && candidate.type === 'social-publish'
          && candidate.executionKey.payloadDigest === payloadDigest)
        if (equivalentOrder) {
          const equivalentCalendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === equivalentOrder.calendarLink?.itemId)
          if (!equivalentCalendarItem) throw new Error(`Existing social schedule is missing its calendar item: ${equivalentOrder.id}`)
          if (variantBinding) variantService.linkScheduledUse(variantBinding, item.id, equivalentOrder.id)
          return { updated: false, work: scheduled.work, order: equivalentOrder, calendar: parsedCalendar.calendar, calendarItem: equivalentCalendarItem }
        }
        assertArtistSocialScheduleAvailable(workspaceId, order)
        await validateScheduleRuntime(deps, rootPath, order)
        const work = { ...scheduled.work, items: [...scheduled.work.items, order], updatedAt: now }
        const calendar = { ...parsedCalendar.calendar, items: [...parsedCalendar.calendar.items, calendarItem], updatedAt: now }
        writeScheduledWork(rootPath, work)
        writeCampaignCalendar(rootPath, calendar)
        if (variantBinding) variantService.linkScheduledUse(variantBinding, item.id, order.id)
        broadcastChanged(deps, workspaceId, rootPath)
        return { updated: true, work, order, calendar, calendarItem }
      })))
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.REAUTHORIZE_RELEASE_KIT_SOCIAL,
    async (ctx, workspaceId: string, input: ReauthorizeReleaseKitSocialInput): Promise<ReauthorizeReleaseKitSocialResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      assertTeamPermission(rootPath, 'social.publish.approve')
      return withArtistSocialScheduleLock(() => withReleaseKitLockAsync(rootPath, () => withWorkspaceContextLock(rootPath, async () => {
        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const parsedCalendar = readCampaignCalendar(rootPath, workspaceId)
        if (!parsedCalendar.ok) throw new Error(parsedCalendar.error)
        const order = scheduled.work.items.find((candidate) => candidate.id === input.orderId && !candidate.deletedAt)
        const calendarItem = parsedCalendar.calendar.items.find((candidate) => candidate.id === input.calendarItemId && !candidate.deletedAt)
        if (!order || !calendarItem || calendarItem.scheduledWorkId !== order.id || order.calendarLink.itemId !== calendarItem.id) {
          throw new Error('Linked campaign work was not found.')
        }
        if (order.updatedAt !== input.expectedUpdatedAt) throw new Error(`Scheduled work order changed before reconfirmation: ${order.id}`)
        if (order.execution.type !== 'social-publish' || order.authorizationPolicy !== 'durable-v1' || !order.authorization) {
          throw new Error('Only a host-authorized social post can be edited here.')
        }
        if (!isReleaseKitSocialAuthorizationDefinition(order.authorization.definition)) {
          throw new Error('X Editorial posts must be edited from their Daily X Slate.')
        }
        if (order.status === 'running' || order.status === 'done' || order.status === 'canceled' || order.runs.length > 0) {
          throw new Error('This post has already started and can no longer be edited.')
        }

        const normalized = normalizeReleaseKitSocialInput({ ...input, requestId: 'reauthorize', source: 'calendar-ui' })
        const manifest = loadReleaseKitManifest(rootPath, workspaceId, workspaceId)
        const item = manifest.items.find((candidate) => candidate.id === normalized.releaseKitItemId)
        if (!item) throw new Error(`Release Kit item not found: ${normalized.releaseKitItemId}`)
        if (item.status !== 'ready') throw new Error('This final must pass integrity verification before it can be scheduled.')
        const restriction = releaseKitSocialRestriction(item.usage.restrictions)
        if (restriction) throw new Error(restriction)
        resolveVerifiedReleaseKitItemPathWhileLocked(rootPath, workspaceId, workspaceId, item.id, item.sha256)
        await new SocialVariantSetService({
          getWorkspace: (id) => getWorkspaceByNameOrId(id) ?? undefined,
        }).assertReleaseKitSocialVariantAllowed(workspaceId, item, normalized)
        if (Date.parse(normalized.startAt) <= Date.now()) throw new Error('Choose a future publish time.')

        const definition: ReleaseKitSocialAuthorizationDefinition = {
          title: normalized.title ?? order.title,
          releaseKitRef: { itemId: item.id, sha256: item.sha256, label: item.title },
          platform: normalized.platform,
          profileId: normalized.profileId,
          accountSetId: normalized.accountSetId,
          caption: normalized.caption,
          platformOptions: normalized.platformOptions,
          startAt: normalized.startAt,
          timezone: normalized.timezone,
        }
        const changes = socialDefinitionChanges(order.authorization.definition, definition)
        if (changes.length === 0) throw new Error('No changes need confirmation.')
        const payloadDigest = `sha256:${createHash('sha256').update(stableScheduledWorkAuthorizationStringify(definition)).digest('hex')}`
        const now = new Date().toISOString()
        const authorization: ScheduledWorkAuthorization = {
          id: `scheduled-work-authorization-${order.id}-${Date.now()}`,
          authorizedAt: now,
          expiresAt: new Date(Date.parse(definition.startAt) + 30 * 60 * 1000).toISOString(),
          payloadDigest,
          authorizedBy: { type: 'user', clientId: ctx.clientId, source: 'calendar-ui' },
          definition,
        }
        const nextOrder: ScheduledWorkDocument['items'][number] = {
          ...order,
          title: definition.title,
          status: 'needs-approval',
          startAt: definition.startAt,
          timezone: definition.timezone,
          execution: {
            type: 'social-publish', platform: definition.platform, profileId: definition.profileId,
            accountSetId: definition.accountSetId, caption: definition.caption, platformOptions: definition.platformOptions,
          },
          inputRefs: [{ kind: 'release-kit', ...definition.releaseKitRef }],
          authorization,
          socialAction: undefined,
          socialApproval: undefined,
          attention: undefined,
          executionKey: { payloadDigest, idempotencyKey: `${order.id}:${payloadDigest}` },
          updatedAt: now,
        }
        assertArtistSocialScheduleAvailable(workspaceId, nextOrder)
        await validateScheduleRuntime(deps, rootPath, nextOrder)
        const localStart = formatInTimezone(nextOrder.startAt, nextOrder.timezone)
        const nextCalendarItem: CampaignCalendarItem = {
          ...calendarItem,
          title: nextOrder.title,
          date: localStart.date,
          time: localStart.time,
          timezone: nextOrder.timezone,
          status: 'needs-approval',
          releaseKitRefs: [definition.releaseKitRef],
          finalRefs: [], outputRefs: [], assetRefs: [],
          accountSetId: definition.accountSetId,
          socialProfileRefs: [{ platform: definition.platform, profileId: definition.profileId }],
          updatedAt: now,
        }
        assertCampaignShellMatchesOrder(nextOrder, nextCalendarItem)
        const work = { ...scheduled.work, items: scheduled.work.items.map((candidate) => candidate.id === nextOrder.id ? nextOrder : candidate), updatedAt: now }
        const calendar = { ...parsedCalendar.calendar, items: parsedCalendar.calendar.items.map((candidate) => candidate.id === nextCalendarItem.id ? nextCalendarItem : candidate), updatedAt: now }
        writeScheduledWork(rootPath, work)
        writeCampaignCalendar(rootPath, calendar)
        broadcastChanged(deps, workspaceId, rootPath)
        return { updated: true, changes, work, order: nextOrder, calendar, calendarItem: nextCalendarItem }
      })))
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN,
    async (_ctx, workspaceId: string, input: ScheduleCampaignWorkInput): Promise<ScheduleCampaignWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      const persist = () => withWorkspaceContextLock(rootPath, async () => {
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
        assertArtistSocialScheduleAvailable(workspaceId, order)

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
      const persistWithAssetLock = () => input.order.inputRefs.some((ref) => ref.kind === 'release-kit')
        ? withReleaseKitLockAsync(rootPath, persist)
        : persist()
      return input.order.execution.type === 'social-publish'
        ? withArtistSocialScheduleLock(persistWithAssetLock)
        : persistWithAssetLock()
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN,
    async (_ctx, workspaceId: string, input: ScheduleCampaignChainInput): Promise<ScheduleCampaignChainResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      const persist = () => withWorkspaceContextLock(rootPath, async () => {
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
        for (const order of resolvedOrders) assertArtistSocialScheduleAvailable(workspaceId, order)

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
      const persistWithAssetLock = () => input.orders.some((order) => order.inputRefs.some((ref) => ref.kind === 'release-kit'))
        ? withReleaseKitLockAsync(rootPath, persist)
        : persist()
      return input.orders.some((order) => order.execution.type === 'social-publish')
        ? withArtistSocialScheduleLock(persistWithAssetLock)
        : persistWithAssetLock()
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE,
    async (ctx, workspaceId: string, input: MutateXEditorialCandidateInput): Promise<MutateXEditorialCandidateResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
      if (input.action === 'approve') assertTeamPermission(rootPath, 'social.publish.approve')

      const mutate = () => withWorkspaceContextLock(rootPath, async () => {
        const loaded = loadXEditorialSlateOutput(rootPath, workspaceId, input.outputId)
        const candidate = loaded.slate.candidates.find((entry) => entry.id === input.candidateId)
        if (!candidate) throw new Error(`Daily X Slate candidate was not found: ${input.candidateId}`)

        if (loaded.manifest.updatedAt !== input.expectedOutputUpdatedAt) {
          const idempotent = (input.action === 'approve'
            && candidate.revision === input.expectedRevision
            && Boolean(candidate.scheduledWorkId && candidate.calendarItemId))
            || (input.action === 'skip'
              && candidate.revision === input.expectedRevision
              && candidate.status === 'skipped')
          if (idempotent) {
            return {
              slate: loaded.slate,
              outputUpdatedAt: loaded.manifest.updatedAt,
              scheduledWorkId: candidate.scheduledWorkId,
              calendarItemId: candidate.calendarItemId,
            }
          }
          throw new Error('Daily X Slate changed before this decision. Reload it and try again.')
        }
        if (candidate.revision !== input.expectedRevision) {
          throw new Error('This post changed before your decision. Review the latest revision.')
        }
        if (candidate.status === 'posted') throw new Error('A published post can no longer be changed from the slate.')

        if (input.action === 'edit' || input.action === 'skip') {
          const canceled = cancelXEditorialCandidateSchedule(rootPath, workspaceId, candidate)
          const nextCandidate = input.action === 'skip'
            ? {
                ...candidate,
                status: 'skipped' as const,
                scheduledWorkId: undefined,
                calendarItemId: undefined,
                receipt: undefined,
                attentionMessage: undefined,
              }
            : editXEditorialCandidate(candidate, input.text, input.scheduledFor)
          const nextSlate = replaceXEditorialCandidate(loaded.slate, nextCandidate)
          const persisted = persistXEditorialSlateOutput(rootPath, loaded, nextSlate)
          if (canceled) broadcastChanged(deps, workspaceId, rootPath)
          broadcastOutputChanged(deps, workspaceId)
          return { slate: nextSlate, outputUpdatedAt: persisted.updatedAt }
        }

        assertXEditorialCandidateApprovable(loaded.slate, candidate)
        const verifiedAsset = candidate.asset ? verifyXEditorialReleaseKitAsset(candidate.asset) : undefined

        const idSeed = stableXEditorialStringify({
          workspaceId,
          outputId: loaded.manifest.id,
          slateId: loaded.slate.slateId,
          candidateId: candidate.id,
          revision: candidate.revision,
        })
        const idSuffix = createHash('sha256').update(idSeed).digest('hex').slice(0, 24)
        const orderId = `scheduled-work-x-${idSuffix}`
        const calendarItemId = `artist-calendar-x-${idSuffix}`
        const now = new Date().toISOString()
        const definition: XEditorialSocialAuthorizationDefinition = {
          kind: 'x-editorial',
          title: xEditorialOrderTitle(candidate),
          xEditorialRef: {
            outputId: loaded.manifest.id,
            slateId: loaded.slate.slateId,
            candidateId: candidate.id,
            revision: candidate.revision,
          },
          releaseKitRef: verifiedAsset
            ? {
                itemId: verifiedAsset.item.id,
                sha256: verifiedAsset.item.sha256,
                label: verifiedAsset.item.title,
                campaignId: verifiedAsset.workspace.id,
              }
            : undefined,
          platform: 'x',
          profileId: loaded.slate.profile.profileId,
          caption: candidate.text,
          startAt: candidate.scheduledFor!,
          timezone: loaded.slate.timezone,
        }
        const payloadDigest = `sha256:${createHash('sha256').update(stableScheduledWorkAuthorizationStringify(definition)).digest('hex')}`
        const authorization: ScheduledWorkAuthorization = {
          id: `scheduled-work-authorization-${idSuffix}`,
          authorizedAt: now,
          expiresAt: new Date(Date.parse(definition.startAt) + 30 * 60 * 1000).toISOString(),
          payloadDigest,
          authorizedBy: { type: 'user', clientId: ctx.clientId, source: 'x-editorial-ui' },
          definition,
        }
        const order: ScheduledWorkDocument['items'][number] = {
          version: 1,
          id: orderId,
          owner: { scope: 'hq', workspaceId },
          calendarLink: { calendar: 'hq', itemId: calendarItemId },
          title: definition.title,
          intentId: `x-editorial:${loaded.slate.slateId}:${candidate.id}:${candidate.revision}`,
          type: 'social-publish',
          status: 'needs-approval',
          startAt: definition.startAt,
          timezone: definition.timezone,
          execution: {
            type: 'social-publish',
            platform: 'x',
            profileId: definition.profileId,
            caption: definition.caption,
          },
          inputRefs: verifiedAsset
            ? [{ kind: 'release-kit', itemId: verifiedAsset.item.id, sha256: verifiedAsset.item.sha256, label: verifiedAsset.item.title }]
            : [],
          approvals: [],
          runs: [],
          authorization,
          authorizationPolicy: 'durable-v1',
          executionKey: { payloadDigest, idempotencyKey: `${orderId}:${payloadDigest}` },
          createdAt: now,
          updatedAt: now,
        }
        assertArtistSocialScheduleAvailable(workspaceId, order)
        await validateScheduleRuntime(deps, rootPath, order)

        const scheduled = readScheduledWork(rootPath, workspaceId)
        if (!scheduled.ok) throw new Error(scheduled.error)
        const artistCalendar = readArtistCalendar(rootPath)
        const existingOrder = scheduled.work.items.find((entry) => entry.id === order.id && !entry.deletedAt)
        if (existingOrder && !sameXEditorialSchedule(existingOrder, order)) {
          throw new Error('This Daily X Slate approval conflicts with an existing scheduled post.')
        }
        const existingEvent = artistCalendar.events.find((event) => event.id === calendarItemId && !event.deletedAt)
        if (existingEvent && existingEvent.scheduledWorkId !== orderId) {
          throw new Error('This Daily X Slate approval conflicts with an existing Calendar event.')
        }
        const resolvedOrder = existingOrder ?? order
        const resolvedEvent = existingEvent ?? xEditorialCalendarEvent(resolvedOrder, candidate, now)
        const work = existingOrder ? scheduled.work : {
          ...scheduled.work,
          items: [...scheduled.work.items, order],
          updatedAt: now,
        }
        const calendar = existingEvent ? artistCalendar : {
          ...artistCalendar,
          events: [...artistCalendar.events, resolvedEvent],
          updatedAt: now,
        }
        if (!existingOrder) writeScheduledWork(rootPath, work)
        if (!existingEvent) writeArtistCalendar(rootPath, calendar)

        const nextCandidate: XEditorialCandidate = {
          ...candidate,
          status: resolvedOrder.status === 'done'
            ? 'posted'
            : resolvedOrder.status === 'needs-attention'
              ? 'needs-attention'
              : 'scheduled',
          scheduledWorkId: resolvedOrder.id,
          calendarItemId: resolvedEvent.id,
          receipt: resolvedOrder.status === 'done' && resolvedOrder.result?.type === 'social-publish'
            ? {
                id: resolvedOrder.result.receipt.id,
                externalUrl: resolvedOrder.result.receipt.externalUrl,
                summary: resolvedOrder.result.receipt.summary ?? 'Published to X.',
                completedAt: resolvedOrder.result.receipt.completedAt,
              }
            : undefined,
          attentionMessage: resolvedOrder.status === 'needs-attention'
            ? resolvedOrder.attention?.message ?? 'This scheduled post needs attention.'
            : undefined,
        }
        const nextSlate = replaceXEditorialCandidate(loaded.slate, nextCandidate)
        const persisted = persistXEditorialSlateOutput(rootPath, loaded, nextSlate)
        broadcastChanged(deps, workspaceId, rootPath)
        broadcastOutputChanged(deps, workspaceId)
        return {
          slate: nextSlate,
          outputUpdatedAt: persisted.updatedAt,
          scheduledWorkId: resolvedOrder.id,
          calendarItemId: resolvedEvent.id,
        }
      })
      return input.action === 'approve' ? withArtistSocialScheduleLock(mutate) : mutate()
    },
  )

  server.handle(
    RPC_CHANNELS.scheduledWork.SCHEDULE_HQ,
    async (_ctx, workspaceId: string, input: ScheduleHqWorkInput): Promise<ScheduleHqWorkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      assertTeamPermission(rootPath, 'files.write')
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
      assertTeamPermission(rootPath, 'files.write')
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

function assertCampaignScheduleInput(workspaceId: string, input: ScheduleCampaignWorkInput, allowWaiting = false, allowHostAuthorization = false): void {
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
  if (order.execution.type === 'social-publish'
    && (order.inputRefs.length !== 1 || order.inputRefs[0]?.kind !== 'release-kit')) {
    throw new Error('Campaign social work requires one exact Release Kit item.')
  }
  if (order.execution.type === 'social-publish' && !allowHostAuthorization) {
    throw new Error('Campaign social work must use the host-authorized Release Kit scheduling command.')
  }
  if (allowHostAuthorization && (order.authorizationPolicy !== 'durable-v1' || !order.authorization)) {
    throw new Error('Campaign social authorization is missing.')
  }
  assertCampaignShellMatchesOrder(order, calendarItem)
}

function normalizeReleaseKitSocialInput(input: AuthorizeReleaseKitSocialInput): Required<Omit<AuthorizeReleaseKitSocialInput, 'title' | 'accountSetId' | 'platformOptions'>> & Pick<AuthorizeReleaseKitSocialInput, 'title' | 'accountSetId' | 'platformOptions'> {
  const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const requestId = clean(input.requestId)
  const releaseKitItemId = clean(input.releaseKitItemId)
  const platform = clean(input.platform).toLowerCase()
  const profileId = clean(input.profileId)
  const caption = clean(input.caption)
  const title = clean(input.title) || undefined
  const accountSetId = clean(input.accountSetId) || undefined
  const startAt = clean(input.startAt)
  const timezone = clean(input.timezone)
  const source = input.source === 'calendar-ui' ? 'calendar-ui' as const : 'release-kit-ui' as const
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('Schedule request id is invalid.')
  if (!releaseKitItemId || !platform || !profileId || !caption || !startAt || !timezone) throw new Error('Complete the account, caption, date, time, and timezone before scheduling.')
  if (caption.length > 5_000 || (title?.length ?? 0) > 200) throw new Error('Scheduled post text is too long.')
  if (Number.isNaN(Date.parse(startAt))) throw new Error('Choose a valid publish time.')
  const platformOptions = input.platformOptions
  if (platformOptions !== undefined && (!platformOptions || typeof platformOptions !== 'object' || Array.isArray(platformOptions))) throw new Error('Social platform options are invalid.')
  if (platformOptions && JSON.stringify(platformOptions).length > 10_000) throw new Error('Social platform options are too large.')
  return { requestId, releaseKitItemId, title, platform, profileId, accountSetId, caption, platformOptions, startAt, timezone, source }
}

function releaseKitSocialRestriction(restrictions: { blockedFromUse: boolean; needsRightsClearance: boolean; artistLikenessRestricted: boolean }): string | undefined {
  if (restrictions.blockedFromUse) return 'This final is blocked from use. Clear the restriction before scheduling it.'
  if (restrictions.needsRightsClearance) return 'This final needs rights clearance before it can be scheduled.'
  if (restrictions.artistLikenessRestricted) return 'This final has an artist-likeness restriction and cannot be scheduled to social.'
  return undefined
}

function socialDefinitionChanges(
  before: ReleaseKitSocialAuthorizationDefinition,
  after: ReleaseKitSocialAuthorizationDefinition,
): ScheduledSocialDefinitionChange[] {
  const changes: ScheduledSocialDefinitionChange[] = []
  const add = (field: ScheduledSocialDefinitionChange['field'], previous: unknown, next: unknown) => {
    const beforeValue = typeof previous === 'string' ? previous : stableScheduledWorkAuthorizationStringify(previous ?? null)
    const afterValue = typeof next === 'string' ? next : stableScheduledWorkAuthorizationStringify(next ?? null)
    if (beforeValue !== afterValue) changes.push({ field, before: beforeValue, after: afterValue })
  }
  add('title', before.title, after.title)
  add('asset', before.releaseKitRef, after.releaseKitRef)
  add('account', { platform: before.platform, profileId: before.profileId, accountSetId: before.accountSetId }, { platform: after.platform, profileId: after.profileId, accountSetId: after.accountSetId })
  add('caption', before.caption, after.caption)
  add('options', before.platformOptions, after.platformOptions)
  add('time', before.startAt, after.startAt)
  add('timezone', before.timezone, after.timezone)
  return changes
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
      && (root.inputRefs[0]?.kind === 'release-kit' || root.inputRefs[0]?.kind === 'final' || root.inputRefs[0]?.kind === 'output')
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
  const releaseKitRefs = order.inputRefs
    .filter((ref) => ref.kind === 'release-kit')
    .map((ref) => ({ itemId: ref.itemId, sha256: ref.sha256, label: ref.label }))
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
    || !sameJson(calendarItem.releaseKitRefs, releaseKitRefs)
    || !sameJson(calendarItem.outputRefs, outputRefs)
    || !sameJson(calendarItem.assetRefs, assetRefs)
    || !sameJson(actualSocialProfiles, expectedSocialProfiles)) {
    throw new Error('Campaign Calendar shell does not match the scheduled work order.')
  }
}

interface LoadedXEditorialSlateOutput {
  manifest: OutputManifest
  slate: XEditorialSlate
  asset: OutputAsset
  assetPath: string
  originalContent: string
}

function loadXEditorialSlateOutput(
  rootPath: string,
  workspaceId: string,
  outputId: string,
): LoadedXEditorialSlateOutput {
  const manifest = readOutputManifest(rootPath, outputId)
  if (!manifest || manifest.workspaceId !== workspaceId || !isXEditorialSlateOutput(manifest)) {
    throw new Error('Daily X Slate Output was not found in this workspace.')
  }
  const asset = manifest.primary
    ?? (manifest.preview?.assetId ? manifest.assets.find((candidate) => candidate.id === manifest.preview?.assetId) : undefined)
  if (!asset || asset.mimeType !== 'application/json') {
    throw new Error('Daily X Slate must have one JSON primary asset.')
  }
  const assetPath = resolveOutputAssetPath(rootPath, manifest.id, asset.path)
  if (!assetPath) throw new Error('Daily X Slate asset path is invalid.')
  const originalContent = readFileSync(assetPath, 'utf-8')
  const parsed = parseXEditorialSlate(originalContent)
  if (!parsed.ok) throw new Error(`Daily X Slate needs repair: ${parsed.error}`)
  return { manifest, slate: parsed.slate, asset, assetPath, originalContent }
}

function replaceXEditorialCandidate(
  slate: XEditorialSlate,
  replacement: XEditorialCandidate,
): XEditorialSlate {
  const next = {
    ...slate,
    candidates: slate.candidates.map((candidate) => candidate.id === replacement.id ? replacement : candidate),
  }
  const parsed = parseXEditorialSlate(next)
  if (!parsed.ok) throw new Error(`Daily X Slate update is invalid: ${parsed.error}`)
  return parsed.slate
}

function editXEditorialCandidate(
  candidate: XEditorialCandidate,
  text: string,
  scheduledFor: string | null,
): XEditorialCandidate {
  const normalizedText = text.trim()
  if (!normalizedText) throw new Error('Post text cannot be empty.')
  if (normalizedText.length > 5_000) throw new Error('Post text is too long.')
  if (scheduledFor !== null && !Number.isFinite(Date.parse(scheduledFor))) {
    throw new Error('Suggested publish time is invalid.')
  }
  return {
    ...candidate,
    revision: candidate.revision + 1,
    text: normalizedText,
    thread: candidate.format === 'post'
      ? null
      : candidate.thread
        ? [normalizedText, ...candidate.thread.slice(1)]
        : null,
    scheduledFor,
    status: 'proposed',
    scheduledWorkId: undefined,
    calendarItemId: undefined,
    receipt: undefined,
    attentionMessage: undefined,
  }
}

function assertXEditorialCandidateApprovable(
  slate: XEditorialSlate,
  candidate: XEditorialCandidate,
): void {
  if (candidate.status !== 'proposed') throw new Error('Only a proposed post can be approved.')
  if (candidate.format !== 'post') {
    throw new Error('Native X threads remain draft-only until ordered reply-chain safety is available.')
  }
  if (!slate.profile.profileId.trim()) throw new Error('Connect an X account before approving this post.')
  if (!candidate.scheduledFor || !Number.isFinite(Date.parse(candidate.scheduledFor))) {
    throw new Error('Choose a publish time before approving this post.')
  }
  if (Date.parse(candidate.scheduledFor) <= Date.now()) {
    throw new Error('Choose a future publish time before approving this post.')
  }
  if (!candidate.text.trim()) throw new Error('Post text cannot be empty.')
  const lengthError = xStandardPostLengthError(candidate.text)
  if (lengthError) throw new Error(`${lengthError} before approving this standard X post.`)
}

function verifyXEditorialReleaseKitAsset(asset: NonNullable<XEditorialCandidate['asset']>) {
  const workspace = getWorkspaceByNameOrId(asset.campaignId)
  if (!workspace || workspace.artistWorkspaceScope !== 'campaign') {
    throw new Error('The Campaign owning this X post asset no longer exists.')
  }
  const manifest = loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id)
  const item = manifest.items.find((candidate) => candidate.id === asset.itemId)
  if (!item) throw new Error(`Release Kit item not found: ${asset.itemId}`)
  if (item.sha256 !== asset.sha256) {
    throw new Error('This X post asset changed after the slate was drafted. Refresh it from the Campaign Release Kit.')
  }
  if (item.status !== 'ready') {
    throw new Error('This X post asset must pass Release Kit integrity review before approval.')
  }
  const restriction = releaseKitSocialRestriction(item.usage.restrictions)
  if (restriction) throw new Error(restriction)
  resolveVerifiedReleaseKitItemPath(workspace.rootPath, workspace.id, workspace.id, item.id, item.sha256)
  return { workspace, item }
}

function xEditorialOrderTitle(candidate: XEditorialCandidate): string {
  const prefix = candidate.lane === 'direct-release'
    ? 'X release post'
    : candidate.lane === 'campaign-adjacent'
      ? 'X campaign post'
      : 'X worldview post'
  const excerpt = candidate.text.replace(/\s+/g, ' ').trim().slice(0, 72)
  return excerpt ? `${prefix}: ${excerpt}` : prefix
}

function xEditorialCalendarEvent(
  order: ScheduledWorkDocument['items'][number],
  candidate: XEditorialCandidate,
  now: string,
): ArtistCalendarEvent {
  const local = formatInTimezone(order.startAt, order.timezone)
  return {
    id: order.calendarLink.itemId,
    date: local.date,
    time: local.time,
    title: order.title,
    notes: 'Approved from Daily X Slate.',
    scheduledWorkId: order.id,
    workspaceLinks: candidate.campaignId
      ? [{ workspaceId: candidate.campaignId, role: 'campaign-context', linkedAt: now }]
      : [],
    relatedPersonIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

function sameXEditorialSchedule(
  left: ScheduledWorkDocument['items'][number],
  right: ScheduledWorkDocument['items'][number],
): boolean {
  return sameJson({
    id: left.id,
    owner: left.owner,
    calendarLink: left.calendarLink,
    title: left.title,
    intentId: left.intentId,
    type: left.type,
    startAt: left.startAt,
    timezone: left.timezone,
    execution: left.execution,
    inputRefs: left.inputRefs,
    authorization: left.authorization,
    authorizationPolicy: left.authorizationPolicy,
    executionKey: left.executionKey,
  }, {
    id: right.id,
    owner: right.owner,
    calendarLink: right.calendarLink,
    title: right.title,
    intentId: right.intentId,
    type: right.type,
    startAt: right.startAt,
    timezone: right.timezone,
    execution: right.execution,
    inputRefs: right.inputRefs,
    authorization: right.authorization,
    authorizationPolicy: right.authorizationPolicy,
    executionKey: right.executionKey,
  })
}

function cancelXEditorialCandidateSchedule(
  rootPath: string,
  workspaceId: string,
  candidate: XEditorialCandidate,
): boolean {
  if (!candidate.scheduledWorkId && !candidate.calendarItemId) return false
  if (!candidate.scheduledWorkId || !candidate.calendarItemId) {
    throw new Error('Daily X Slate schedule linkage is incomplete.')
  }
  const scheduled = readScheduledWork(rootPath, workspaceId)
  if (!scheduled.ok) throw new Error(scheduled.error)
  const calendar = readArtistCalendar(rootPath)
  const order = scheduled.work.items.find((item) => item.id === candidate.scheduledWorkId && !item.deletedAt)
  const event = calendar.events.find((item) => item.id === candidate.calendarItemId)
  if (!order || !event || event.scheduledWorkId !== order.id || order.calendarLink.itemId !== event.id) {
    throw new Error('Linked X schedule could not be verified.')
  }
  if (order.status === 'running' || order.status === 'done') {
    throw new Error(order.status === 'done'
      ? 'A published post can no longer be changed from the slate.'
      : 'This post is publishing now and can no longer be changed safely.')
  }
  const alreadyCanceled = order.status === 'canceled' && Boolean(event.deletedAt)
  if (alreadyCanceled) return false
  const now = new Date().toISOString()
  const nextOrder = {
    ...order,
    status: 'canceled' as const,
    socialApproval: undefined,
    attention: undefined,
    updatedAt: now,
  }
  const nextEvent = { ...event, deletedAt: event.deletedAt ?? now, updatedAt: now }
  writeScheduledWork(rootPath, {
    ...scheduled.work,
    items: scheduled.work.items.map((item) => item.id === nextOrder.id ? nextOrder : item),
    updatedAt: now,
  })
  writeArtistCalendar(rootPath, {
    ...calendar,
    events: calendar.events.map((item) => item.id === nextEvent.id ? nextEvent : item),
    updatedAt: now,
  })
  return true
}

function persistXEditorialSlateOutput(
  rootPath: string,
  loaded: LoadedXEditorialSlateOutput,
  slate: XEditorialSlate,
): OutputManifest {
  const parsed = parseXEditorialSlate(slate)
  if (!parsed.ok) throw new Error(`Daily X Slate update is invalid: ${parsed.error}`)
  const content = `${JSON.stringify(parsed.slate, null, 2)}\n`
  const now = monotonicIsoAfter(loaded.manifest.updatedAt)
  const updatedAsset: OutputAsset = {
    ...loaded.asset,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  }
  const proposedCount = parsed.slate.candidates.filter((candidate) => candidate.status === 'proposed').length
  const decisionCount = parsed.slate.candidates.filter((candidate) => candidate.status !== 'proposed' && candidate.status !== 'skipped').length
  const nextManifest: OutputManifest = {
    ...loaded.manifest,
    updatedAt: now,
    primary: loaded.manifest.primary?.id === updatedAsset.id ? updatedAsset : loaded.manifest.primary,
    assets: loaded.manifest.assets.map((asset) => asset.id === updatedAsset.id ? updatedAsset : asset),
    approval: proposedCount > 0
      ? { state: 'pending', note: `${proposedCount} X post${proposedCount === 1 ? '' : 's'} still need review.`, updatedAt: now }
      : decisionCount > 0
        ? { state: 'approved', note: 'Every current X candidate has been decided.', updatedAt: now }
        : { state: 'none', note: 'Every current X candidate was skipped.', updatedAt: now },
  }

  writeTextAtomically(loaded.assetPath, content)
  try {
    writeOutputManifest(rootPath, nextManifest)
  } catch (error) {
    writeTextAtomically(loaded.assetPath, loaded.originalContent)
    throw error
  }
  return nextManifest
}

function monotonicIsoAfter(previous: string): string {
  const previousMs = Date.parse(previous)
  return new Date(Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : 0)).toISOString()
}

function writeTextAtomically(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, content, 'utf-8')
    renameSync(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error
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


function readArtistCalendar(rootPath: string): ArtistCalendar {
  const doc = loadContextDoc(rootPath, ARTIST_CALENDAR_CONTEXT_SLUG)
  const parsed = parseArtistCalendarDocResult(doc ?? undefined)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.calendar
}

function writeArtistCalendar(rootPath: string, calendar: ArtistCalendar): void {
  upsertContextDoc(rootPath, {
    slug: ARTIST_CALENDAR_CONTEXT_SLUG,
    metadata: artistCalendarMetadata(),
    body: serializeArtistCalendarBody(calendar),
  })
}

function hqEventFromOrder(order: ScheduledWorkDocument['items'][number]): ArtistCalendarEvent {
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
    if (ref.kind === 'release-kit') {
      const definition = order.authorization?.definition
      if (definition?.kind === 'x-editorial' && definition.releaseKitRef) {
        const campaign = getWorkspaceByNameOrId(definition.releaseKitRef.campaignId)
        if (!campaign || campaign.artistWorkspaceScope !== 'campaign') {
          throw new Error(`Campaign workspace not found for approved X media: ${definition.releaseKitRef.campaignId}`)
        }
        resolveVerifiedReleaseKitItemPath(campaign.rootPath, campaign.id, campaign.id, ref.itemId, ref.sha256)
      } else {
        resolveVerifiedReleaseKitItemPathWhileLocked(rootPath, order.owner.workspaceId, order.owner.workspaceId, ref.itemId, ref.sha256)
      }
    }
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
