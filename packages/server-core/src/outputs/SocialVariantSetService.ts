import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  SOCIAL_VARIANT_MAX_SOURCES,
  SOCIAL_VARIANT_MAX_TOTAL,
  SOCIAL_VARIANT_SET_TAG,
  OUTPUT_SHOW_IN_CANVAS_TAG,
  advanceSocialVariantSetRevision,
  assertSocialVariantSetManifest,
  assertSocialVariantSetRevision,
  createOutputBundle,
  getOutputDir,
  isSocialVariantDestinationIntent,
  listOutputManifests,
  readOutput,
  resolveOutputAssetPath,
  withOutputBundleLock,
  withOutputBundleLockAsync,
  writeOutputManifest,
  type CreateSocialVariantSetRequest,
  type ArchiveSocialVariantRequest,
  type OutputManifest,
  type RecordSocialVariantResultRequest,
  type RebindSocialVariantSetRequest,
  type ListUsableSocialVariantsRequest,
  type SocialVariantDestinationIntent,
  type SocialVariantRecord,
  type SocialVariantSource,
  type SocialVariantSourceSelection,
  type UsableSocialVariant,
} from '@craft-agent/shared/outputs';
import {
  loadReleaseKitManifest,
  resolveVerifiedReleaseKitItemPathWhileLocked,
  withReleaseKitLockAsync,
} from '@craft-agent/shared/release-kit';
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit';
import {
  loadArtistVaultManifest,
  resolveArtistVaultAssetPath,
} from '@craft-agent/shared/artist-vault';
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  summarizeReleaseKitItemUses,
} from '@craft-agent/shared/scheduled-work';
import { loadContextDoc } from '@craft-agent/shared/workspace-context';
import { assertPathWithinRealRoot, verifiedCopyFileSync } from '@craft-agent/shared/workspaces/verified-copy';

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
      if (!intent.profileId) throw new Error('Every social variant destination requires an exact connected account.');
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
      tags: [SOCIAL_VARIANT_SET_TAG, OUTPUT_SHOW_IN_CANVAS_TAG],
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

  getForEditor(workspaceId: string, outputId: string, editorSessionId: string, activeAgentSlug?: string): OutputManifest {
    const workspace = this.requireWorkspace(workspaceId);
    this.assertEditorIdentity(editorSessionId, activeAgentSlug);
    const output = readOutput(workspace.rootPath, outputId);
    if (!output?.socialVariantSet) throw new Error(`Social Variant Set not found: ${outputId}`);
    if (output.workspaceId !== workspaceId || output.socialVariantSet.workspaceId !== workspaceId) {
      throw new Error(`Social Variant Set is not in workspace "${workspaceId}".`);
    }
    if (output.socialVariantSet.editorSessionId !== editorSessionId) {
      throw new Error('This Variant Set belongs to a different Raw Video Editor session.');
    }
    return output;
  }

  getRenderIngressDir(workspaceId: string, outputId: string): string {
    const workspace = this.requireWorkspace(workspaceId);
    const output = readOutput(workspace.rootPath, outputId);
    if (!output?.socialVariantSet || output.workspaceId !== workspaceId) throw new Error(`Social Variant Set not found: ${outputId}`);
    const ingress = join(getOutputDir(workspace.rootPath, outputId), 'render-staging');
    mkdirSync(ingress, { recursive: true });
    return assertPathWithinRealRoot(getOutputDir(workspace.rootPath, outputId), ingress);
  }

  async assertReleaseKitSocialVariantAllowed(
    campaignWorkspaceId: string,
    item: ReleaseKitItem,
    destination: { platform: string; profileId: string; accountSetId?: string },
  ): Promise<{ sourceWorkspaceId: string; outputId: string; variantId: string } | null> {
    if (item.source.type !== 'output' || !item.source.assetId) return null;
    const sourceAssetId = item.source.assetId;
    const sourceWorkspaceId = item.source.sourceWorkspaceId?.trim() || campaignWorkspaceId;
    const sourceWorkspace = this.requireWorkspace(sourceWorkspaceId);
    const output = readOutput(sourceWorkspace.rootPath, item.source.outputId);
    if (!output?.socialVariantSet) return null;
    const variant = output.socialVariantSet.variants.find((candidate) => candidate.assetId === sourceAssetId);
    if (!variant || variant.state !== 'ready' || !variant.sha256 || !variant.renderEvidence) {
      throw new Error('This social variant is missing current host-verified render evidence. Revise it before posting.');
    }
    const asset = output.assets.find((candidate) => candidate.id === variant.assetId);
    if (!asset?.sha256 || asset.sha256.toLowerCase() !== variant.sha256.toLowerCase() || item.sha256.toLowerCase() !== variant.sha256.toLowerCase()) {
      throw new Error('This social variant no longer matches its reviewed render.');
    }
    const source = output.socialVariantSet.sources.find((candidate) => candidate.id === variant.sourceId);
    if (!source) throw new Error('This social variant has lost its pinned source.');
    await this.assertPinnedSourceCurrent(sourceWorkspace, source);
    if (item.socialVariantIntent && (
      item.socialVariantIntent.variantId !== variant.id
      || !sameDestination(item.socialVariantIntent.destination, variant.destination)
    )) {
      throw new Error('This Release Kit snapshot no longer matches its saved social destination intent.');
    }
    if (!variant.destination.profileId) throw new Error('This variant is not bound to an exact connected account. Revise it before posting.');
    if (variant.destination.platform !== destination.platform || variant.destination.profileId !== destination.profileId) {
      throw new Error(`This variant is approved only for ${variant.destination.labelSnapshot ?? `${variant.destination.platform}/${variant.destination.profileId}`}.`);
    }
    if ((variant.destination.accountSetId ?? '') !== (destination.accountSetId ?? '')) {
      throw new Error('This variant is approved for a different connected account set.');
    }
    if (variant.destination.mode === 'trial') {
      throw new Error('Instagram Trial publishing is not supported yet. Artist OS will not post this as a normal Reel.');
    }
    return { sourceWorkspaceId, outputId: output.id, variantId: variant.id };
  }

  linkScheduledUse(
    binding: { sourceWorkspaceId: string; outputId: string; variantId: string },
    releaseKitItemId: string,
    orderId: string,
  ): void {
    const workspace = this.requireWorkspace(binding.sourceWorkspaceId);
    withOutputBundleLock(workspace.rootPath, binding.outputId, () => {
      const output = readOutput(workspace.rootPath, binding.outputId);
      const set = output?.socialVariantSet;
      if (!output || !set) throw new Error('Social Variant Set disappeared while linking its scheduled use.');
      const index = set.variants.findIndex((candidate) => candidate.id === binding.variantId);
      if (index < 0) throw new Error('Social variant disappeared while linking its scheduled use.');
      const selected = set.variants[index]!;
      if (selected.releaseKitItemId === releaseKitItemId && selected.scheduledWorkOrderIds.includes(orderId)) return;
      const variants = [...set.variants];
      variants[index] = {
        ...selected,
        releaseKitItemId,
        scheduledWorkOrderIds: [...new Set([...selected.scheduledWorkOrderIds, orderId])],
      };
      const now = this.nextTimestamp(set.updatedAt);
      const nextSet = advanceSocialVariantSetRevision(set, {
        status: set.status,
        variants,
        ...(set.attention ? { attention: set.attention } : {}),
      }, now);
      writeOutputManifest(workspace.rootPath, { ...output, socialVariantSet: nextSet, updatedAt: now });
    });
    this.deps.emitOutputsUpdated?.(workspace.id);
  }

  async recordResult(
    workspaceId: string,
    editorSessionId: string,
    activeAgentSlug: string | undefined,
    input: RecordSocialVariantResultRequest,
  ): Promise<OutputManifest> {
    const workspace = this.requireWorkspace(workspaceId);
    this.assertEditorIdentity(editorSessionId, activeAgentSlug);
    this.assertResultShape(input);
    const updated = await withOutputBundleLockAsync(workspace.rootPath, input.outputId, async () => {
      const current = readOutput(workspace.rootPath, input.outputId);
      if (!current?.socialVariantSet) throw new Error(`Social Variant Set not found: ${input.outputId}`);
      const currentSet = current.socialVariantSet;
      if (current.workspaceId !== workspaceId || currentSet.workspaceId !== workspaceId) {
        throw new Error(`Social Variant Set is not in workspace "${workspaceId}".`);
      }
      if (currentSet.editorSessionId !== editorSessionId) {
        throw new Error('This Variant Set belongs to a different Raw Video Editor session.');
      }
      assertSocialVariantSetRevision(currentSet, input.expectedRevision);
      if (!['analyzing', 'rendering', 'partially-ready', 'needs-attention', 'archived'].includes(currentSet.status)
        || (currentSet.status === 'archived' && !input.replaceVariantId)) {
        throw new Error(`Social Variant Set cannot accept render results from ${currentSet.status}.`);
      }
      const source = currentSet.sources.find((candidate) => candidate.id === input.sourceId);
      if (!source) throw new Error(`Pinned source not found in this Variant Set: ${input.sourceId}`);
      const destination = currentSet.request.destinationIntents[input.destinationIndex];
      if (!destination) throw new Error(`Destination index is outside this Variant Set: ${input.destinationIndex}`);

      const replacementIndex = input.replaceVariantId
        ? currentSet.variants.findIndex((candidate) => candidate.id === input.replaceVariantId)
        : -1;
      if (input.replaceVariantId && replacementIndex < 0) throw new Error(`Variant to retry was not found: ${input.replaceVariantId}`);
      if (replacementIndex >= 0 && !['failed', 'archived'].includes(currentSet.variants[replacementIndex]!.state)) {
        throw new Error('Only a failed variant or a user-archived revision can be replaced.');
      }
      if (replacementIndex >= 0 && currentSet.variants[replacementIndex]!.state === 'archived') {
        const archived = currentSet.variants[replacementIndex]!;
        if (archived.sourceId !== source.id || !sameDestination(archived.destination, destination)) {
          throw new Error('A revision must keep the exact source and destination of the version the user selected.');
        }
        if (input.failureReason) {
          const now = this.nextTimestamp(currentSet.updatedAt);
          const set = advanceSocialVariantSetRevision(currentSet, {
            status: 'needs-attention',
            variants: currentSet.variants,
            attention: {
              code: 'render-failed',
              message: input.failureReason.trim(),
              sourceId: source.id,
              updatedAt: now,
            },
          }, now);
          const next: OutputManifest = {
            ...current,
            summary: `Revision failed: ${input.failureReason.trim()}`,
            updatedAt: now,
            socialVariantSet: set,
          };
          writeOutputManifest(workspace.rootPath, next);
          return next;
        }
      }
      if (replacementIndex < 0 && currentSet.variants.length >= currentSet.request.totalRequested) {
        throw new Error(`This Variant Set already reached its ${currentSet.request.totalRequested}-render ceiling.`);
      }

      const ready = Boolean(input.filePath);
      if (ready) {
        try {
          await this.assertPinnedSourceCurrent(workspace, source);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const now = this.nextTimestamp(currentSet.updatedAt);
          const set = advanceSocialVariantSetRevision(currentSet, {
            status: 'needs-attention',
            variants: currentSet.variants,
            attention: { code: 'source-unavailable', message, sourceId: source.id, updatedAt: now },
          }, now);
          writeOutputManifest(workspace.rootPath, {
            ...current,
            summary: `Needs attention: ${message}`,
            updatedAt: now,
            socialVariantSet: set,
          });
          throw error;
        }
      }
      const replacedVariant = replacementIndex >= 0 ? currentSet.variants[replacementIndex]! : undefined;
      const variantId = replacedVariant?.state === 'failed' ? replacedVariant.id : randomUUID();
      let asset = undefined as OutputManifest['assets'][number] | undefined;
      let renderEvidence: SocialVariantRecord['renderEvidence'];
      let measuredDurationSeconds: number | undefined;
      let measuredAspectRatio: string | undefined;
      let copiedPath: string | undefined;
      let committed = false;
      try {
        if (input.filePath) {
          const ingressRoot = this.getRenderIngressDir(workspaceId, current.id);
          const sourcePath = this.assertIngressFile(ingressRoot, input.filePath);
          if (!isVideoAsset(sourcePath)) throw new Error('Variant result must be a supported video file.');
          const evidence = await this.readAndValidateRenderEvidence({
            ingressRoot,
            manifestPath: input.manifestPath!,
            manifestVariantId: input.manifestVariantId!,
            filePath: sourcePath,
            pinnedSourceSha256: source.sha256,
            existingVariants: currentSet.variants.filter((candidate) => candidate.id !== replacedVariant?.id),
          });
          const extension = extname(sourcePath).toLowerCase();
          const relativePath = `variants/${variantId}${extension}`;
          const finalPath = join(getOutputDir(workspace.rootPath, current.id), relativePath);
          const tempPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
          mkdirSync(dirname(finalPath), { recursive: true });
          verifiedCopyFileSync(sourcePath, tempPath, { sourceRootPath: realpathSync(ingressRoot), destinationRootPath: getOutputDir(workspace.rootPath, current.id) });
          renameSync(tempPath, finalPath);
          copiedPath = finalPath;
          const fileStat = statSync(finalPath);
          const sha256 = await hashFileSha256(finalPath);
          if (sha256 === source.sha256.toLowerCase()) {
            throw new Error('This render is identical to its source. Create a meaningfully different edit before saving it as a variant.');
          }
          const duplicateVariant = currentSet.variants.find((candidate) => (
            candidate.id !== replacedVariant?.id
            && candidate.state === 'ready'
            && candidate.sha256?.toLowerCase() === sha256
          ));
          if (duplicateVariant) {
            throw new Error(`This render duplicates the saved variant "${duplicateVariant.title}".`);
          }
          asset = {
            id: `social-variant-${variantId}`,
            label: input.title.trim(),
            role: 'supporting',
            path: relativePath,
            mimeType: mimeTypeForVideoPath(finalPath),
            sizeBytes: fileStat.size,
            sha256,
          };
          renderEvidence = evidence.record;
          measuredDurationSeconds = evidence.durationSeconds;
          measuredAspectRatio = evidence.aspectRatio;
        }

        const durationSeconds = input.durationSeconds ?? measuredDurationSeconds;
        const aspectRatio = input.aspectRatio?.trim() || measuredAspectRatio;
        const variant = {
          id: variantId,
          sourceId: source.id,
          title: input.title.trim(),
          hook: input.hook.trim(),
          editorialMode: input.editorialMode.trim(),
          editorialIntent: input.editorialIntent.trim(),
          destination,
          ...(asset ? { assetId: asset.id, sha256: asset.sha256 } : {}),
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          ...(aspectRatio ? { aspectRatio } : {}),
          state: asset ? 'ready' as const : 'failed' as const,
          ...(!asset ? { failureReason: input.failureReason!.trim() } : {}),
          scheduledWorkOrderIds: replacementIndex >= 0
            ? currentSet.variants[replacementIndex]!.scheduledWorkOrderIds
            : [],
          ...(renderEvidence ? { renderEvidence } : {}),
        };
        const variants = [...currentSet.variants];
        if (replacementIndex >= 0) variants[replacementIndex] = variant;
        else variants.push(variant);
        const readyCount = variants.filter((candidate) => candidate.state === 'ready').length;
        const failedCount = variants.filter((candidate) => candidate.state === 'failed').length;
        const complete = variants.length === currentSet.request.totalRequested;
        const preservedSourceAttention = currentSet.attention?.code === 'source-unavailable'
          && currentSet.attention.sourceId !== source.id
          ? currentSet.attention
          : undefined;
        const status = preservedSourceAttention
          ? 'needs-attention' as const
          : complete && readyCount === currentSet.request.totalRequested
            ? 'ready' as const
            : readyCount > 0
              ? 'partially-ready' as const
              : failedCount > 0
                ? 'needs-attention' as const
                : 'rendering' as const;
        const now = this.nextTimestamp(currentSet.updatedAt);
        const set = advanceSocialVariantSetRevision(currentSet, {
          status,
          variants,
          ...(preservedSourceAttention ? { attention: preservedSourceAttention } : status === 'needs-attention' ? {
            attention: {
              code: 'render-failed' as const,
              message: input.failureReason!.trim(),
              sourceId: source.id,
              updatedAt: now,
            },
          } : {}),
        }, now);
        const obsoleteAsset = replacementIndex >= 0 && asset
          ? current.assets.find((candidate) => candidate.id === replacedVariant?.assetId)
          : undefined;
        const assets = replacementIndex >= 0
          ? current.assets.filter((candidate) => candidate.id !== replacedVariant?.assetId && candidate.id !== `social-variant-${variantId}`)
          : [...current.assets];
        if (asset) assets.push(asset);
        const next: OutputManifest = {
          ...current,
          assets,
          summary: `${readyCount} of ${currentSet.request.totalRequested} variants ready${failedCount ? ` · ${failedCount} failed` : ''}.`,
          updatedAt: now,
          socialVariantSet: set,
        };
        writeOutputManifest(workspace.rootPath, next);
        committed = true;
        if (obsoleteAsset) {
          const obsoletePath = resolveOutputAssetPath(workspace.rootPath, current.id, obsoleteAsset.path);
          if (obsoletePath) {
            try { rmSync(obsoletePath, { force: true }); } catch { /* The committed replacement remains authoritative. */ }
          }
        }
        return next;
      } catch (error) {
        if (copiedPath && !committed) rmSync(copiedPath, { force: true });
        throw error;
      }
    });
    this.deps.emitOutputsUpdated?.(workspaceId);
    return updated;
  }

  async archiveVariant(workspaceId: string, input: ArchiveSocialVariantRequest): Promise<OutputManifest> {
    const workspace = this.requireWorkspace(workspaceId);
    const updated = await withOutputBundleLockAsync(workspace.rootPath, input.outputId, async () => {
      const current = readOutput(workspace.rootPath, input.outputId);
      if (!current?.socialVariantSet) throw new Error(`Social Variant Set not found: ${input.outputId}`);
      const currentSet = current.socialVariantSet;
      assertSocialVariantSetRevision(currentSet, input.expectedRevision);
      const index = currentSet.variants.findIndex((variant) => variant.id === input.variantId);
      if (index < 0) throw new Error(`Social variant not found: ${input.variantId}`);
      const selected = currentSet.variants[index]!;
      if (selected.state === 'archived') return current;
      const scheduledUses = this.findScheduledUsesForVariant(workspace, current, selected);
      if (scheduledUses.length > 0) {
        throw new Error('This variant has scheduled work. Open that order before archiving it.');
      }
      const variants = [...currentSet.variants];
      variants[index] = { ...selected, state: 'archived' };
      const active = variants.filter((variant) => variant.state !== 'archived');
      const readyCount = active.filter((variant) => variant.state === 'ready').length;
      const failedCount = active.filter((variant) => variant.state === 'failed').length;
      const status = active.length === 0
        ? 'archived' as const
        : readyCount === active.length && active.length === currentSet.request.totalRequested
          ? 'ready' as const
          : readyCount > 0
            ? 'partially-ready' as const
            : 'needs-attention' as const;
      const now = this.nextTimestamp(currentSet.updatedAt);
      const set = advanceSocialVariantSetRevision(currentSet, {
        status,
        variants,
        ...(status === 'needs-attention' ? {
          attention: {
            code: 'other' as const,
            message: failedCount > 0 ? 'Only failed variants remain.' : 'No ready variants remain.',
            updatedAt: now,
          },
        } : {}),
      }, now);
      const next: OutputManifest = {
        ...current,
        summary: status === 'archived'
          ? 'All variants archived.'
          : `${readyCount} variants ready${failedCount ? ` · ${failedCount} failed` : ''}.`,
        updatedAt: now,
        socialVariantSet: set,
      };
      writeOutputManifest(workspace.rootPath, next);
      return next;
    });
    this.deps.emitOutputsUpdated?.(workspaceId);
    return updated;
  }

  async rebindEditor(workspaceId: string, input: RebindSocialVariantSetRequest): Promise<OutputManifest> {
    const workspace = this.requireWorkspace(workspaceId);
    if (!input.editorSessionId?.trim()) throw new Error('A replacement Raw Video Editor session is required.');
    const updated = await withOutputBundleLockAsync(workspace.rootPath, input.outputId, async () => {
      const current = readOutput(workspace.rootPath, input.outputId);
      if (!current?.socialVariantSet) throw new Error(`Social Variant Set not found: ${input.outputId}`);
      if (current.workspaceId !== workspaceId) throw new Error(`Output "${input.outputId}" is not in workspace "${workspaceId}".`);
      assertSocialVariantSetRevision(current.socialVariantSet, input.expectedRevision);
      if (!new Set(['queued', 'analyzing', 'rendering', 'partially-ready', 'needs-attention']).has(current.socialVariantSet.status)) {
        throw new Error(`A ${current.socialVariantSet.status} Variant Set cannot be continued.`);
      }
      const now = this.nextTimestamp(current.socialVariantSet.updatedAt);
      const set = {
        ...current.socialVariantSet,
        revision: current.socialVariantSet.revision + 1,
        editorSessionId: input.editorSessionId.trim(),
        updatedAt: now,
      };
      assertSocialVariantSetManifest(set);
      const next: OutputManifest = {
        ...current,
        origin: { ...current.origin, source: 'session', sessionId: set.editorSessionId, agentSlug: 'raw-video-editor' },
        updatedAt: now,
        socialVariantSet: set,
      };
      writeOutputManifest(workspace.rootPath, next);
      return next;
    });
    this.deps.emitOutputsUpdated?.(workspaceId);
    return updated;
  }

  async listUsable(workspaceId: string, input: ListUsableSocialVariantsRequest): Promise<UsableSocialVariant[]> {
    const workspace = this.requireWorkspace(workspaceId);
    if (workspace.artistWorkspaceScope !== 'campaign' || input.campaignId !== workspaceId) {
      throw new Error('Usable social variants must be queried from their exact Campaign workspace.');
    }
    if (!input.profileId?.trim()) throw new Error('An exact connected social profile is required.');
    if (!this.deps.validateSocialProfile) throw new Error('Social profile validation is unavailable on this host.');
    const profile = await this.deps.validateSocialProfile({ platform: input.platform, profileId: input.profileId.trim() });
    if (!profile.ready) throw new Error(profile.reason ?? 'Social profile is not ready.');

    const releaseKit = loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id);
    const scheduled = parseScheduledWorkDocResult(
      loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspace.id,
    );
    if (!scheduled.ok) throw new Error(`Scheduled Work is invalid: ${scheduled.error}`);
    const requireUnscheduled = input.unscheduledOnly !== false;
    const usable: UsableSocialVariant[] = [];

    for (const output of listOutputManifests(workspace.rootPath)) {
      const set = output.socialVariantSet;
      if (!set || set.scope !== 'campaign' || set.campaignId !== input.campaignId) continue;

      for (const variant of set.variants) {
        if (variant.state !== 'ready' || !variant.assetId || !variant.sha256 || !variant.renderEvidence) continue;
        const source = set.sources.find((candidate) => candidate.id === variant.sourceId);
        if (!source) continue;
        try {
          await this.assertPinnedSourceCurrent(workspace, source);
        } catch {
          continue;
        }
        const variantSha256 = variant.sha256.toLowerCase();
        if (variant.destination.platform !== input.platform || variant.destination.accountRole !== input.accountRole) continue;
        if (variant.destination.profileId !== input.profileId.trim()) continue;
        if (variant.destination.mode !== 'standard') continue;
        const asset = output.assets.find((candidate) => candidate.id === variant.assetId);
        if (!asset || asset.sha256?.toLowerCase() !== variantSha256) continue;
        const assetPath = resolveOutputAssetPath(workspace.rootPath, output.id, asset.path);
        if (!assetPath || !existsSync(assetPath) || !statSync(assetPath).isFile() || await hashFileSha256(assetPath) !== variantSha256) continue;

        const snapshot = releaseKit.items.find((item) => (
          item.id === variant.releaseKitItemId
          || (item.source.type === 'output' && item.source.outputId === output.id && item.source.assetId === variant.assetId && item.sha256.toLowerCase() === variantSha256)
        ));
        if (snapshot && (snapshot.status !== 'ready' || hasSocialRestriction(snapshot.usage.restrictions))) continue;
        const uses = snapshot
          ? summarizeReleaseKitItemUses(scheduled.work, snapshot.id).filter((use) => use.platform === input.platform && use.profileId === input.profileId.trim())
          : [];
        const activeUses = uses.filter((use) => use.status !== 'done' && use.status !== 'canceled');
        if (requireUnscheduled && (variant.scheduledWorkOrderIds.length > 0 || activeUses.length > 0 || uses.some((use) => use.status === 'done'))) continue;
        const status: UsableSocialVariant['status'] = uses.some((use) => use.status === 'needs-attention')
          ? 'needs-attention'
          : uses.some((use) => use.status === 'done' && use.receipt)
            ? 'posted'
            : activeUses.length > 0
              ? 'scheduled'
              : 'ready-to-use';
        usable.push({
          outputId: output.id,
          setId: set.id,
          variantId: variant.id,
          assetId: variant.assetId,
          title: variant.title,
          hook: variant.hook,
          editorialMode: variant.editorialMode,
          editorialIntent: variant.editorialIntent,
          sha256: variant.sha256,
          destination: variant.destination,
          releaseKitItemId: snapshot?.id,
          scheduledWorkOrderIds: uses.map((use) => use.orderId),
          status,
        });
      }
    }
    return usable;
  }

  private requireWorkspace(workspaceId: string): SocialVariantWorkspace {
    const workspace = this.deps.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  private assertEditorIdentity(editorSessionId: string, activeAgentSlug?: string): void {
    if (!editorSessionId.trim()) throw new Error('Raw Video Editor session is required.');
    if (activeAgentSlug !== 'raw-video-editor') throw new Error('Only the Raw Video Editor can update a Social Variant Set.');
  }

  private assertResultShape(input: RecordSocialVariantResultRequest): void {
    if (!input.outputId?.trim() || !input.sourceId?.trim()) throw new Error('Variant Set and pinned source IDs are required.');
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error('A valid expected revision is required.');
    if (!Number.isInteger(input.destinationIndex) || input.destinationIndex < 0) throw new Error('A valid destination index is required.');
    for (const [label, value, max] of [
      ['title', input.title, 240],
      ['hook', input.hook, 500],
      ['editorialMode', input.editorialMode, 120],
      ['editorialIntent', input.editorialIntent, 1_200],
    ] as const) {
      if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label} is invalid.`);
    }
    const hasFile = typeof input.filePath === 'string' && input.filePath.trim().length > 0;
    const hasFailure = typeof input.failureReason === 'string' && input.failureReason.trim().length > 0;
    if (hasFile === hasFailure) throw new Error('Record exactly one result: a rendered file or a failure reason.');
    if (input.failureReason && input.failureReason.length > 1_000) throw new Error('failureReason is too long.');
    if (hasFile && (!input.manifestPath?.trim() || !input.manifestVariantId?.trim())) {
      throw new Error('Ready variants require the repurpose manifest path and exact manifest variant id.');
    }
    if (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0)) throw new Error('durationSeconds must be positive.');
    if (input.aspectRatio !== undefined && (!input.aspectRatio.trim() || input.aspectRatio.length > 32)) throw new Error('aspectRatio is invalid.');
  }

  private findScheduledUsesForVariant(
    workspace: SocialVariantWorkspace,
    output: OutputManifest,
    variant: SocialVariantRecord,
  ): string[] {
    if (workspace.artistWorkspaceScope !== 'campaign' || !variant.assetId || !variant.sha256) return [];
    const releaseKit = loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id);
    const snapshot = releaseKit.items.find((item) => item.source.type === 'output'
      && item.source.outputId === output.id
      && item.source.assetId === variant.assetId
      && (item.source.sourceWorkspaceId ?? workspace.id) === workspace.id
      && item.sha256.toLowerCase() === variant.sha256!.toLowerCase());
    if (!snapshot) return [];
    const scheduled = parseScheduledWorkDocResult(
      loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspace.id,
    );
    if (!scheduled.ok) throw new Error(`Cannot archive while Scheduled Work is invalid: ${scheduled.error}`);
    return summarizeReleaseKitItemUses(scheduled.work, snapshot.id)
      .filter((use) => use.status !== 'done' && use.status !== 'canceled')
      .map((use) => use.orderId);
  }

  private assertIngressFile(ingressRootPath: string, requestedPath: string): string {
    const root = realpathSync(resolve(ingressRootPath));
    const path = realpathSync(resolve(requestedPath));
    const relation = relative(root, path);
    if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      throw new Error('Variant result must come from this Variant Set render-staging directory.');
    }
    if (!statSync(path).isFile()) throw new Error('Variant result is not a file.');
    return path;
  }

  private async readAndValidateRenderEvidence(input: {
    ingressRoot: string;
    manifestPath: string;
    manifestVariantId: string;
    filePath: string;
    pinnedSourceSha256: string;
    existingVariants: SocialVariantRecord[];
  }): Promise<{ record: NonNullable<SocialVariantRecord['renderEvidence']>; durationSeconds?: number; aspectRatio?: string }> {
    const manifestPath = this.assertIngressFile(input.ingressRoot, input.manifestPath);
    if (manifestPath !== realpathSync(resolve(input.ingressRoot, 'variant-manifest.json'))) {
      throw new Error('Render evidence must be this Variant Set\'s variant-manifest.json.');
    }
    const body = readFileSync(manifestPath, 'utf8');
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new Error('Repurpose render manifest is invalid JSON.'); }
    if (!isRecord(parsed) || !isRecord(parsed.source) || !isRecord(parsed.validation) || !Array.isArray(parsed.variants)) {
      throw new Error('Repurpose render manifest is malformed.');
    }
    if (parsed.source.sha256 !== input.pinnedSourceSha256.toLowerCase()) throw new Error('Repurpose manifest does not match the pinned source.');
    const sourceDuration = Number(parsed.source.durationSeconds);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Repurpose manifest is missing source duration evidence.');
    if (!['ready', 'ready-with-warnings'].includes(String(parsed.validation.status))) throw new Error('Repurpose timeline gate did not approve this render.');
    const entry = parsed.variants.find((candidate) => isRecord(candidate) && candidate.id === input.manifestVariantId);
    if (!isRecord(entry) || entry.renderStatus !== 'ready' || entry.meaningfulDifference !== 'meaningfully-different' || entry.assessmentBasis !== 'local-editorial-timeline-gate') {
      throw new Error('Repurpose manifest does not contain an approved ready entry for this variant.');
    }
    if (!isRecord(entry.output) || typeof entry.output.path !== 'string' || realpathSync(resolve(entry.output.path)) !== input.filePath) {
      throw new Error('Repurpose manifest output does not match the submitted file.');
    }
    const outputSha256 = await hashFileSha256(input.filePath);
    if (entry.output.sha256 !== outputSha256) throw new Error('Repurpose manifest output hash does not match the submitted file.');
    const segments = normalizeEvidenceSegments(entry.sourceSegments, sourceDuration);
    if (!isMeaningfullyDifferentTimeline(segments, sourceDuration)) {
      throw new Error('Repurpose evidence describes a cosmetic or near-full-source edit.');
    }
    for (const existing of input.existingVariants) {
      if (existing.state !== 'ready' || !existing.renderEvidence) continue;
      if (timelinesEffectivelyDuplicate(segments, existing.renderEvidence.sourceSegments)) {
        throw new Error(`This render is editorially too close to the saved variant "${existing.title}".`);
      }
    }
    return {
      record: {
        manifestSha256: createHash('sha256').update(body).digest('hex'),
        sourceSha256: input.pinnedSourceSha256.toLowerCase(),
        sourceDurationSeconds: sourceDuration,
        sourceSegments: segments,
        meaningfulDifference: 'meaningfully-different',
        assessmentBasis: 'local-editorial-timeline-gate',
      },
      ...(typeof entry.output.duration === 'number' ? { durationSeconds: entry.output.duration } : {}),
      ...(typeof entry.output.width === 'number' && typeof entry.output.height === 'number' ? { aspectRatio: `${entry.output.width}:${entry.output.height}` } : {}),
    };
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

function mimeTypeForVideoPath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.webm') return 'video/webm';
  return 'video/mp4';
}

function sameDestination(left: SocialVariantDestinationIntent, right: SocialVariantDestinationIntent): boolean {
  return left.platform === right.platform
    && left.accountRole === right.accountRole
    && left.profileId === right.profileId
    && left.accountSetId === right.accountSetId
    && left.mode === right.mode
    && left.trialRequested === right.trialRequested;
}

function hasSocialRestriction(restrictions: { blockedFromUse: boolean; needsRightsClearance: boolean; artistLikenessRestricted: boolean }): boolean {
  return restrictions.blockedFromUse || restrictions.needsRightsClearance || restrictions.artistLikenessRestricted;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEvidenceSegments(value: unknown, sourceDurationSeconds: number): Array<{ start: number; end: number }> {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Repurpose manifest has no source-segment evidence.');
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('Repurpose manifest contains malformed source-segment evidence.');
    const start = Number(candidate.start);
    const end = Number(candidate.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > sourceDurationSeconds + 0.05) {
      throw new Error('Repurpose manifest contains invalid source-segment evidence.');
    }
    return { start, end };
  });
}

function isMeaningfullyDifferentTimeline(segments: Array<{ start: number; end: number }>, sourceDurationSeconds: number): boolean {
  const selectedSeconds = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const materiallyShorter = selectedSeconds <= sourceDurationSeconds * 0.85;
  const reordered = segments.some((segment, index) => index > 0 && segment.start < segments[index - 1]!.start);
  return materiallyShorter || reordered;
}

function timelineOverlapRatio(left: Array<{ start: number; end: number }>, right: Array<{ start: number; end: number }>): number {
  const overlap = left.reduce((total, a) => total + right.reduce((sum, b) => sum + Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)), 0), 0);
  const shorter = Math.min(
    left.reduce((sum, segment) => sum + segment.end - segment.start, 0),
    right.reduce((sum, segment) => sum + segment.end - segment.start, 0),
  );
  return shorter > 0 ? Math.min(1, overlap / shorter) : 0;
}

function timelinesEffectivelyDuplicate(left: Array<{ start: number; end: number }>, right: Array<{ start: number; end: number }>): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const sameOpening = Math.abs(left[0]!.start - right[0]!.start) < 1.5;
  return sameOpening && timelineOverlapRatio(left, right) > 0.9;
}
