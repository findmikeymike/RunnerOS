import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { WebsiteService, settleSitePreviewApproval } from '../../website/WebsiteService'
import { collectRoutineSignals } from '../../website/signals'
import type { WebsiteRoutineConfig } from '@craft-agent/shared/website'
import {
  approvePublishTarget,
  approveWebsiteBuild,
  clearWebsiteApproval,
  recentReceipts,
  siteHistory,
} from '../../website/publish'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.website.STATUS,
  RPC_CHANNELS.website.HISTORY,
  RPC_CHANNELS.website.APPROVE_BUILD,
  RPC_CHANNELS.website.CLEAR_APPROVAL,
  RPC_CHANNELS.website.APPROVE_TARGET,
  RPC_CHANNELS.website.PUBLISH,
  RPC_CHANNELS.website.ROLLBACK,
  RPC_CHANNELS.website.SET_TRUSTED_MODE,
  RPC_CHANNELS.website.BUILD,
  RPC_CHANNELS.website.PREVIEW,
  RPC_CHANNELS.website.CAPTURE_SYNC,
  RPC_CHANNELS.website.DOMAIN_SET,
  RPC_CHANNELS.website.DOMAIN_CHECK,
  RPC_CHANNELS.website.RUN_ROUTINE,
  RPC_CHANNELS.website.SET_ROUTINE,
  RPC_CHANNELS.website.CLEAR_BRIEF,
] as const

function resolveWorkspace(workspaceId: string): { rootPath: string; id: string } {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace
}

async function machineIdFor(workspaceRootPath: string): Promise<string> {
  const { getTeamModeStatus } = await import('@craft-agent/shared/workspaces')
  try {
    return getTeamModeStatus(workspaceRootPath).machine.machineId.trim() || 'local-machine'
  } catch {
    return 'local-machine'
  }
}

/**
 * Website RPCs.
 *
 * These are the artist's own actions, so `origin.kind` is always `user` and
 * approval comes from this layer rather than from a session. An agent has no
 * path to any of these.
 */
