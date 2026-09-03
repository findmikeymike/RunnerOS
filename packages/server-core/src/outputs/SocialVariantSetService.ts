import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  SOCIAL_VARIANT_MAX_SOURCES,
  SOCIAL_VARIANT_MAX_TOTAL,
  SOCIAL_VARIANT_SET_TAG,
  advanceSocialVariantSetRevision,
  assertSocialVariantSetManifest,
  assertSocialVariantSetRevision,
  createOutputBundle,
  isSocialVariantDestinationIntent,
  readOutput,
  resolveOutputAssetPath,
  withOutputBundleLockAsync,
  writeOutputManifest,
  type CreateSocialVariantSetRequest,
  type OutputManifest,
  type SocialVariantDestinationIntent,
  type SocialVariantSource,
  type SocialVariantSourceSelection,
} from '@craft-agent/shared/outputs';
import {
  loadReleaseKitManifest,
  resolveVerifiedReleaseKitItemPathWhileLocked,
  withReleaseKitLockAsync,
} from '@craft-agent/shared/release-kit';
import {
  loadArtistVaultManifest,
  resolveArtistVaultAssetPath,
} from '@craft-agent/shared/artist-vault';

export interface SocialVariantWorkspace {
  id: string;
  name: string;
  rootPath: string;
  artistWorkspaceScope?: 'hq' | 'campaign' | 'lab' | 'general';
}

export interface SocialVariantSetServiceDeps {
  getWorkspace: (workspaceId: string) => SocialVariantWorkspace | undefined;
  emitOutputsUpdated?: (workspaceId: string) => void;
  validateSocialProfile?: (input: { platform: string; profileId: string }) => Promise<{ ready: boolean; reason?: string }>;
  now?: () => Date;
}

export interface CreateSocialVariantSetCommand extends CreateSocialVariantSetRequest {
  requestedByClientId: string;
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);

export class SocialVariantSetService {
  constructor(private readonly deps: SocialVariantSetServiceDeps) {}

  async create(workspaceId: string, input: CreateSocialVariantSetCommand): Promise<OutputManifest> {
    const workspace = this.requireWorkspace(workspaceId);
    const scope = this.requireSupportedScope(workspace);
    this.assertCreateShape(input);

    const destinationIntents = input.destinationIntents.map((intent) => this.normalizeDestination(intent));
    if (!destinationIntents.every(isSocialVariantDestinationIntent)) throw new Error('One or more destination choices are invalid.');
    for (const intent of destinationIntents) {
      if (!intent.profileId) continue;
      if (!this.deps.validateSocialProfile) throw new Error('Social profile validation is unavailable on this host.');
      const result = await this.deps.validateSocialProfile({ platform: intent.platform, profileId: intent.profileId });
      if (!result.ready) throw new Error(result.reason ?? `Social profile is not ready: ${intent.platform}/${intent.profileId}`);
    }

    const sources: SocialVariantSource[] = [];
    for (const selection of input.sourceSelections) {
      sources.push(await this.resolveSource(workspace, selection));
    }

    const outputId = randomUUID();
    const now = (this.deps.now?.() ?? new Date()).toISOString();
    const title = this.resolveTitle(input.title, sources);
    const socialVariantSet = {
      schemaVersion: 1 as const,
      revision: 1,
      id: outputId,
      workspaceId,
      scope,
      ...(scope === 'campaign' ? { campaignId: workspaceId } : {}),
      status: 'queued' as const,
      editorSessionId: input.editorSessionId,
      sources,
      request: {
        variantsPerSource: input.variantsPerSource,
        totalRequested: sources.length * input.variantsPerSource,
        destinationIntents,
        ...(input.direction?.trim() ? { direction: input.direction.trim() } : {}),
        requestedAt: now,
        requestedBy: { type: 'user' as const, clientId: input.requestedByClientId },
      },
      variants: [],
      createdAt: now,
      updatedAt: now,
    };
    assertSocialVariantSetManifest(socialVariantSet);

    const output = createOutputBundle(workspace.rootPath, {
      id: outputId,
      workspaceId,
      title,
      kind: 'collection',
      status: 'draft',
      summary: `Preparing ${socialVariantSet.request.totalRequested} social video variant${socialVariantSet.request.totalRequested === 1 ? '' : 's'} from ${sources.length} source${sources.length === 1 ? '' : 's'}.`,
      origin: { source: 'session', sessionId: input.editorSessionId, agentSlug: 'raw-video-editor' },
      context: { scope, ...(scope === 'campaign' ? { campaignId: workspaceId } : {}) },
      tags: [SOCIAL_VARIANT_SET_TAG],
      socialVariantSet,
      createdAt: now,
    });
    this.deps.emitOutputsUpdated?.(workspaceId);
    return output;
  }

