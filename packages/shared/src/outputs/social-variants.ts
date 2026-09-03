export const SOCIAL_VARIANT_SET_TAG = 'social-variant-set';
export const SOCIAL_VARIANT_MAX_SOURCES = 5;
export const SOCIAL_VARIANT_MAX_PER_SOURCE = 5;
export const SOCIAL_VARIANT_MAX_TOTAL = 12;

export type SocialVariantPlatform = 'instagram' | 'tiktok' | 'x' | 'youtube';
export type SocialAccountRole = 'primary' | 'secondary' | 'fan-page';
export type SocialVariantMode = 'standard' | 'trial';
export type SocialVariantSetStatus =
  | 'queued'
  | 'analyzing'
  | 'rendering'
  | 'review'
  | 'partially-ready'
  | 'ready'
  | 'needs-attention'
  | 'archived';
export type SocialVariantState = 'planned' | 'rendering' | 'ready' | 'failed' | 'archived';
export type SocialVariantSourceOrigin = 'release-kit' | 'campaign-asset' | 'output' | 'vault';
export type SocialVariantRightsBasis = 'owned' | 'licensed' | 'authorized';

export interface SocialVariantSource {
  id: string;
  origin: SocialVariantSourceOrigin;
  sourceId: string;
  assetId?: string;
  title: string;
  sha256: string;
  rightsBasis: SocialVariantRightsBasis;
}

export interface SocialVariantDestinationIntent {
  platform: SocialVariantPlatform;
  accountRole: SocialAccountRole;
  profileId?: string;
  accountSetId?: string;
  labelSnapshot?: string;
  mode: SocialVariantMode;
  trialRequested?: true;
}

export interface SocialVariantRecord {
  id: string;
  sourceId: string;
  title: string;
  hook: string;
  editorialMode: string;
  editorialIntent: string;
  destination: SocialVariantDestinationIntent;
  assetId?: string;
  sha256?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  state: SocialVariantState;
  failureReason?: string;
  releaseKitItemId?: string;
  scheduledWorkOrderIds: string[];
}