export function registerWebsiteHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const service = new WebsiteService()

  server.handle(RPC_CHANNELS.website.STATUS, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.status(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.website.HISTORY, async (_ctx, workspaceId: string, limit?: number) => {
    const workspace = resolveWorkspace(workspaceId)
    return {
      ok: true,
      deploys: siteHistory(workspace.rootPath, limit ?? 20),
      receipts: recentReceipts(workspace.rootPath, limit ?? 20),
    }
  })

  // The one place an approval is created. Bound to an exact build hash.
  server.handle(RPC_CHANNELS.website.APPROVE_BUILD, async (_ctx, workspaceId: string, buildHash: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const manifest = approveWebsiteBuild(workspace.rootPath, buildHash)
    return manifest ? { ok: true, pendingApproval: manifest.pendingApproval } : { ok: false, error: 'No website yet.' }
  })

  server.handle(RPC_CHANNELS.website.CLEAR_APPROVAL, async (_ctx, workspaceId: string) => {
    clearWebsiteApproval(resolveWorkspace(workspaceId).rootPath)
    return { ok: true }
  })

  server.handle(RPC_CHANNELS.website.APPROVE_TARGET, async (_ctx, workspaceId: string, target: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const manifest = approvePublishTarget(workspace.rootPath, target)
    return manifest ? { ok: true, targetApproval: manifest.targetApproval } : { ok: false, error: 'No website yet.' }
  })

  /**
   * Approve and publish in one action.
   *
   * The artist pressing Publish is both the approval and the instruction, so
   * splitting them would only create a window where the build could change
   * between the two.
   */
  server.handle(RPC_CHANNELS.website.PUBLISH, async (_ctx, workspaceId: string, input: {
    buildHash: string
    changeClass?: 'content-only' | 'design'
    summary?: string
    why?: string[]
    changes?: string[]
  }) => {
    const workspace = resolveWorkspace(workspaceId)
    const approvedAt = new Date().toISOString()
    approveWebsiteBuild(workspace.rootPath, input.buildHash, { now: approvedAt })

    const result = await service.deploy(workspace.rootPath, {
      target: 'production',
      buildHash: input.buildHash,
      changeClass: input.changeClass ?? 'content-only',
      summary: input.summary ?? 'Published the site.',
      why: input.why,
      changes: input.changes,
    }, {
      machineId: await machineIdFor(workspace.rootPath),
      origin: { kind: 'user' },
      approval: { boundTo: input.buildHash, approvedAt },
    })

    // A refused publish must not leave a live approval sitting behind it.
    if (!result.ok) clearWebsiteApproval(workspace.rootPath)
    else {
      // The brief's preview stops asking once the change is live.
      const { loadWebsiteManifest } = await import('@craft-agent/shared/website')
      settleSitePreviewApproval(
        workspace.rootPath,
        loadWebsiteManifest(workspace.rootPath)?.pendingBrief?.site?.previewOutputId,
        'approved',
        'Published to the live site.',
      )
    }
    return result
  })

  server.handle(RPC_CHANNELS.website.ROLLBACK, async (_ctx, workspaceId: string, input: { deployId?: string; reason?: string }) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.rollback(workspace.rootPath, input ?? {}, {
      machineId: await machineIdFor(workspace.rootPath),
      origin: { kind: 'user' },
    })
  })

  /**
   * Trusted mode is granted here and nowhere else.
   *
   * Spec 41 Core Law 3: an agent can never turn this on for itself.
   */
  server.handle(RPC_CHANNELS.website.SET_TRUSTED_MODE, async (_ctx, workspaceId: string, enabled: boolean) => {
    const workspace = resolveWorkspace(workspaceId)
    const [{ loadWebsiteManifest, saveWebsiteManifest, grantTrustedMode, disableTrustedMode }] = await Promise.all([
      import('@craft-agent/shared/website'),
    ])
    const manifest = loadWebsiteManifest(workspace.rootPath)
    if (!manifest) return { ok: false, error: 'No website yet.' }
    try {
      const next = enabled ? grantTrustedMode(manifest) : disableTrustedMode(manifest)
      saveWebsiteManifest(workspace.rootPath, next)
      return { ok: true, publishPolicy: next.publishPolicy }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  server.handle(RPC_CHANNELS.website.BUILD, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.build(workspace.rootPath, {}, { workspaceRootPath: workspace.rootPath })
  })

  server.handle(RPC_CHANNELS.website.PREVIEW, async (_ctx, workspaceId: string, input?: { build?: boolean }) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.preview(
      workspace.rootPath,
      { workspaceRootPath: workspace.rootPath, workspaceId: workspace.id },
      input ?? {},
      { sessionId: undefined },
      { workspaceRootPath: workspace.rootPath },
    )
  })

  server.handle(RPC_CHANNELS.website.CAPTURE_SYNC, async (_ctx, workspaceId: string, input?: { limit?: number }) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.syncCapture(workspace.rootPath, {
      machineId: await machineIdFor(workspace.rootPath),
      origin: { kind: 'user' },
    }, input ?? {})
  })

  server.handle(RPC_CHANNELS.website.DOMAIN_SET, async (_ctx, workspaceId: string, domain: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.setDomain(workspace.rootPath, { domain }, {
      machineId: await machineIdFor(workspace.rootPath),
      origin: { kind: 'user' },
    })
  })

  server.handle(RPC_CHANNELS.website.DOMAIN_CHECK, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.checkDomain(workspace.rootPath)
  })

  /** Run the routine now. Also the "manual" cadence's only trigger. */
  server.handle(RPC_CHANNELS.website.RUN_ROUTINE, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const signals = collectRoutineSignals(workspace.rootPath, workspace.id)
    return service.runRoutine(workspace.rootPath, {
      machineId: await machineIdFor(workspace.rootPath),
      origin: { kind: 'user' },
    }, {
      signals,
      previewTarget: { workspaceRootPath: workspace.rootPath, workspaceId: workspace.id },
    })
  })

  server.handle(RPC_CHANNELS.website.SET_ROUTINE, async (_ctx, workspaceId: string, config: WebsiteRoutineConfig) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.setRoutine(workspace.rootPath, config)
  })

  server.handle(RPC_CHANNELS.website.CLEAR_BRIEF, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return service.clearBrief(workspace.rootPath)
  })
}