  async start(workspaceId: string, outputId: string, expectedRevision: number): Promise<OutputManifest> {
    const workspace = this.requireWorkspace(workspaceId);
    const result = await withOutputBundleLockAsync(workspace.rootPath, outputId, async () => {
      const current = readOutput(workspace.rootPath, outputId);
      if (!current?.socialVariantSet) throw new Error(`Social Variant Set not found: ${outputId}`);
      if (current.workspaceId !== workspaceId) throw new Error(`Output "${outputId}" is not in workspace "${workspaceId}".`);
      assertSocialVariantSetRevision(current.socialVariantSet, expectedRevision);
      if (current.socialVariantSet.status !== 'queued' && current.socialVariantSet.status !== 'needs-attention') {
        throw new Error(`Social Variant Set cannot start from ${current.socialVariantSet.status}.`);
      }
      const now = this.nextTimestamp(current.socialVariantSet.updatedAt);
      let sourceFailure: { sourceId: string; message: string } | undefined;
      for (const source of current.socialVariantSet.sources) {
        try {
          await this.assertPinnedSourceCurrent(workspace, source);
        } catch (error) {
          sourceFailure = {
            sourceId: source.id,
            message: error instanceof Error ? error.message : `Source is unavailable: ${source.title}`,
          };
          break;
        }
      }
      if (sourceFailure) {
        const set = advanceSocialVariantSetRevision(current.socialVariantSet, {
          status: 'needs-attention',
          variants: current.socialVariantSet.variants,
          attention: {
            code: 'source-unavailable',
            message: sourceFailure.message,
            sourceId: sourceFailure.sourceId,
            updatedAt: now,
          },
        }, now);
        const updated: OutputManifest = {
          ...current,
          summary: `Needs attention: ${sourceFailure.message}`,
          updatedAt: now,
          socialVariantSet: set,
        };
        writeOutputManifest(workspace.rootPath, updated);
        return { output: updated, error: new Error(sourceFailure.message) };
      }
      const set = advanceSocialVariantSetRevision(current.socialVariantSet, {
        status: 'analyzing',
        variants: current.socialVariantSet.variants,
      }, now);
      const updated: OutputManifest = {
        ...current,
        updatedAt: now,
        socialVariantSet: set,
      };
      writeOutputManifest(workspace.rootPath, updated);
      return { output: updated };
    });
    this.deps.emitOutputsUpdated?.(workspaceId);
    if (result.error) throw result.error;
    return result.output;
  }

