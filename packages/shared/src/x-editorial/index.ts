export const X_EDITORIAL_SLATE_TAG = 'artist-x-slate';
export const X_STANDARD_POST_MAX_CHARACTERS = 280;
export const X_EDITORIAL_SLATE_STALE_AFTER_MS = 48 * 60 * 60 * 1_000;

export type XEditorialCampaignWeight = 'none' | 'light' | 'focus';
export type XEditorialLane = 'worldview' | 'campaign-adjacent' | 'direct-release';
export type XEditorialFormat = 'post' | 'thread';
export type XEditorialResearchBasis = 'artist-truth' | 'cited-research' | 'mixed';
export type XEditorialTimingBasis =
  | 'account-analytics'
  | 'known-audience'
  | 'campaign-constraint'
  | 'editorial-default';
export type XEditorialCandidateStatus =
  | 'proposed'
  | 'approved'
  | 'skipped'
  | 'scheduled'
  | 'posted'
  | 'needs-attention';

export interface XEditorialProfile {
  platform: 'x';
  /** Empty only while the slate is a draft awaiting account setup. */
  profileId: string;
}

export interface XEditorialContext {
  scope: 'hq';
  campaignId: string | null;
  campaignName: string | null;
  campaignWeight: XEditorialCampaignWeight;
}

export interface XEditorialResearchSource {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  claim: string;
}

export interface XEditorialResearch {
  summary: string;
  researchedAt: string | null;
  sources: XEditorialResearchSource[];
}

export interface XEditorialReleaseKitAsset {
  kind: 'release-kit';
  campaignId: string;
  itemId: string;
  sha256: string;
  label: string;
}

export interface XEditorialCandidate {
  id: string;
  revision: number;
  lane: XEditorialLane;
  format: XEditorialFormat;
  text: string;
  thread: string[] | null;
  rationale: string;
  researchBasis: XEditorialResearchBasis;
  sourceIds: string[];
  campaignId: string | null;
  scheduledFor: string | null;
  timingBasis: XEditorialTimingBasis;
  asset: XEditorialReleaseKitAsset | null;
  status: XEditorialCandidateStatus;
  /** Host-owned after a candidate is scheduled. Agent output must omit it. */
  scheduledWorkId?: string;
  /** Host-owned after a candidate is scheduled. Agent output must omit it. */
  calendarItemId?: string;
  /** Host-owned verified publication receipt. Agent output must omit it. */
  receipt?: {
    id: string;
    externalUrl?: string;
    summary: string;
    completedAt: string;
  };
  /** Host-owned actionable failure copied from Scheduled Work. */
  attentionMessage?: string;
}

export interface XEditorialSlate {
  schemaVersion: 1;
  slateId: string;
  title: string;
  createdAt: string;
  timezone: string;
  profile: XEditorialProfile;
  context: XEditorialContext;
  research: XEditorialResearch;
  candidates: XEditorialCandidate[];
}

export type MutateXEditorialCandidateInput = {
  outputId: string;
  expectedOutputUpdatedAt: string;
  candidateId: string;
  expectedRevision: number;
} & (
  | { action: 'approve' }
  | { action: 'skip' }
  | { action: 'edit'; text: string; scheduledFor: string | null }
);

export interface MutateXEditorialCandidateResult {
  slate: XEditorialSlate;
  outputUpdatedAt: string;
  scheduledWorkId?: string;
  calendarItemId?: string;
}

export type XEditorialSlateParseResult =
  | { ok: true; slate: XEditorialSlate }
  | { ok: false; error: string };

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LANES = new Set<XEditorialLane>(['worldview', 'campaign-adjacent', 'direct-release']);
const FORMATS = new Set<XEditorialFormat>(['post', 'thread']);
const RESEARCH_BASES = new Set<XEditorialResearchBasis>(['artist-truth', 'cited-research', 'mixed']);
const TIMING_BASES = new Set<XEditorialTimingBasis>([
  'account-analytics',
  'known-audience',
  'campaign-constraint',
  'editorial-default',
]);
const STATUSES = new Set<XEditorialCandidateStatus>([
  'proposed',
  'approved',
  'skipped',
  'scheduled',
  'posted',
  'needs-attention',
]);
const CAMPAIGN_WEIGHTS = new Set<XEditorialCampaignWeight>(['none', 'light', 'focus']);

