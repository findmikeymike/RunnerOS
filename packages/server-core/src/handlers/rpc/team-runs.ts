import { randomUUID } from 'node:crypto'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  appendTeamRunEvent,
  createTeamTask,
  deleteTeamRun,
  listTeamRuns,
  loadGlobalTeam,
  readTeamRun,
  readTeamRunDetail,
  sendTeamMessage,
  touchTeamRun,
  updateTeamTask,
  writeTeamRun,
  type CreateTeamTaskInput,
  type SendTeamMessageInput,
  type StartTeamRunInput,
  type TeamRunDetail,
  type TeamRunSnapshot,
  type UpdateTeamTaskInput,
} from '@craft-agent/shared/teams'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.teamRuns.START,
  RPC_CHANNELS.teamRuns.GET,
  RPC_CHANNELS.teamRuns.LIST,
  RPC_CHANNELS.teamRuns.DELETE,
  RPC_CHANNELS.teamRuns.CREATE_TASK,
  RPC_CHANNELS.teamRuns.UPDATE_TASK,
  RPC_CHANNELS.teamRuns.SEND_MESSAGE,
] as const

function resolveRootPath(deps: HandlerDeps, workspaceId: string): string {
  const workspace = deps.sessionManager.getWorkspaces().find((candidate) => (
    candidate.id === workspaceId || candidate.name === workspaceId
  ))
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function broadcastUpdated(
  deps: HandlerDeps,
  workspaceId: string,
  detail: TeamRunDetail,
  eventType: 'created' | 'updated' | 'completed',
): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.teamRuns.UPDATED, { to: 'workspace', workspaceId }, workspaceId, detail, eventType)
}

function buildLeadPrompt(teamSlug: string, input: StartTeamRunInput, run: TeamRunSnapshot): string {
  const team = run.teamSnapshot.metadata
  const roster = team.members.map((member) => `- ${member.slug}: ${member.role}`).join('\n')
  const verification = team.verification
    ? `Verification default: ${team.verification.default}. Required for: ${(team.verification.requiredFor ?? []).join(', ') || 'none'}.`
    : 'Verification default: off.'

  return [
    `You are the lead agent for @${teamSlug}.`,
    '',
    `Team run id: ${run.id}`,
    `Lead: ${team.lead}`,
    `Permission mode: ${run.permissionMode ?? 'workspace default'}`,
    verification,
    '',
    'Roster:',
    roster || '- No members configured',
    '',
    'Operating rules:',
    '- Split the user request into owned team tasks before doing broad work.',
    '- Use team run/task/message state as the durable record.',
    '- Risky external actions require user approval before execution.',
    '- Return one coherent lead-facing answer to the user.',
    '',
    'User request:',
    input.userRequest.trim(),
  ].join('\n')
}