  private requireWorkspace(workspaceId: string): SocialVariantWorkspace {
    const workspace = this.deps.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  private requireSupportedScope(workspace: SocialVariantWorkspace): 'hq' | 'campaign' {
    if (workspace.artistWorkspaceScope === 'hq' || workspace.artistWorkspaceScope === 'campaign') {
      return workspace.artistWorkspaceScope;
    }
    throw new Error('Social Variant Sets are available only in Artist HQ or a Campaign workspace.');
  }

  private assertCreateShape(input: CreateSocialVariantSetCommand): void {
    if (!input.editorSessionId?.trim()) throw new Error('Raw Video Editor session is required.');
    if (!input.requestedByClientId?.trim()) throw new Error('Requesting client is required.');
    if (!Array.isArray(input.sourceSelections) || input.sourceSelections.length < 1 || input.sourceSelections.length > SOCIAL_VARIANT_MAX_SOURCES) {
      throw new Error(`Choose between 1 and ${SOCIAL_VARIANT_MAX_SOURCES} source videos.`);
    }
    if (!Number.isInteger(input.variantsPerSource) || input.variantsPerSource < 1) {
      throw new Error('Choose at least one variant per source.');
    }
    if (input.sourceSelections.length * input.variantsPerSource > SOCIAL_VARIANT_MAX_TOTAL) {
      throw new Error(`One creation can render at most ${SOCIAL_VARIANT_MAX_TOTAL} variants.`);
    }
    if (!Array.isArray(input.destinationIntents) || input.destinationIntents.length < 1) {
      throw new Error('Choose at least one intended destination.');
    }
    if (input.direction !== undefined && input.direction.length > 4_000) throw new Error('Creative direction is too long.');
    if (input.title !== undefined && (!input.title.trim() || input.title.length > 240)) throw new Error('Variant Set title is invalid.');
  }

  private normalizeDestination(intent: SocialVariantDestinationIntent): SocialVariantDestinationIntent {
    return {
      platform: intent.platform,
      accountRole: intent.accountRole,
      ...(intent.profileId?.trim() ? { profileId: intent.profileId.trim() } : {}),
      ...(intent.accountSetId?.trim() ? { accountSetId: intent.accountSetId.trim() } : {}),
      ...(intent.labelSnapshot?.trim() ? { labelSnapshot: intent.labelSnapshot.trim() } : {}),
      mode: intent.mode,
      ...(intent.trialRequested === true ? { trialRequested: true as const } : {}),
    };
  }

  private resolveTitle(requestedTitle: string | undefined, sources: SocialVariantSource[]): string {
    if (requestedTitle?.trim()) return requestedTitle.trim();
    if (sources.length === 1) return `${sources[0]!.title} social variants`;
    return `${sources.length} videos - social variants`;
  }

  private async resolveSource(workspace: SocialVariantWorkspace, selection: SocialVariantSourceSelection): Promise<SocialVariantSource> {
    if (!selection || !selection.sourceId?.trim()) throw new Error('Every source selection needs an exact source ID.');
    if (selection.origin === 'release-kit') return this.resolveReleaseKitSource(workspace, selection.sourceId);
    if (selection.origin === 'vault') return this.resolveVaultSource(workspace, selection.sourceId);
    return this.resolveOutputSource(workspace, selection.sourceId, selection.assetId);
  }

  private async assertPinnedSourceCurrent(workspace: SocialVariantWorkspace, source: SocialVariantSource): Promise<void> {
    const selection: SocialVariantSourceSelection = source.origin === 'release-kit'
      ? { origin: 'release-kit', sourceId: source.sourceId }
      : source.origin === 'vault'
        ? { origin: 'vault', sourceId: source.sourceId }
        : source.origin === 'output'
          ? { origin: 'output', sourceId: source.sourceId, ...(source.assetId ? { assetId: source.assetId } : {}) }
          : (() => { throw new Error(`Unsupported source origin: ${source.origin}`); })();
    const resolved = await this.resolveSource(workspace, selection);
    if (resolved.sha256 !== source.sha256.toLowerCase()) {
      throw new Error(`Source changed after variant setup: ${source.title}`);
    }
  }

  private async resolveReleaseKitSource(workspace: SocialVariantWorkspace, itemId: string): Promise<SocialVariantSource> {
    if (workspace.artistWorkspaceScope !== 'campaign') throw new Error('Release Kit sources must come from a Campaign workspace.');
    return withReleaseKitLockAsync(workspace.rootPath, async () => {
      const manifest = loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id);
      const item = manifest.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error(`Release Kit item not found: ${itemId}`);
      if (item.category !== 'video') throw new Error(`Release Kit item is not a video: ${itemId}`);
      if (item.status !== 'ready') throw new Error(`Release Kit item is not ready: ${itemId}`);
      const restrictions = item.usage.restrictions;
      if (restrictions.blockedFromUse || restrictions.needsRightsClearance || restrictions.artistLikenessRestricted) {
        throw new Error(`Release Kit item is restricted from variant creation: ${itemId}`);
      }
      resolveVerifiedReleaseKitItemPathWhileLocked(workspace.rootPath, workspace.id, workspace.id, item.id, item.sha256);
      return {
        id: randomUUID(),
        origin: 'release-kit',
        sourceId: item.id,
        title: item.title,
        sha256: item.sha256.toLowerCase(),
        rightsBasis: 'authorized',
      };
    });
  }

