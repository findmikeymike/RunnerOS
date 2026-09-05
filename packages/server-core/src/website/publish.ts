import {
  checkApprovalBinding,
  deriveChangeClass,
  listChangeReceipts,
  loadWebsiteManifest,
  recordCleanPublish,
  resolveApprovalTier,
  revokeTrustedMode,
  saveWebsiteManifest,
  websiteDistDir,
  writeChangeReceipt,
  type ApprovalBinding,
  type ChangeClass,
  type ChangeReceiptOrigin,
  type DeployRecord,
  type DeployTarget,
  type WebsiteManifest,
} from '@craft-agent/shared/website'
import type { SiteDeployAdapter } from './adapters/types'
import { deploySnapshotDir, hasDeploySnapshot, retainDeploySnapshot } from './deploy-snapshots'
import { hashBuildDirectory, snapshotBuild, withWebsiteLock } from './build-snapshot'

export interface PublishDeps {
  /** Resolves the configured adapter, or explains why it cannot be built. */
  resolveAdapter: (manifest: WebsiteManifest) => Promise<SiteDeployAdapter>
  machineId: string
  now?: () => string
  retainSnapshot?: typeof retainDeploySnapshot
}

export interface PublishInput {
  target: DeployTarget
  /** Must match the current build. A rebuild between approval and publish is refused. */
  buildHash: string
  changeClass: ChangeClass
  approval?: ApprovalBinding
  origin: ChangeReceiptOrigin
  summary: string
  why?: string[]
  changes?: string[]
  previewOutputId?: string
}

export type PublishResult =
  | {
    ok: true
    deployId: string
    url: string
    target: DeployTarget
    tier: 'free' | 'one-click' | 'trusted'
    receiptId?: string
    trustedModeOffered?: boolean
  }
  | {
    ok: false
    error: string
    /** Set when the only thing missing is a human decision. */
    needsApproval?: boolean
    failure?: 'no-approval' | 'hash-changed' | 'expired' | 'no-target-approval' | 'stale-build' | 'not-managed' | 'no-site' | 'no-build'
  }

function nowIso(deps: PublishDeps): string {
  return deps.now?.() ?? new Date().toISOString()
}

/**
 * Publish a built site.
 *
 * Preview deploys are free: they cost nothing, reach nobody, and are how the
 * artist sees a change before deciding. Production deploys are the one place
 * a human decision is required, unless trusted mode covers this change class.
 */
export async function publishSite(
  workspaceRootPath: string,
  input: PublishInput,
  deps: PublishDeps,
): Promise<PublishResult> {
  return withWebsiteLock(workspaceRootPath, () => publishSiteUnlocked(workspaceRootPath, input, deps))
}

