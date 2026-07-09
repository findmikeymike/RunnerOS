import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendar,
} from '@craft-agent/shared/campaign-calendar'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  applyScheduledWorkMutation,
  migrateCampaignCalendarJobs,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkDocument,
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
import { withWorkspaceContextMutex } from './workspace-context'

export interface ScheduledWorkMigrationResult {
  updated: boolean
  migrated: number
  work: ScheduledWorkDocument
  calendar: CampaignCalendar
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.scheduledWork.GET,
  RPC_CHANNELS.scheduledWork.MUTATE,
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
      return withWorkspaceContextMutex(rootPath, async () => {
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
    RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN,
    async (_ctx, workspaceId: string): Promise<ScheduledWorkMigrationResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceContextMutex(rootPath, async () => {
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
