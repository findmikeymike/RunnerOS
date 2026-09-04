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
import { settleEmailJobOutput } from '../../community/CommunityToolService'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.community.GET,
  RPC_CHANNELS.community.ADD_CONTACT,
  RPC_CHANNELS.community.IMPORT_CSV,
  RPC_CHANNELS.community.CREATE_EMAIL_JOB,
  RPC_CHANNELS.community.SUPPRESS,
  RPC_CHANNELS.community.GET_SETUP,
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

  /**
   * What is still missing before fan email can go out.
   *
   * Reported as steps rather than one boolean, because "not set up" is
   * useless when the artist has done three of four things.
   */
  server.handle(RPC_CHANNELS.community.GET_SETUP, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { getCredentialManager } = await import('@craft-agent/shared/credentials')
    const credentials = getCredentialManager()

    const [apiKey, from, unsubscribeUrl, postalAddress] = await Promise.all([
      credentials.getUserSecret('RESEND_API_KEY'),
      credentials.getUserSecret('COMMUNITY_FROM_EMAIL'),
      credentials.getUserSecret('COMMUNITY_UNSUBSCRIBE_URL'),
      credentials.getUserSecret('COMMUNITY_POSTAL_ADDRESS'),
    ])

    // Only worth asking Resend once there is a key and an address to check.
    let domain: { name: string; verified: boolean; note?: string } | undefined
    if (apiKey && from) {
      const { ResendMailer } = await import('../../community/ResendMailer')
      const check = await new ResendMailer({ apiKey }).verifySender(from)
      domain = {
        name: from.split('@')[1] ?? from,
        verified: check.ok,
        ...(check.ok ? {} : { note: check.error }),
      }
    }

    // A site that is already live is the obvious place to host the opt-out.
    let suggestedUnsubscribeUrl: string | undefined
    try {
      const { loadWebsiteManifest } = await import('@craft-agent/shared/website')
      const production = loadWebsiteManifest(workspace.rootPath)?.urls.production
      if (production) suggestedUnsubscribeUrl = `${production.replace(/\/+$/, '')}/unsubscribe`
    } catch {
      // No site yet; the artist supplies a URL themselves.
    }

    const steps = [
      { id: 'RESEND_API_KEY', label: 'Resend API key', done: Boolean(apiKey), secret: true },
      { id: 'COMMUNITY_FROM_EMAIL', label: 'Send from', done: Boolean(from), value: from ?? undefined },
      { id: 'COMMUNITY_UNSUBSCRIBE_URL', label: 'Unsubscribe link', done: Boolean(unsubscribeUrl), value: unsubscribeUrl ?? undefined },
      { id: 'COMMUNITY_POSTAL_ADDRESS', label: 'Postal address', done: Boolean(postalAddress), value: postalAddress ?? undefined },
    ]

    return {
      ok: true,
      ready: steps.every(step => step.done) && domain?.verified === true,
      steps,
      domain,
      suggestedUnsubscribeUrl,
      remaining: steps.filter(step => !step.done).length + (domain && !domain.verified ? 1 : 0),
    }
  })

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

    const result = await mail.send(workspace.rootPath, machineId, jobId, provider, { kind: 'user' })
    // Stop the mirrored Output asking for attention once the decision is made.
    if (result.ok) {
      settleEmailJobOutput(workspace.rootPath, jobId, 'approved', 'Sent to the fan list.')
    }
    return result
  })

  server.handle(RPC_CHANNELS.community.CANCEL_EMAIL_JOB, async (_ctx, workspaceId: string, jobId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ assertTeamPermission, getTeamModeStatus }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
    ])
    assertTeamPermission(workspace.rootPath, 'community.email.draft')
    const machineId = normalizeMachineId(getTeamModeStatus(workspace.rootPath).machine.machineId)
    const result = new CommunityMailService().cancel(workspace.rootPath, machineId, jobId)
    if (result.ok) {
      settleEmailJobOutput(workspace.rootPath, jobId, 'changes_requested', 'The artist discarded this draft.')
    }
    return result
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
