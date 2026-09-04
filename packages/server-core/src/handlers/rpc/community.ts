import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type {
  CreateCommunityEmailJobInput,
  CommunitySuppressionRecord,
  ImportCommunityCsvInput,
  UpsertCommunityContactInput,
} from '@craft-agent/shared/community'
import type { HandlerDeps } from '../handler-deps'
import { CommunityMailService, type MailProviderConfig } from '../../community/CommunityMailService'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.community.GET,
  RPC_CHANNELS.community.ADD_CONTACT,
  RPC_CHANNELS.community.IMPORT_CSV,
  RPC_CHANNELS.community.CREATE_EMAIL_JOB,
  RPC_CHANNELS.community.SUPPRESS,
  RPC_CHANNELS.community.UPDATE_EMAIL_JOB,
  RPC_CHANNELS.community.SEND_EMAIL_JOB,
  RPC_CHANNELS.community.CANCEL_EMAIL_JOB,
  RPC_CHANNELS.community.GET_ROUTINE,
  RPC_CHANNELS.community.SET_ROUTINE,
] as const

function resolveWorkspace(workspaceId: string): { rootPath: string } {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace
}

function normalizeMachineId(machineId: string): string {
  return machineId.trim() || 'local-machine'
}

export function registerCommunityHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.community.GET, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ evaluateTeamPermission, getTeamModeStatus }, { loadCommunityState, readCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    if (!evaluateTeamPermission(workspace.rootPath, 'records.write').allowed) {
      return readCommunityState(workspace.rootPath)
    }
    const status = getTeamModeStatus(workspace.rootPath)
    return loadCommunityState(workspace.rootPath, normalizeMachineId(status.machine.machineId))
  })

  server.handle(RPC_CHANNELS.community.ADD_CONTACT, async (_ctx, workspaceId: string, input: UpsertCommunityContactInput) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { upsertCommunityContact, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'records.write')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    upsertCommunityContact(workspace.rootPath, machineId, input)
    return loadCommunityState(workspace.rootPath, machineId)
  })

  server.handle(RPC_CHANNELS.community.IMPORT_CSV, async (_ctx, workspaceId: string, input: Omit<ImportCommunityCsvInput, 'assertedBy'> & { assertedBy?: string }) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { importCommunityCsv, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'records.write')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    importCommunityCsv(workspace.rootPath, machineId, {
      ...input,
      assertedBy: machineId,
    })
    return loadCommunityState(workspace.rootPath, machineId)
  })

  server.handle(RPC_CHANNELS.community.CREATE_EMAIL_JOB, async (_ctx, workspaceId: string, input: CreateCommunityEmailJobInput) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { createCommunityEmailJob, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'community.email.draft')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    createCommunityEmailJob(workspace.rootPath, machineId, input)
    return loadCommunityState(workspace.rootPath, machineId)
  })

  server.handle(RPC_CHANNELS.community.SUPPRESS, async (_ctx, workspaceId: string, email: string, reason?: CommunitySuppressionRecord['reason']) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { suppressCommunityContact, loadCommunityState }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'records.write')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    suppressCommunityContact(workspace.rootPath, machineId, email, reason)
    return loadCommunityState(workspace.rootPath, machineId)
  })

  // ---------------------------------------------------------------------
  // Drafts the artist reviews before anything is sent
  // ---------------------------------------------------------------------

  server.handle(RPC_CHANNELS.community.UPDATE_EMAIL_JOB, async (
    _ctx,
    workspaceId: string,
    jobId: string,
    patch: { subject?: string; bodyMarkdown?: string; title?: string },
  ) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }, { readEmailJob, updateEmailJobDraft }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/community'),
    ])
    assertTeamPermission(workspace.rootPath, 'community.email.draft')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)

    const job = readEmailJob(workspace.rootPath, jobId)
    if (!job) return { ok: false, error: 'That email no longer exists.' }

    const result = updateEmailJobDraft(workspace.rootPath, machineId, job, patch)
    if ('ok' in result && result.ok === false) {
      return { ok: false, error: result.message, failure: result.failure }
    }
    return { ok: true, job: result }
  })

  /**
   * Approve and send in one action.
   *
   * The artist pressing Send is both the approval and the instruction. This
   * is the only path that reaches real inboxes, and it is only reachable
   * from the UI — no session or agent can call it.
   */
  server.handle(RPC_CHANNELS.community.SEND_EMAIL_JOB, async (_ctx, workspaceId: string, jobId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
    ])
    assertTeamPermission(workspace.rootPath, 'community.email.send')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)

    const provider = await resolveMailProvider(workspace.rootPath)
    if ('error' in provider) return { ok: false, error: provider.error, failure: 'no-provider' }

    const mail = new CommunityMailService()
    const approved = mail.approve(workspace.rootPath, machineId, jobId)
    if (!approved.ok) return approved

    return mail.send(workspace.rootPath, machineId, jobId, provider, { kind: 'user' })
  })

  server.handle(RPC_CHANNELS.community.CANCEL_EMAIL_JOB, async (_ctx, workspaceId: string, jobId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
    ])
    assertTeamPermission(workspace.rootPath, 'community.email.draft')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    return new CommunityMailService().cancel(workspace.rootPath, machineId, jobId)
  })

  server.handle(RPC_CHANNELS.community.GET_ROUTINE, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { loadCommunityRoutine, describeCommunityCadence, cronForCommunityRoutine } =
      await import('@craft-agent/shared/community')
    const routine = loadCommunityRoutine(workspace.rootPath)
    return {
      ok: true,
      routine,
      cron: cronForCommunityRoutine(routine),
      description: describeCommunityCadence(routine),
    }
  })

  server.handle(RPC_CHANNELS.community.SET_ROUTINE, async (
    _ctx,
    workspaceId: string,
    config: { cadence: 'weekly' | 'monthly' | 'manual'; dayOfWeek?: number; dayOfMonth?: number; hour?: number },
  ) => {
    const workspace = resolveWorkspace(workspaceId)
    const { saveCommunityRoutine, describeCommunityCadence, cronForCommunityRoutine } =
      await import('@craft-agent/shared/community')
    const routine = saveCommunityRoutine(workspace.rootPath, config)
    return {
      ok: true,
      routine,
      cron: cronForCommunityRoutine(routine),
      description: describeCommunityCadence(routine),
    }
  })
}

/**
 * Where fan email is sent from.
 *
 * Missing pieces are reported as setup rather than a failure, because a
 * half-configured sender is a settings problem, not a broken send.
 */
async function resolveMailProvider(
  workspaceRootPath: string,
): Promise<MailProviderConfig | { error: string }> {
  const { getCredentialManager } = await import('@craft-agent/shared/credentials')
  const credentials = getCredentialManager()
  const [from, unsubscribeUrl, postalAddress] = await Promise.all([
    credentials.getUserSecret('COMMUNITY_FROM_EMAIL'),
    credentials.getUserSecret('COMMUNITY_UNSUBSCRIBE_URL'),
    credentials.getUserSecret('COMMUNITY_POSTAL_ADDRESS'),
  ])
  if (!from) return { error: 'Save COMMUNITY_FROM_EMAIL in Settings. It must use a domain verified in Resend.' }
  if (!unsubscribeUrl) {
    return { error: 'Save COMMUNITY_UNSUBSCRIBE_URL in Settings so every email carries a working way out.' }
  }
  return { from, unsubscribeUrl, postalAddress: postalAddress ?? undefined }
}