async function publishSiteUnlocked(workspaceRootPath: string, input: PublishInput, deps: PublishDeps): Promise<PublishResult> {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  if (!manifest) return { ok: false, error: 'No website in this workspace yet.', failure: 'no-site' }
  if (manifest.mode !== 'managed') {
    return {
      ok: false,
      error: `This workspace is in ${manifest.mode} mode. Publishing through an external site is not available yet.`,
      failure: 'not-managed',
    }
  }
  if (!manifest.lastBuild) {
    return { ok: false, error: 'Build the site before publishing.', failure: 'no-build' }
  }
  if (manifest.lastBuild.hash !== input.buildHash) {
    return {
      ok: false,
      error: 'The site was rebuilt after this change was prepared. Preview the new build and approve that.',
      failure: 'stale-build',
    }
  }

  let tier: 'free' | 'one-click' | 'trusted' = 'free'

  // The caller's change class is a claim, not evidence. Derive it from the
  // build's design inputs so a mislabelled template edit cannot ride trusted
  // mode to production, and take whichever answer is stricter.
  const derived = deriveChangeClass(
    manifest.lastBuild.designHash,
    lastPublishedDesignHash(manifest),
  )
  const changeClass: ChangeClass =
    derived === 'design' || input.changeClass === 'design' ? 'design' : 'content-only'

  if (input.target === 'production') {
    if (!manifest.targetApproval) {
      return {
        ok: false,
        error: 'Approve the publish target once before the first live publish.',
        needsApproval: true,
        failure: 'no-target-approval',
      }
    }
    const decision = resolveApprovalTier(manifest, changeClass)
    tier = decision.tier
    if (decision.requiresApproval) {
      const binding = checkApprovalBinding(input.approval, input.buildHash, { now: nowIso(deps) })
      if (!binding.ok) {
        return { ok: false, error: binding.message, needsApproval: true, failure: binding.failure }
      }
    }
  }

  if (!manifest.lastBuild.artifactHash) return { ok: false, error: 'Rebuild the site before publishing so its files can be verified.', failure: 'stale-build' }
  const snapshot = snapshotBuild(websiteDistDir(workspaceRootPath), manifest.lastBuild.artifactHash)
  try {
  const adapter = await deps.resolveAdapter(manifest)
  const distDir = snapshot.path
  // Nothing is written before this returns, so a failed deploy leaves the
  // manifest exactly as it was.
  const deployed = await adapter.deploy({ distDir, target: input.target, buildHash: input.buildHash })
  const at = nowIso(deps)

  const record: DeployRecord = {
    id: deployed.deployId,
    target: input.target,
    at,
    url: deployed.url,
    buildHash: input.buildHash,
    designHash: manifest.lastBuild.designHash,
    previousDeployId: liveDeploy(manifest, input.target)?.id,
    origin: input.origin,
    status: 'live',
  }

  const latest = loadWebsiteManifest(workspaceRootPath) ?? manifest
  let next: WebsiteManifest = {
    ...latest,
    history: [record, ...supersede(latest.history, input.target)],
    urls: { ...latest.urls, [input.target]: deployed.url },
    // One approval covers one publish. Spend it so the same click cannot
    // ship a second, different build later.
    ...(input.target === 'production' && latest.pendingApproval?.boundTo === input.buildHash ? { pendingApproval: undefined } : {}),
  }

  let trustedModeOffered = false
  if (input.target === 'production') {
    const before = next.publishPolicy.trustedEligibleAt
    next = recordCleanPublish(next, { now: at })
    trustedModeOffered = !before && Boolean(next.publishPolicy.trustedEligibleAt)
  }
  saveWebsiteManifest(workspaceRootPath, next)

  // Retain the exact bytes so rollback never depends on a host's version API.
  // This runs after the manifest is saved: the site is already live, so a
  // failure here must not hide the deploy. It only costs the ability to roll
  // back to this one build, which `siteHistory` reports honestly.
  let retained = true
  if (input.target === 'production') {
    try {
      retainDeploySnapshot(workspaceRootPath, deployed.deployId, distDir)
    } catch {
      retained = false
    }
  }

  // Preview deploys are routine and would bury the real history.
  let receiptId: string | undefined
  if (input.target === 'production') {
    const receipt = writeChangeReceipt(workspaceRootPath, deps.machineId, {
      kind: 'site-publish',
      origin: input.origin,
      approval: {
        tier,
        boundTo: input.buildHash,
        ...(tier === 'one-click'
          ? { approvedAt: input.approval?.approvedAt ?? at, approvedBy: 'user' as const }
          : {}),
      },
      summary: input.summary,
      why: input.why,
      changes: input.changes,
      before: record.previousDeployId ? { deployId: record.previousDeployId, url: manifest.urls.production } : undefined,
      after: { deployId: deployed.deployId, url: deployed.url, buildHash: input.buildHash },
      preview: input.previewOutputId ? { outputId: input.previewOutputId } : undefined,
      rollback: record.previousDeployId && retained
        ? { kind: 'deploy', target: record.previousDeployId }
        : { kind: 'none' },
      audit: { score: manifest.lastBuild.auditScore, warnings: manifest.lastBuild.warnings },
    }, { now: at })
    receiptId = receipt.id
  }

  return {
    ok: true,
    deployId: deployed.deployId,
    url: deployed.url,
    target: input.target,
    tier,
    receiptId,
    ...(trustedModeOffered ? { trustedModeOffered: true } : {}),
  }
  } finally { snapshot.dispose() }
}

export interface RollbackInput {
  /** Defaults to the deploy that was live before the current one. */
  deployId?: string
  origin: ChangeReceiptOrigin
  reason?: string
}

export type RollbackResult =
  | { ok: true; deployId: string; url: string; receiptId?: string; trustedModeRevoked: boolean; warnings?: string[] }
  | { ok: false; error: string }

/**
 * Restore a previous production deploy by re-publishing its retained bytes.
 *
 * A rollback is the artist telling us the loop published something they did
 * not want, so it always takes trusted mode away.
 */
export async function rollbackSite(
  workspaceRootPath: string,
  input: RollbackInput,
  deps: PublishDeps,
): Promise<RollbackResult> {
  return withWebsiteLock(workspaceRootPath, () => rollbackSiteUnlocked(workspaceRootPath, input, deps))
}