  private async resolveVaultSource(workspace: SocialVariantWorkspace, assetId: string): Promise<SocialVariantSource> {
    if (workspace.artistWorkspaceScope !== 'hq') throw new Error('Vault sources must be selected from Artist HQ.');
    const manifest = loadArtistVaultManifest(workspace.rootPath, workspace.id);
    const asset = manifest.assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error(`Vault asset not found: ${assetId}`);
    if (asset.category !== 'video') throw new Error(`Vault asset is not a video: ${assetId}`);
    if (asset.status !== 'approved' && asset.status !== 'final') throw new Error(`Vault video is not approved: ${assetId}`);
    if (asset.rightsStatus !== 'safe-to-use' || !asset.usableByAgents) throw new Error(`Vault video is not cleared for agent use: ${assetId}`);
    if (!asset.sha256) throw new Error(`Vault video has no pinned checksum: ${assetId}`);
    const path = resolveArtistVaultAssetPath(workspace.rootPath, asset);
    if (!path || !existsSync(path) || !statSync(path).isFile()) throw new Error(`Vault video is missing: ${assetId}`);
    const sha256 = await hashFileSha256(path);
    if (sha256 !== asset.sha256.toLowerCase()) throw new Error(`Vault video changed after it was indexed: ${assetId}`);
    return {
      id: randomUUID(),
      origin: 'vault',
      sourceId: asset.id,
      title: asset.label,
      sha256,
      rightsBasis: 'authorized',
    };
  }

  private async resolveOutputSource(workspace: SocialVariantWorkspace, outputId: string, requestedAssetId?: string): Promise<SocialVariantSource> {
    return withOutputBundleLockAsync(workspace.rootPath, outputId, async () => {
      const output = readOutput(workspace.rootPath, outputId);
      if (!output) throw new Error(`Output source not found: ${outputId}`);
      if (output.workspaceId !== workspace.id) throw new Error(`Output "${outputId}" is not in workspace "${workspace.id}".`);
      const asset = requestedAssetId
        ? output.assets.find((candidate) => candidate.id === requestedAssetId)
        : output.primary ?? output.assets.find((candidate) => isVideoAsset(candidate.path, candidate.mimeType));
      if (!asset) throw new Error(`Output source has no matching asset: ${outputId}`);
      if (!isVideoAsset(asset.path, asset.mimeType)) throw new Error(`Output asset is not a supported video: ${asset.id}`);
      if (!asset.sha256) throw new Error(`Output video has no pinned checksum: ${asset.id}`);
      const path = resolveOutputAssetPath(workspace.rootPath, output.id, asset.path);
      if (!path || !existsSync(path) || !statSync(path).isFile()) throw new Error(`Output video is missing: ${asset.id}`);
      const sha256 = await hashFileSha256(path);
      if (sha256 !== asset.sha256.toLowerCase()) throw new Error(`Output video changed after it was recorded: ${asset.id}`);
      return {
        id: randomUUID(),
        origin: 'output',
        sourceId: output.id,
        assetId: asset.id,
        title: asset.label || output.title,
        sha256,
        rightsBasis: 'authorized',
      };
    });
  }

  private nextTimestamp(previous: string): string {
    const now = this.deps.now?.() ?? new Date();
    if (now.getTime() > Date.parse(previous)) return now.toISOString();
    return new Date(Date.parse(previous) + 1).toISOString();
  }
}

function isVideoAsset(path: string, mimeType?: string): boolean {
  return mimeType?.toLowerCase().startsWith('video/') === true || VIDEO_EXTENSIONS.has(extname(path).toLowerCase());
}

function hashFileSha256(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}