export function registerTeamRunsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.teamRuns.START,
    async (_ctx, workspaceId: string, input: StartTeamRunInput): Promise<TeamRunDetail> => {
      const team = loadGlobalTeam(input.teamSlug)
      if (!team) throw new Error(`Team not found: ${input.teamSlug}`)
      if (!input.userRequest.trim()) throw new Error('Team run request is required.')

      const rootPath = resolveRootPath(deps, workspaceId)
      const now = new Date().toISOString()
      const run: TeamRunSnapshot = {
        id: randomUUID(),
        workspaceId,
        teamSlug: team.slug,
        state: 'created',
        userRequest: input.userRequest.trim(),
        teamSnapshot: {
          metadata: team.metadata,
          body: team.body,
        },
        permissionMode: team.metadata.permissionMode,
        createdAt: now,
        updatedAt: now,
      }

      writeTeamRun(rootPath, run)
      appendTeamRunEvent(rootPath, run.id, { kind: 'run.created', actorAgentSlug: 'user', body: input.userRequest.trim() })

      let next = run
      const leadOptions = await deps.sessionManager.resolveAgentSessionOptions(workspaceId, team.metadata.lead, { referenceMode: 'lenient' })
      const leadSession = await deps.sessionManager.createSession(workspaceId, {
        ...leadOptions,
        name: team.metadata.name,
        permissionMode: team.metadata.permissionMode ?? leadOptions.permissionMode,
        spawnedFromAgent: {
          agentSlug: team.metadata.lead,
          agentName: team.metadata.lead,
          timestamp: Date.now(),
        },
        customSystemPrompt: [
          leadOptions.customSystemPrompt,
          `You are leading RunnerOS team "${team.metadata.name}" (${team.slug}). Coordinate members through team tasks and messages.`,
        ].filter(Boolean).join('\n\n'),
      })

      next = touchTeamRun(rootPath, { ...run, leadSessionId: leadSession.id, state: 'running' })
      appendTeamRunEvent(rootPath, run.id, { kind: 'session.linked', actorAgentSlug: team.metadata.lead, body: leadSession.id })

      await deps.sessionManager.sendMessage(leadSession.id, buildLeadPrompt(team.slug, input, next))

      const detail = readTeamRunDetail(rootPath, run.id)
      if (!detail) throw new Error(`Failed to read team run after start: ${run.id}`)
      broadcastUpdated(deps, workspaceId, detail, 'created')
      return detail
    },
  )

  server.handle(
    RPC_CHANNELS.teamRuns.GET,
    async (_ctx, workspaceId: string, runId: string): Promise<TeamRunDetail | null> => {
      return readTeamRunDetail(resolveRootPath(deps, workspaceId), runId)
    },
  )

  server.handle(
    RPC_CHANNELS.teamRuns.LIST,
    async (_ctx, workspaceId: string): Promise<TeamRunSnapshot[]> => {
      return listTeamRuns(resolveRootPath(deps, workspaceId))
    },
  )

  server.handle(
    RPC_CHANNELS.teamRuns.DELETE,
    async (_ctx, workspaceId: string, runId: string): Promise<boolean> => {
      const rootPath = resolveRootPath(deps, workspaceId)
      const existing = readTeamRun(rootPath, runId)
      if (existing && existing.state === 'running') {
        throw new Error(`Cannot delete team run "${runId}" while it is running.`)
      }
      return deleteTeamRun(rootPath, runId)
    },
  )

  server.handle(
    RPC_CHANNELS.teamRuns.CREATE_TASK,
    async (_ctx, workspaceId: string, runId: string, input: CreateTeamTaskInput): Promise<TeamRunDetail> => {
      const rootPath = resolveRootPath(deps, workspaceId)
      createTeamTask(rootPath, runId, input)
      const detail = readTeamRunDetail(rootPath, runId)
      if (!detail) throw new Error(`Team run not found: ${runId}`)
      broadcastUpdated(deps, workspaceId, detail, 'updated')
      return detail
    },
  )

  server.handle(
    RPC_CHANNELS.teamRuns.UPDATE_TASK,
    async (_ctx, workspaceId: string, runId: string, taskId: string, patch: UpdateTeamTaskInput): Promise<TeamRunDetail> => {
      const rootPath = resolveRootPath(deps, workspaceId)
      updateTeamTask(rootPath, runId, taskId, patch)
      const detail = readTeamRunDetail(rootPath, runId)
      if (!detail) throw new Error(`Team run not found: ${runId}`)
      broadcastUpdated(deps, workspaceId, detail, detail.state === 'done' ? 'completed' : 'updated')
      return detail
    },
  )

  server.handle(
    RPC_CHANNELS.teamRuns.SEND_MESSAGE,
    async (_ctx, workspaceId: string, runId: string, input: SendTeamMessageInput): Promise<TeamRunDetail> => {
      const rootPath = resolveRootPath(deps, workspaceId)
      sendTeamMessage(rootPath, runId, input)
      const detail = readTeamRunDetail(rootPath, runId)
      if (!detail) throw new Error(`Team run not found: ${runId}`)
      broadcastUpdated(deps, workspaceId, detail, 'updated')
      return detail
    },
  )
}