async function rollbackSiteUnlocked(workspaceRootPath: string, input: RollbackInput, deps: PublishDeps): Promise<RollbackResult> {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  if (!manifest) return { ok: false, error: 'No website in this workspace yet.' }

  const current = liveDeploy(manifest, 'production')
  const target = input.deployId
    ? manifest.history.find(entry => entry.id === input.deployId && entry.target === 'production')
    : manifest.history.find(entry =>
      entry.target === 'production' && entry.id !== current?.id && entry.status !== 'failed')

  if (!target) {
    return { ok: false, error: 'No earlier production deploy to roll back to.' }
  }
  if (!hasDeploySnapshot(workspaceRootPath, target.id)) {
    return {
      ok: false,
      error: `The build for ${target.id} is no longer retained, so it cannot be restored. Rebuild and publish instead.`,
    }
  }

  const source = deploySnapshotDir(workspaceRootPath, target.id)
  const snapshot = snapshotBuild(source, hashBuildDirectory(source))
  try {
  const adapter = await deps.resolveAdapter(manifest)
  const deployed = await adapter.deploy({
    distDir: snapshot.path,
    target: 'production',
    buildHash: target.buildHash,
  })
  const at = nowIso(deps)

  const record: DeployRecord = {
    id: deployed.deployId,
    target: 'production',
    at,
    url: deployed.url,
    buildHash: target.buildHash,
    designHash: target.designHash,
    previousDeployId: current?.id,
    origin: input.origin,
    status: 'live',
  }

  const latest = loadWebsiteManifest(workspaceRootPath) ?? manifest
  const wasTrusted = latest.publishPolicy.contentOnly === 'auto'
  const history = supersede(latest.history, 'production').map(entry =>
    entry.id === current?.id ? { ...entry, status: 'rolled-back' as const } : entry)

  saveWebsiteManifest(
    workspaceRootPath,
    revokeTrustedMode(
      { ...latest, history: [record, ...history], urls: { ...latest.urls, production: deployed.url }, pendingApproval: undefined },
      { now: at },
    ),
  )

  const warnings: string[] = []
  try {
    (deps.retainSnapshot ?? retainDeploySnapshot)(workspaceRootPath, deployed.deployId, snapshot.path)
  } catch {
    warnings.push('The site was restored, but a local backup of this restored version could not be saved.')
  }
  let receiptId: string | undefined
  try {
  const receipt = writeChangeReceipt(workspaceRootPath, deps.machineId, {
    kind: 'site-rollback',
    origin: input.origin,
    approval: { tier: 'one-click', approvedAt: at, approvedBy: 'user', boundTo: target.id },
    summary: `Rolled the site back to the build from ${target.at.slice(0, 10)}.`,
    why: input.reason ? [input.reason] : ['The artist rolled this change back.'],
    changes: [`Restored deploy ${target.id}`],
    before: { deployId: current?.id, url: current?.url },
    after: { deployId: deployed.deployId, url: deployed.url, buildHash: target.buildHash },
    rollback: { kind: 'none' },
  }, { now: at })
  receiptId = receipt.id
  } catch {
    warnings.push('The site was restored, but its change receipt could not be saved.')
  }

  return {
    ok: true,
    deployId: deployed.deployId,
    url: deployed.url,
    receiptId,
    trustedModeRevoked: wasTrusted,
    ...(warnings.length ? { warnings } : {}),
  }
  } finally { snapshot.dispose() }
}

export interface SiteHistoryEntry extends DeployRecord {
  canRollBackTo: boolean
}

export function siteHistory(workspaceRootPath: string, limit = 20): SiteHistoryEntry[] {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  if (!manifest) return []
  return manifest.history.slice(0, limit).map(entry => ({
    ...entry,
    canRollBackTo: entry.target === 'production'
      && entry.status !== 'live'
      && hasDeploySnapshot(workspaceRootPath, entry.id),
  }))
}

export function recentReceipts(workspaceRootPath: string, limit = 10) {
  return listChangeReceipts(workspaceRootPath, { limit })
}

/**
 * Record the artist's approval of one exact build.
 *
 * Only the renderer reaches this, through an RPC. It expires so a card left
 * open for days cannot publish a build the artist has since forgotten.
 */
export function approveWebsiteBuild(
  workspaceRootPath: string,
  buildHash: string,
  options: { now?: string; ttlHours?: number } = {},
): WebsiteManifest | null {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  if (!manifest) return null
  const at = options.now ?? new Date().toISOString()
  const ttl = (options.ttlHours ?? 72) * 60 * 60 * 1000
  return saveWebsiteManifest(workspaceRootPath, {
    ...manifest,
    pendingApproval: {
      boundTo: buildHash,
      approvedAt: at,
      expiresAt: new Date(Date.parse(at) + ttl).toISOString(),
    },
  })
}

export function clearWebsiteApproval(workspaceRootPath: string): void {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  if (!manifest?.pendingApproval) return
  saveWebsiteManifest(workspaceRootPath, { ...manifest, pendingApproval: undefined })
}

/** Record that the artist approved this exact publish target, once. */
export function approvePublishTarget(
  workspaceRootPath: string,
  target: string,
  options: { now?: string } = {},
): WebsiteManifest | null {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  if (!manifest) return null
  return saveWebsiteManifest(workspaceRootPath, {
    ...manifest,
    targetApproval: {
      approvedAt: options.now ?? new Date().toISOString(),
      approvedBy: 'user',
      target,
    },
  })
}

function liveDeploy(manifest: WebsiteManifest, target: DeployTarget): DeployRecord | undefined {
  return manifest.history.find(entry => entry.target === target && entry.status === 'live')
}

/** The design inputs of whatever is currently live in production. */
function lastPublishedDesignHash(manifest: WebsiteManifest): string | undefined {
  return manifest.history.find(entry => entry.target === 'production' && entry.status === 'live')?.designHash
}

function supersede(history: DeployRecord[], target: DeployTarget): DeployRecord[] {
  return history.map(entry =>
    entry.target === target && entry.status === 'live'
      ? { ...entry, status: 'superseded' as const }
      : entry)
}