export interface SocialVariantSetManifest {
  schemaVersion: 1;
  revision: number;
  id: string;
  workspaceId: string;
  scope: 'hq' | 'campaign';
  campaignId?: string;
  status: SocialVariantSetStatus;
  attention?: {
    code: 'source-unavailable' | 'render-failed' | 'account-unavailable' | 'other';
    message: string;
    sourceId?: string;
    updatedAt: string;
  };
  editorSessionId: string;
  sources: SocialVariantSource[];
  request: {
    variantsPerSource: number;
    totalRequested: number;
    destinationIntents: SocialVariantDestinationIntent[];
    direction?: string;
    requestedAt: string;
    requestedBy: { type: 'user'; clientId: string };
  };
  variants: SocialVariantRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface SocialVariantSetSummary {
  id: string;
  status: SocialVariantSetStatus;
  scope: SocialVariantSetManifest['scope'];
  campaignId?: string;
  sourceCount: number;
  variantCount: number;
  readyCount: number;
  failedCount: number;
  updatedAt: string;
}

export type SocialVariantSourceSelection =
  | { origin: 'release-kit'; sourceId: string }
  | { origin: 'vault'; sourceId: string }
  | { origin: 'output'; sourceId: string; assetId?: string };

export interface CreateSocialVariantSetRequest {
  editorSessionId: string;
  sourceSelections: SocialVariantSourceSelection[];
  destinationIntents: SocialVariantDestinationIntent[];
  variantsPerSource: number;
  direction?: string;
  title?: string;
}

export interface StartSocialVariantSetRequest {
  outputId: string;
  expectedRevision: number;
}

export interface RecordSocialVariantResultRequest {
  outputId: string;
  expectedRevision: number;
  sourceId: string;
  destinationIndex: number;
  title: string;
  hook: string;
  editorialMode: string;
  editorialIntent: string;
  filePath?: string;
  failureReason?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  replaceVariantId?: string;
}

export interface ArchiveSocialVariantRequest {
  outputId: string;
  expectedRevision: number;
  variantId: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SET_STATUSES = new Set<SocialVariantSetStatus>([
  'queued',
  'analyzing',
  'rendering',
  'review',
  'partially-ready',
  'ready',
  'needs-attention',
  'archived',
]);
const VARIANT_STATES = new Set<SocialVariantState>(['planned', 'rendering', 'ready', 'failed', 'archived']);
const SOURCE_ORIGINS = new Set<SocialVariantSourceOrigin>(['release-kit', 'campaign-asset', 'output', 'vault']);
const RIGHTS_BASES = new Set<SocialVariantRightsBasis>(['owned', 'licensed', 'authorized']);
const PLATFORMS = new Set<SocialVariantPlatform>(['instagram', 'tiktok', 'x', 'youtube']);
const ACCOUNT_ROLES = new Set<SocialAccountRole>(['primary', 'secondary', 'fan-page']);
const MODES = new Set<SocialVariantMode>(['standard', 'trial']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isBoundedString(value: unknown, max: number, optional = false): value is string | undefined {
  if (value === undefined) return optional;
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function isOptionalIdentifier(value: unknown): value is string | undefined {
  return value === undefined || isIdentifier(value);
}

function isOptionalExternalIdentifier(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 256
    && !value.includes('\0')
    && !value.includes('/')
    && !value.includes('\\');
}

function hasUniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function socialVariantDestinationKey(value: SocialVariantDestinationIntent): string {
  return [
    value.platform,
    value.accountRole,
    value.profileId ?? '',
    value.accountSetId ?? '',
    value.mode,
    value.trialRequested === true ? 'trial-requested' : '',
  ].join('\0');
}

function isSocialVariantSource(value: unknown): value is SocialVariantSource {
  if (!isRecord(value)) return false;
  return isIdentifier(value.id)
    && typeof value.origin === 'string'
    && SOURCE_ORIGINS.has(value.origin as SocialVariantSourceOrigin)
    && isIdentifier(value.sourceId)
    && isOptionalIdentifier(value.assetId)
    && isBoundedString(value.title, 240)
    && typeof value.sha256 === 'string'
    && SHA256.test(value.sha256)
    && typeof value.rightsBasis === 'string'
    && RIGHTS_BASES.has(value.rightsBasis as SocialVariantRightsBasis);
}

export function isSocialVariantDestinationIntent(value: unknown): value is SocialVariantDestinationIntent {
  if (!isRecord(value)) return false;
  if (typeof value.platform !== 'string' || !PLATFORMS.has(value.platform as SocialVariantPlatform)) return false;
  if (typeof value.accountRole !== 'string' || !ACCOUNT_ROLES.has(value.accountRole as SocialAccountRole)) return false;
  if (!isOptionalExternalIdentifier(value.profileId) || !isOptionalExternalIdentifier(value.accountSetId)) return false;
  if (!isBoundedString(value.labelSnapshot, 160, true)) return false;
  if (typeof value.mode !== 'string' || !MODES.has(value.mode as SocialVariantMode)) return false;
  if (value.trialRequested !== undefined && value.trialRequested !== true) return false;
  if (value.mode === 'trial') return value.platform === 'instagram' && value.trialRequested === true;
  return value.trialRequested === undefined;
}

function isSocialVariantRecord(value: unknown, sourceIds: ReadonlySet<string>, assetIds?: ReadonlySet<string>): value is SocialVariantRecord {
  if (!isRecord(value)) return false;
  if (!isIdentifier(value.id) || !isIdentifier(value.sourceId) || !sourceIds.has(value.sourceId)) return false;
  if (!isBoundedString(value.title, 240) || !isBoundedString(value.hook, 500)) return false;
  if (!isBoundedString(value.editorialMode, 120) || !isBoundedString(value.editorialIntent, 1_200)) return false;
  if (!isSocialVariantDestinationIntent(value.destination)) return false;
  if (!isOptionalIdentifier(value.assetId)) return false;
  if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256))) return false;
  if (value.durationSeconds !== undefined && (typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0)) return false;
  if (!isBoundedString(value.aspectRatio, 32, true)) return false;
  if (typeof value.state !== 'string' || !VARIANT_STATES.has(value.state as SocialVariantState)) return false;
  if (!isBoundedString(value.failureReason, 1_000, true)) return false;
  if (!isOptionalIdentifier(value.releaseKitItemId)) return false;
  if (!Array.isArray(value.scheduledWorkOrderIds) || !value.scheduledWorkOrderIds.every(isIdentifier) || !hasUniqueStrings(value.scheduledWorkOrderIds)) return false;
  if (value.state === 'ready') {
    if (!value.assetId || !value.sha256) return false;
    if (assetIds && !assetIds.has(value.assetId)) return false;
  }
  if (value.state === 'failed' && !value.failureReason) return false;
  if (value.state !== 'failed' && value.failureReason !== undefined) return false;
  return true;
}

export function isSocialVariantSetManifest(value: unknown, assetIds?: ReadonlySet<string>): value is SocialVariantSetManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) return false;
  if (!isIdentifier(value.id) || !isIdentifier(value.workspaceId)) return false;
  if (value.scope !== 'hq' && value.scope !== 'campaign') return false;
  if (!isOptionalIdentifier(value.campaignId)) return false;
  if (value.scope === 'campaign' && !value.campaignId) return false;
  if (value.scope === 'hq' && value.campaignId !== undefined) return false;
  if (typeof value.status !== 'string' || !SET_STATUSES.has(value.status as SocialVariantSetStatus)) return false;
  if (value.attention !== undefined) {
    if (!isRecord(value.attention)) return false;
    if (!['source-unavailable', 'render-failed', 'account-unavailable', 'other'].includes(String(value.attention.code))) return false;
    if (!isBoundedString(value.attention.message, 1_000)) return false;
    if (!isOptionalIdentifier(value.attention.sourceId) || !isIsoDateString(value.attention.updatedAt)) return false;
  }
  if (value.status === 'needs-attention' && value.attention === undefined) return false;
  if (value.status !== 'needs-attention' && value.attention !== undefined) return false;
  if (!isIdentifier(value.editorSessionId)) return false;
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > SOCIAL_VARIANT_MAX_SOURCES) return false;
  if (!value.sources.every(isSocialVariantSource)) return false;
  const sourceIds = value.sources.map((source) => source.id);
  if (!hasUniqueStrings(sourceIds)) return false;
  const attentionSourceId = value.attention?.sourceId;
  if (attentionSourceId !== undefined && (typeof attentionSourceId !== 'string' || !sourceIds.includes(attentionSourceId))) return false;
  const sourceLineageKeys = value.sources.map((source) => `${source.sourceId}\0${source.sha256.toLowerCase()}`);
  if (!hasUniqueStrings(sourceLineageKeys)) return false;

  if (!isRecord(value.request)) return false;
  if (!Number.isInteger(value.request.variantsPerSource) || (value.request.variantsPerSource as number) < 1 || (value.request.variantsPerSource as number) > SOCIAL_VARIANT_MAX_PER_SOURCE) return false;
  const expectedTotal = value.sources.length * (value.request.variantsPerSource as number);
  if (!Number.isInteger(value.request.totalRequested) || value.request.totalRequested !== expectedTotal || expectedTotal > SOCIAL_VARIANT_MAX_TOTAL) return false;
  if (!Array.isArray(value.request.destinationIntents) || value.request.destinationIntents.length < 1 || value.request.destinationIntents.length > 8) return false;
  if (!value.request.destinationIntents.every(isSocialVariantDestinationIntent)) return false;
  const destinationKeys = value.request.destinationIntents.map(socialVariantDestinationKey);
  if (!hasUniqueStrings(destinationKeys)) return false;
  if (!isBoundedString(value.request.direction, 4_000, true)) return false;
  if (!isIsoDateString(value.request.requestedAt)) return false;
  if (!isRecord(value.request.requestedBy) || value.request.requestedBy.type !== 'user' || !isIdentifier(value.request.requestedBy.clientId)) return false;

  if (!Array.isArray(value.variants) || value.variants.length > value.request.totalRequested) return false;
  const sourceIdSet = new Set(sourceIds);
  if (!value.variants.every((variant) => isSocialVariantRecord(variant, sourceIdSet, assetIds))) return false;
  const destinationKeySet = new Set(destinationKeys);
  if (!value.variants.every((variant) => destinationKeySet.has(socialVariantDestinationKey(variant.destination)))) return false;
  const variantIds = value.variants.map((variant) => variant.id);
  if (!hasUniqueStrings(variantIds)) return false;
  const perSourceLimit = value.request.variantsPerSource as number;
  const perSourceCounts = new Map<string, number>();
  for (const variant of value.variants) {
    const nextCount = (perSourceCounts.get(variant.sourceId) ?? 0) + 1;
    if (nextCount > perSourceLimit) return false;
    perSourceCounts.set(variant.sourceId, nextCount);
  }

  const readyCount = value.variants.filter((variant) => variant.state === 'ready').length;
  const hasIncompleteVariant = value.variants.length < value.request.totalRequested
    || value.variants.some((variant) => variant.state !== 'ready');
  if (value.status === 'ready' && (readyCount !== value.request.totalRequested || hasIncompleteVariant)) return false;
  if (value.status === 'partially-ready' && (readyCount === 0 || !hasIncompleteVariant)) return false;
  if (value.status === 'review' && readyCount === 0) return false;
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) return false;
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) return false;
  return true;
}