export function parseXEditorialSlate(input: unknown): XEditorialSlateParseResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: 'Daily X Slate content is not valid JSON.' };
    }
  }
  if (!isRecord(value)) return { ok: false, error: 'Daily X Slate must be a JSON object.' };

  try {
    const schemaVersion = requiredInteger(value.schemaVersion, 'schemaVersion');
    if (schemaVersion !== 1) throw new Error(`Unsupported Daily X Slate schema version: ${schemaVersion}`);

    const slateId = requiredId(value.slateId, 'slateId');
    const title = requiredString(value.title, 'title', 200);
    const createdAt = requiredIso(value.createdAt, 'createdAt');
    const timezone = requiredTimezone(value.timezone, 'timezone');
    const profile = parseProfile(value.profile);
    const context = parseContext(value.context);
    const research = parseResearch(value.research);
    const candidatesRaw = requiredArray(value.candidates, 'candidates', 20);
    if (candidatesRaw.length === 0) throw new Error('candidates must contain at least one post.');
    const candidates = candidatesRaw.map((candidate, index) => parseCandidate(candidate, index));

    assertUnique(candidates.map((candidate) => candidate.id), 'candidate id');
    const sourceIds = new Set(research.sources.map((source) => source.id));
    for (const candidate of candidates) {
      for (const sourceId of candidate.sourceIds) {
        if (!sourceIds.has(sourceId)) throw new Error(`Candidate ${candidate.id} references missing research source ${sourceId}.`);
      }
      if (candidate.lane !== 'worldview' && !candidate.campaignId) {
        throw new Error(`Candidate ${candidate.id} requires a campaignId for lane ${candidate.lane}.`);
      }
      if (candidate.campaignId && context.campaignId && candidate.campaignId !== context.campaignId) {
        throw new Error(`Candidate ${candidate.id} belongs to a different campaign than the slate.`);
      }
      if (candidate.asset && candidate.asset.campaignId !== candidate.campaignId) {
        throw new Error(`Candidate ${candidate.id} asset does not belong to its campaign.`);
      }
      if (candidate.scheduledWorkId || candidate.calendarItemId) {
        if (!candidate.scheduledWorkId || !candidate.calendarItemId) {
          throw new Error(`Candidate ${candidate.id} must link both Scheduled Work and Calendar.`);
        }
        if (candidate.status !== 'scheduled' && candidate.status !== 'posted' && candidate.status !== 'needs-attention') {
          throw new Error(`Candidate ${candidate.id} has schedule links in an invalid status.`);
        }
      }
      if (candidate.receipt && candidate.status !== 'posted') {
        throw new Error(`Candidate ${candidate.id} has a receipt before verified publication.`);
      }
      if (candidate.status === 'posted' && !candidate.receipt) {
        throw new Error(`Candidate ${candidate.id} is posted without a verified receipt.`);
      }
      if (candidate.attentionMessage && candidate.status !== 'needs-attention') {
        throw new Error(`Candidate ${candidate.id} has an attention message outside needs-attention status.`);
      }
    }

    return {
      ok: true,
      slate: {
        schemaVersion: 1,
        slateId,
        title,
        createdAt,
        timezone,
        profile,
        context,
        research,
        candidates,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function isXEditorialSlateOutput(output: { tags?: string[]; kind?: string }): boolean {
  return output.kind === 'collection' && output.tags?.includes(X_EDITORIAL_SLATE_TAG) === true;
}

/** Counts visible Unicode code points. V1 schedules standard X posts only. */
export function xPostCharacterCount(text: string): number {
  return Array.from(text).length;
}

export function xStandardPostLengthError(text: string): string | null {
  const over = xPostCharacterCount(text) - X_STANDARD_POST_MAX_CHARACTERS;
  return over > 0 ? `Shorten by ${over} character${over === 1 ? '' : 's'}` : null;
}

export function isXEditorialSlateStale(
  slate: Pick<XEditorialSlate, 'createdAt' | 'research'>,
  nowMs = Date.now(),
): boolean {
  const reference = slate.research.researchedAt ?? slate.createdAt;
  const referenceMs = Date.parse(reference);
  return Number.isFinite(referenceMs) && nowMs - referenceMs > X_EDITORIAL_SLATE_STALE_AFTER_MS;
}

/** Stable candidate payload used by the host when minting exact authorization. */
export function xEditorialCandidateAuthorizationPayload(
  slate: XEditorialSlate,
  candidate: XEditorialCandidate,
): Record<string, unknown> {
  return {
    slateId: slate.slateId,
    candidateId: candidate.id,
    revision: candidate.revision,
    platform: slate.profile.platform,
    profileId: slate.profile.profileId,
    text: candidate.text,
    scheduledFor: candidate.scheduledFor,
    timezone: slate.timezone,
    campaignId: candidate.campaignId,
    asset: candidate.asset,
  };
}

export function stableXEditorialStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableXEditorialStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableXEditorialStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseProfile(value: unknown): XEditorialProfile {
  const record = requiredRecord(value, 'profile');
  if (record.platform !== 'x') throw new Error('profile.platform must be x.');
  return { platform: 'x', profileId: optionalString(record.profileId, 'profile.profileId', 128) ?? '' };
}

function parseContext(value: unknown): XEditorialContext {
  const record = requiredRecord(value, 'context');
  if (record.scope !== 'hq') throw new Error('context.scope must be hq.');
  const campaignId = nullableString(record.campaignId, 'context.campaignId', 128);
  const campaignName = nullableString(record.campaignName, 'context.campaignName', 200);
  if (!CAMPAIGN_WEIGHTS.has(record.campaignWeight as XEditorialCampaignWeight)) {
    throw new Error('context.campaignWeight is invalid.');
  }
  if (record.campaignWeight !== 'none' && !campaignId) {
    throw new Error('context.campaignId is required when campaignWeight is light or focus.');
  }
  if (record.campaignWeight === 'none' && campaignId) {
    throw new Error('context.campaignWeight cannot be none when campaignId is present.');
  }
  return {
    scope: 'hq',
    campaignId,
    campaignName,
    campaignWeight: record.campaignWeight as XEditorialCampaignWeight,
  };
}

function parseResearch(value: unknown): XEditorialResearch {
  const record = requiredRecord(value, 'research');
  const sourcesRaw = requiredArray(record.sources, 'research.sources', 50);
  const sources = sourcesRaw.map((source, index) => {
    const item = requiredRecord(source, `research.sources[${index}]`);
    const publishedAt = nullableString(item.publishedAt, `research.sources[${index}].publishedAt`, 32);
    if (publishedAt && !ISO_DATE_PATTERN.test(publishedAt)) {
      throw new Error(`research.sources[${index}].publishedAt must be YYYY-MM-DD or null.`);
    }
    return {
      id: requiredId(item.id, `research.sources[${index}].id`),
      title: requiredString(item.title, `research.sources[${index}].title`, 300),
      url: requiredHttpUrl(item.url, `research.sources[${index}].url`),
      publishedAt,
      claim: requiredString(item.claim, `research.sources[${index}].claim`, 1_000),
    } satisfies XEditorialResearchSource;
  });
  assertUnique(sources.map((source) => source.id), 'research source id');
  return {
    summary: requiredString(record.summary, 'research.summary', 2_000),
    researchedAt: nullableIso(record.researchedAt, 'research.researchedAt'),
    sources,
  };
}

function parseCandidate(value: unknown, index: number): XEditorialCandidate {
  const path = `candidates[${index}]`;
  const record = requiredRecord(value, path);
  const id = requiredId(record.id, `${path}.id`);
  const lane = record.lane as XEditorialLane;
  const format = record.format as XEditorialFormat;
  const status = record.status as XEditorialCandidateStatus;
  const timingBasis = record.timingBasis as XEditorialTimingBasis;
  if (!LANES.has(lane)) throw new Error(`${path}.lane is invalid.`);
  if (!FORMATS.has(format)) throw new Error(`${path}.format is invalid.`);
  if (!STATUSES.has(status)) throw new Error(`${path}.status is invalid.`);
  if (!TIMING_BASES.has(timingBasis)) throw new Error(`${path}.timingBasis is invalid.`);

  const text = requiredString(record.text, `${path}.text`, 5_000);
  const thread = record.thread === null || record.thread === undefined
    ? null
    : requiredArray(record.thread, `${path}.thread`, 25).map((part, partIndex) => (
      requiredString(part, `${path}.thread[${partIndex}]`, 5_000)
    ));
  if (format === 'post' && thread !== null) throw new Error(`${path}.thread must be null for a post.`);
  if (format === 'thread' && (!thread || thread.length < 2 || thread[0] !== text)) {
    throw new Error(`${path}.thread must contain at least two posts and begin with text.`);
  }

  const sourceIds = uniqueStrings(record.sourceIds, `${path}.sourceIds`, 50);
  const researchBasis = record.researchBasis === undefined
    ? sourceIds.length > 0 ? 'cited-research' : 'artist-truth'
    : record.researchBasis as XEditorialResearchBasis;
  if (!RESEARCH_BASES.has(researchBasis)) throw new Error(`${path}.researchBasis is invalid.`);
  if ((researchBasis === 'cited-research' || researchBasis === 'mixed') && sourceIds.length === 0) {
    throw new Error(`${path}.researchBasis ${researchBasis} requires at least one sourceId.`);
  }

  return {
    id,
    revision: requiredPositiveInteger(record.revision, `${path}.revision`),
    lane,
    format,
    text,
    thread,
    rationale: requiredString(record.rationale, `${path}.rationale`, 2_000),
    researchBasis,
    sourceIds,
    campaignId: nullableString(record.campaignId, `${path}.campaignId`, 128),
    scheduledFor: nullableIso(record.scheduledFor, `${path}.scheduledFor`),
    timingBasis,
    asset: parseAsset(record.asset, `${path}.asset`),
    status,
    scheduledWorkId: optionalId(record.scheduledWorkId, `${path}.scheduledWorkId`),
    calendarItemId: optionalId(record.calendarItemId, `${path}.calendarItemId`),
    receipt: parseReceipt(record.receipt, `${path}.receipt`),
    attentionMessage: optionalString(record.attentionMessage, `${path}.attentionMessage`, 1_000),
  };
}

function parseReceipt(value: unknown, path: string): XEditorialCandidate['receipt'] {
  if (value === undefined || value === null) return undefined;
  const record = requiredRecord(value, path);
  return {
    id: requiredId(record.id, `${path}.id`),
    externalUrl: record.externalUrl === undefined ? undefined : requiredHttpUrl(record.externalUrl, `${path}.externalUrl`),
    summary: requiredString(record.summary, `${path}.summary`, 1_000),
    completedAt: requiredIso(record.completedAt, `${path}.completedAt`),
  };
}

function parseAsset(value: unknown, path: string): XEditorialReleaseKitAsset | null {
  if (value === null || value === undefined) return null;
  const record = requiredRecord(value, path);
  if (record.kind !== 'release-kit') throw new Error(`${path}.kind must be release-kit.`);
  const sha256 = requiredString(record.sha256, `${path}.sha256`, 64).toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`${path}.sha256 must be a 64-character hex digest.`);
  return {
    kind: 'release-kit',
    campaignId: requiredId(record.campaignId, `${path}.campaignId`),
    itemId: requiredId(record.itemId, `${path}.itemId`),
    sha256,
    label: requiredString(record.label, `${path}.label`, 200),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function requiredArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > max) throw new Error(`${path} cannot contain more than ${max} items.`);
  return value;
}

function requiredString(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} is required.`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${path} is too long.`);
  return result;
}