export function assertSocialVariantSetManifest(value: unknown, assetIds?: ReadonlySet<string>): asserts value is SocialVariantSetManifest {
  if (!isSocialVariantSetManifest(value, assetIds)) throw new Error('Invalid social variant set manifest.');
}

export function assertSocialVariantSetRevision(current: SocialVariantSetManifest, expectedRevision: number): void {
  if (current.revision !== expectedRevision) {
    throw new Error(`Social variant set changed. Expected revision ${expectedRevision}, found ${current.revision}.`);
  }
}

export function advanceSocialVariantSetRevision(
  current: SocialVariantSetManifest,
  patch: Pick<SocialVariantSetManifest, 'status' | 'variants'> & Pick<Partial<SocialVariantSetManifest>, 'attention'>,
  now = new Date().toISOString(),
): SocialVariantSetManifest {
  if (!isIsoDateString(now) || Date.parse(now) <= Date.parse(current.updatedAt)) {
    throw new Error('Social variant set updates must advance updatedAt.');
  }
  const next: SocialVariantSetManifest = {
    ...current,
    status: patch.status,
    variants: patch.variants,
    attention: patch.attention,
    schemaVersion: 1,
    revision: current.revision + 1,
    id: current.id,
    workspaceId: current.workspaceId,
    createdAt: current.createdAt,
    updatedAt: now,
  };
  assertSocialVariantSetManifest(next);
  return next;
}

export function toSocialVariantSetSummary(value: SocialVariantSetManifest): SocialVariantSetSummary {
  return {
    id: value.id,
    status: value.status,
    scope: value.scope,
    campaignId: value.campaignId,
    sourceCount: value.sources.length,
    variantCount: value.variants.length,
    readyCount: value.variants.filter((variant) => variant.state === 'ready').length,
    failedCount: value.variants.filter((variant) => variant.state === 'failed').length,
    updatedAt: value.updatedAt,
  };
}