function optionalString(value: unknown, path: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, path, max);
}

function nullableString(value: unknown, path: string, max: number): string | null {
  return optionalString(value, path, max) ?? null;
}

function requiredId(value: unknown, path: string): string {
  const result = requiredString(value, path, 128);
  if (!ID_PATTERN.test(result)) throw new Error(`${path} has an invalid identifier.`);
  return result;
}

function optionalId(value: unknown, path: string): string | undefined {
  return value === undefined || value === null ? undefined : requiredId(value, path);
}

function requiredInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  return value;
}

function requiredPositiveInteger(value: unknown, path: string): number {
  const result = requiredInteger(value, path);
  if (result < 1) throw new Error(`${path} must be at least 1.`);
  return result;
}

function requiredIso(value: unknown, path: string): string {
  const result = requiredString(value, path, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${path} must be an ISO-8601 timestamp.`);
  return result;
}

function nullableIso(value: unknown, path: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredIso(value, path);
}

function requiredTimezone(value: unknown, path: string): string {
  const result = requiredString(value, path, 128);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: result }).format(new Date(0));
  } catch {
    throw new Error(`${path} must be a valid IANA timezone.`);
  }
  return result;
}

function requiredHttpUrl(value: unknown, path: string): string {
  const result = requiredString(value, path, 2_000);
  try {
    const url = new URL(result);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error(`${path} must be an http(s) URL.`);
  }
  return result;
}

function uniqueStrings(value: unknown, path: string, max: number): string[] {
  const items = requiredArray(value, path, max).map((item, index) => requiredId(item, `${path}[${index}]`));
  assertUnique(items, path);
  return items;
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} must be unique: ${value}`);
    seen.add(value);
  }
}
