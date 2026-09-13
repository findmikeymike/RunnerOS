import { BlockList, isIP } from 'node:net';
import type { SharedRecord, SharedRecordBaseline } from '../records/types.ts';
import { readSharedRecord, readSharedRecordBaseline, readSharedRecordFileSha, writeSharedRecord } from '../records/storage.ts';
import { buildContextDocBody, extractJsonBlock } from './json-block.ts';
import type { ContextDocDelivery, ContextDocMetadata, ContextDocRouting } from '../workspace-context/types.ts';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import { deleteContextDoc, upsertContextDoc, type LoadedContextDoc } from '../workspace-context/index.ts';

export const ARTIST_CAREER_RESEARCH_CONTEXT_SLUG = 'artist-career-research';
export const ARTIST_CAREER_RESEARCH_COLLECTION = 'artist-career-research';
export const ARTIST_CAREER_RESEARCH_ID = 'current';
export const CAREER_RESEARCH_LIMITS = {
  seedUrls: 10,
  urlChars: 2_048,
  findings: 50,
  findingChars: 600,
  evidencePerFinding: 4,
  supportChars: 300,
  summaryChars: 3_500,
} as const;

export type CareerResearchCategory =
  | 'achievement'
  | 'release'
  | 'collaboration'
  | 'performance'
  | 'press'
  | 'professional-relationship'
  | 'public-description';

export type CareerResearchPredicate =
  | 'achieved'
  | 'released'
  | 'collaborated-with'
  | 'performed-at'
  | 'covered-by'
  | 'professionally-associated-with'
  | 'described-as';

const CAREER_RESEARCH_CATEGORIES: readonly CareerResearchCategory[] = ['achievement', 'release', 'collaboration', 'performance', 'press', 'professional-relationship', 'public-description'];
const CAREER_RESEARCH_PREDICATES: readonly CareerResearchPredicate[] = ['achieved', 'released', 'collaborated-with', 'performed-at', 'covered-by', 'professionally-associated-with', 'described-as'];

export interface CareerResearchIdentity {
  key: string;
  generation: number;
  artistName: string;
  spotifyArtistId?: string;
  spotifyUrl?: string;
  officialUrl?: string;
  supportingUrls: string[];
  confirmedAt?: string;
}

export interface CareerResearchEvidence {
  receiptId: string;
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  locator?: string;
  support: string;
}

export interface CareerResearchFinding {
  id: string;
  claimKey: string;
  category: CareerResearchCategory;
  subjectKey: string;
  predicate: CareerResearchPredicate;
  text: string;
  eventDate?: string;
  validAsOf?: string;
  evidence: CareerResearchEvidence[];
  attribution: 'documented' | 'reported-opinion';
  firstSeenAt: string;
  lastVerifiedAt: string;
  state: 'supported' | 'historical' | 'stale';
}

export interface CareerResearchOverride {
  claimKey: string;
  kind: 'corrected' | 'removed';
  text?: string;
  revision: number;
  actorId: string;
  at: string;
}

export type CareerResearchRunState =
  | 'researching'
  | 'validating'
  | 'publishing'
  | 'succeeded'
  | 'partial'
  | 'needs-identity'
  | 'interrupted'
  | 'cancelled'
  | 'failed';

export interface CareerResearchRun {
  id: string;
  requestId: string;
  attempt: number;
  identityKey: string;
  state: CareerResearchRunState;
  startedAt: string;
  lastAttemptAt: string;
  lastError?: { code: string; message: string };
  deepResearchRunId: string;
}

export interface CareerResearchRecordData extends Record<string, unknown> {
  version: 1;
  hqWorkspaceId: string;
  deliveryPolicy: {
    enabled: boolean;
    routing: ContextDocRouting;
    delivery?: ContextDocDelivery;
  };
  identity: CareerResearchIdentity;
  run?: CareerResearchRun;
  lastSuccessfulResearchAt?: string;
  contextInvalidatedAt?: string;
  findings: CareerResearchFinding[];
  archivedIdentities?: Array<{
    identity: CareerResearchIdentity;
    findings: CareerResearchFinding[];
    overrides: CareerResearchOverride[];
    reportRef?: string;
  }>;
  overrides: CareerResearchOverride[];
  gaps?: string[];
}

export type CareerResearchRecord = SharedRecord<CareerResearchRecordData>;

export interface CareerResearchView {
  revision: number;
  recoveryError?: string;
  recoveryToken?: string;
  identity: CareerResearchIdentity | null;
  run: CareerResearchRun | null;
  findings: Array<CareerResearchFinding & { correctedByUser?: boolean }>;
  removedClaimKeys: string[];
  lastSuccessfulResearchAt?: string;
  lastAttemptAt?: string;
  gaps: string[];
  deliveryPolicy: CareerResearchRecordData['deliveryPolicy'] | null;
  archivedIdentities: Array<{ key: string; artistName: string; generation: number; findingCount: number }>;
}

export interface CareerResearchSeedInput {
  artistName?: string;
  spotifyProfile?: string;
  officialUrl?: string;
  supportingUrls?: string[];
}

export interface CareerResearchDeliveryInput {
  enabled: boolean;
  routing: ContextDocRouting;
  delivery?: ContextDocDelivery;
}

export function normalizeCareerResearchDelivery(input: CareerResearchDeliveryInput): CareerResearchDeliveryInput {
  if (typeof input.enabled !== 'boolean') throw new Error('Career research enabled must be true or false.');
  if (!input.routing || (input.routing.mode !== 'broadcast' && input.routing.mode !== 'targeted')) {
    throw new Error('Career research routing is invalid.');
  }
  const routing = input.routing.mode === 'broadcast'
    ? { mode: 'broadcast' as const }
    : {
        mode: 'targeted' as const,
        agents: Array.from(new Set(input.routing.agents.map((slug) => slug.trim()).filter(Boolean))),
      };
  if (routing.mode === 'targeted' && (
    routing.agents.length === 0 || routing.agents.length > 100 || routing.agents.some((slug) => !AGENT_SLUG_REGEX.test(slug))
  )) throw new Error('Career research targeted routing requires valid agent slugs.');
  if (input.delivery !== undefined && input.delivery !== 'always' && input.delivery !== 'on-demand') {
    throw new Error('Career research delivery is invalid.');
  }
  return { enabled: input.enabled, routing, delivery: input.delivery };
}

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > max) throw new Error(`Value cannot exceed ${max} characters.`);
  return normalized || undefined;
}

const NON_PUBLIC_IPS = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NON_PUBLIC_IPS.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) NON_PUBLIC_IPS.addSubnet(network, prefix, 'ipv6');

function isNonPublicIp(host: string): boolean {
  const ipVersion = isIP(host);
  if (ipVersion === 0) return false;
  return NON_PUBLIC_IPS.check(host, ipVersion === 4 ? 'ipv4' : 'ipv6');
}

function isTrackingOrSecretParameter(name: string): boolean {
  const normalizedName = name.toLowerCase().replace(/[-.]/g, '_');
  return /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_hsenc|_hsmi)$/.test(normalizedName) ||
    /(?:^|_)(?:api_?key|key|access_?token|refresh_?token|token|auth|authorization|secret|password|signature|sig|credential)(?:_|$)/.test(normalizedName);
}

export function normalizeCareerResearchUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('URL is required.');
  if (raw.length > CAREER_RESEARCH_LIMITS.urlChars) throw new Error('URL is too long.');
  const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Use a public http or https URL.');
  if (parsed.username || parsed.password) throw new Error('URLs cannot contain credentials.');
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isNonPublicIp(host)) {
    throw new Error('Use a public internet URL.');
  }
  parsed.protocol = 'https:';
  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingOrSecretParameter(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  parsed.hash = '';
  return parsed.toString();
}

export function normalizeSpotifyArtistProfile(value: string | undefined): { artistId?: string; url?: string } {
  const cleaned = clean(value, CAREER_RESEARCH_LIMITS.urlChars);
  if (!cleaned) return {};
  if (/^[A-Za-z0-9]{22}$/.test(cleaned)) {
    return { artistId: cleaned, url: `https://open.spotify.com/artist/${cleaned}` };
  }
  const parsed = new URL(cleaned.includes('://') ? cleaned : `https://${cleaned}`);
  if (parsed.hostname.toLowerCase() !== 'open.spotify.com') throw new Error('Use a Spotify artist URL or artist ID.');
  const match = parsed.pathname.match(/^\/artist\/([A-Za-z0-9]{22})\/?$/);
  if (!match) throw new Error('Use a Spotify artist URL, not an album, track, or playlist URL.');
  return { artistId: match[1], url: `https://open.spotify.com/artist/${match[1]}` };
}

export function normalizeCareerResearchSeeds(input: CareerResearchSeedInput): CareerResearchSeedInput {
  const spotify = normalizeSpotifyArtistProfile(input.spotifyProfile);
  const supporting = Array.from(new Set((input.supportingUrls ?? []).filter(Boolean).map(normalizeCareerResearchUrl)));
  const totalUrls = supporting.length + Number(Boolean(spotify.url)) + Number(Boolean(input.officialUrl?.trim()));
  if (totalUrls > CAREER_RESEARCH_LIMITS.seedUrls) throw new Error(`Use no more than ${CAREER_RESEARCH_LIMITS.seedUrls} research links total.`);
  return {
    artistName: clean(input.artistName, 200),
    spotifyProfile: spotify.url,
    officialUrl: input.officialUrl?.trim() ? normalizeCareerResearchUrl(input.officialUrl) : undefined,
    supportingUrls: supporting,
  };
}

function isCareerResearchRecord(value: unknown): value is CareerResearchRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<CareerResearchRecord>;
  const validIdentity = Boolean(record.identity && typeof record.identity === 'object' &&
    typeof record.identity.key === 'string' && record.identity.key.length > 0 &&
    typeof record.identity.artistName === 'string' && record.identity.artistName.length > 0 && record.identity.artistName.length <= 200 &&
    Number.isInteger(record.identity.generation) && Number(record.identity.generation) > 0 &&
    Array.isArray(record.identity.supportingUrls) && record.identity.supportingUrls.length <= CAREER_RESEARCH_LIMITS.seedUrls);
  const validFinding = (finding: unknown): boolean => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return false;
    const item = finding as Partial<CareerResearchFinding>;
    return typeof item.id === 'string' && typeof item.claimKey === 'string' && CAREER_RESEARCH_CATEGORIES.includes(item.category as CareerResearchCategory) &&
      typeof item.subjectKey === 'string' && item.subjectKey.length <= 240 && CAREER_RESEARCH_PREDICATES.includes(item.predicate as CareerResearchPredicate) &&
      typeof item.text === 'string' && item.text.length <= CAREER_RESEARCH_LIMITS.findingChars &&
      (item.attribution === 'documented' || item.attribution === 'reported-opinion') &&
      (item.state === 'supported' || item.state === 'historical' || item.state === 'stale') &&
      typeof item.firstSeenAt === 'string' && typeof item.lastVerifiedAt === 'string' &&
      Array.isArray(item.evidence) && item.evidence.length > 0 && item.evidence.length <= CAREER_RESEARCH_LIMITS.evidencePerFinding &&
      item.evidence.every((evidence) => evidence && typeof evidence.receiptId === 'string' && typeof evidence.url === 'string' &&
        typeof evidence.title === 'string' && typeof evidence.retrievedAt === 'string' && typeof evidence.support === 'string' &&
        evidence.support.length <= CAREER_RESEARCH_LIMITS.supportChars);
  };
  const validOverride = (override: unknown): boolean => Boolean(override && typeof override === 'object' && !Array.isArray(override) &&
    typeof (override as CareerResearchOverride).claimKey === 'string' &&
    ((override as CareerResearchOverride).kind === 'corrected' || (override as CareerResearchOverride).kind === 'removed') &&
    typeof (override as CareerResearchOverride).revision === 'number' && typeof (override as CareerResearchOverride).actorId === 'string' &&
    typeof (override as CareerResearchOverride).at === 'string' &&
    ((override as CareerResearchOverride).text === undefined || (typeof (override as CareerResearchOverride).text === 'string' && (override as CareerResearchOverride).text!.length <= CAREER_RESEARCH_LIMITS.findingChars)));
  let validDelivery = false;
  try { normalizeCareerResearchDelivery(record.deliveryPolicy as CareerResearchDeliveryInput); validDelivery = true; } catch { validDelivery = false; }
  return record.version === 1 && typeof record.hqWorkspaceId === 'string' &&
    typeof record.revision === 'number' && !!record.identity && typeof record.identity === 'object' &&
    (record.contextInvalidatedAt === undefined || typeof record.contextInvalidatedAt === 'string') &&
    validIdentity && Array.isArray(record.findings) && record.findings.length <= CAREER_RESEARCH_LIMITS.findings && record.findings.every(validFinding) &&
    Array.isArray(record.overrides) && record.overrides.every(validOverride) && validDelivery;
}

export function readCareerResearchRecord(workspaceRootPath: string): CareerResearchRecord | null {
  const record = readSharedRecord<CareerResearchRecord>(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID);
  return isCareerResearchRecord(record) ? record : null;
}

export function readCareerResearchBaseline(workspaceRootPath: string): SharedRecordBaseline<CareerResearchRecord> | null {
  const baseline = readSharedRecordBaseline<CareerResearchRecord>(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID);
  return baseline && isCareerResearchRecord(baseline.entity) ? baseline : null;
}

/** Includes a privacy-scrubbed deletion tombstone so the fixed record slot can be safely reused. */
export function readCareerResearchSlotBaseline(workspaceRootPath: string): SharedRecordBaseline<SharedRecord> | null {
  return readSharedRecordBaseline(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID);
}

export function writeCareerResearchRecord(
  workspaceRootPath: string,
  data: CareerResearchRecordData,
  options: { machineId: string; baseline?: SharedRecordBaseline; now?: string },
) {
  return writeSharedRecord(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID, data, options);
}

export function buildCareerResearchView(record: CareerResearchRecord | null, emptyRevision = 0): CareerResearchView {
  if (!record) return {
    revision: emptyRevision, identity: null, run: null, findings: [], removedClaimKeys: [], gaps: [],
    deliveryPolicy: null, archivedIdentities: [],
  };
  const latest = new Map(record.overrides.map((entry) => [entry.claimKey, entry]));
  const removedClaimKeys: string[] = [];
  const findings = record.findings.flatMap((finding) => {
    const override = latest.get(finding.claimKey);
    if (override?.kind === 'removed') {
      removedClaimKeys.push(finding.claimKey);
      return [];
    }
    return [{
      ...finding,
      ...(override?.kind === 'corrected' && override.text
        ? { text: override.text, correctedByUser: true as const }
        : {}),
    }];
  });
  return {
    revision: record.revision,
    identity: record.identity,
    run: record.run ?? null,
    findings,
    removedClaimKeys,
    lastSuccessfulResearchAt: record.lastSuccessfulResearchAt,
    lastAttemptAt: record.run?.lastAttemptAt,
    gaps: record.gaps ?? [],
    deliveryPolicy: record.deliveryPolicy,
    archivedIdentities: (record.archivedIdentities ?? []).map((entry) => ({
      key: entry.identity.key,
      artistName: entry.identity.artistName,
      generation: entry.identity.generation,
      findingCount: entry.findings.length,
    })),
  };
}

export function careerResearchMetadata(record: CareerResearchRecord): ContextDocMetadata {
  if (record.contextInvalidatedAt) {
    return {
      name: 'Career research reset pending',
      description: 'Fact-free invalidation remains active until supported replacement research is published.',
      enabled: true,
      routing: { mode: 'broadcast' },
      delivery: 'always',
    };
  }
  return {
    name: 'Career & public context',
    description: 'Sourced public career facts for authorized artist agents. Artist-written direction remains authoritative.',
    enabled: record.deliveryPolicy.enabled,
    routing: record.deliveryPolicy.routing,
    delivery: record.deliveryPolicy.delivery ?? 'on-demand',
  };
}

export function compileCareerResearchBody(record: CareerResearchRecord): string {
  const view = buildCareerResearchView(record);
  const order: CareerResearchCategory[] = ['achievement', 'release', 'collaboration', 'performance', 'professional-relationship', 'press', 'public-description'];
  const ordered = [...view.findings].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  const summaryLines: string[] = [];
  for (const finding of ordered) {
    const source = finding.evidence[0];
    const date = finding.eventDate ?? finding.validAsOf ?? source?.publishedAt;
    const line = `- [${finding.category}] ${finding.text}${date ? ` (${date})` : ''}${source ? ` — ${source.title}: ${source.url}` : ''}${finding.correctedByUser ? ' [Corrected by artist]' : ''}`;
    if ([...summaryLines, line].join('\n').length > CAREER_RESEARCH_LIMITS.summaryChars) break;
    summaryLines.push(line);
  }
  const summary = summaryLines.join('\n');
  const includedKeys = new Set(ordered.slice(0, summaryLines.length).map((finding) => finding.claimKey));
  return buildContextDocBody([
    ...(record.contextInvalidatedAt ? [
      'Earlier career research was explicitly cleared by the user.',
      'Do not rely on career findings from earlier turns, reports, or transcripts. Only findings listed below from new supported research are authorized.',
    ] : []),
    'Sourced public career context. Artist-written Profile, Branding, and Voice govern goals and identity.',
    'Public opinions are attributed. Current performance metrics come from the existing Growth/Pulse context, not this document.',
    `Career research revision ${record.revision}; identity ${record.identity.key}; last successful research ${record.lastSuccessfulResearchAt ?? 'none'}.`,
    view.removedClaimKeys.length ? `Artist-removed claim keys (do not repeat): ${view.removedClaimKeys.join(', ')}.` : '',
    summary || 'No supported public career findings are currently available.',
  ].filter(Boolean), {
    version: 1,
    revision: record.revision,
    identityKey: record.identity.key,
    lastSuccessfulResearchAt: record.lastSuccessfulResearchAt,
    contextInvalidatedAt: record.contextInvalidatedAt,
    gaps: record.gaps ?? [],
    removedClaimKeys: view.removedClaimKeys,
    findings: ordered.filter((finding) => includedKeys.has(finding.claimKey)).map((finding) => ({
      claimKey: finding.claimKey,
      category: finding.category,
      text: finding.text,
      eventDate: finding.eventDate,
      validAsOf: finding.validAsOf,
      state: finding.state,
      correctedByUser: finding.correctedByUser === true,
      sources: finding.evidence.map((evidence) => ({ title: evidence.title, url: evidence.url, publishedAt: evidence.publishedAt })),
    })),
  });
}

export function rebuildCareerResearchProjection(workspaceRootPath: string): LoadedContextDoc | null {
  const record = readCareerResearchRecord(workspaceRootPath);
  if (!record) {
    const slot = readCareerResearchSlotBaseline(workspaceRootPath);
    if (slot?.entity.deletedAt) {
      return upsertContextDoc(workspaceRootPath, {
        slug: ARTIST_CAREER_RESEARCH_CONTEXT_SLUG,
        metadata: {
          name: 'Career research cleared',
          description: 'Fact-free invalidation marker for research removed by the user.',
          enabled: true,
          routing: { mode: 'broadcast' },
          delivery: 'always',
        },
        body: buildContextDocBody([
          'Career research was explicitly cleared by the user.',
          'Do not rely on career findings from earlier turns, reports, or transcripts.',
          'No prior career finding is authorized as current artist context. Use artist-written Profile, Branding, and Voice until new research is completed.',
        ], {
          version: 1,
          revision: slot.revision,
          identityKey: 'cleared',
          cleared: true,
          clearedAt: slot.entity.deletedAt,
          gaps: [],
          findings: [],
        }),
      });
    }
    if (slot || readSharedRecordFileSha(workspaceRootPath, ARTIST_CAREER_RESEARCH_COLLECTION, ARTIST_CAREER_RESEARCH_ID)) {
      return upsertContextDoc(workspaceRootPath, {
        slug: ARTIST_CAREER_RESEARCH_CONTEXT_SLUG,
        metadata: {
          name: 'Career research unavailable',
          description: 'Fact-free safety marker for career research that needs recovery.',
          enabled: true,
          routing: { mode: 'broadcast' },
          delivery: 'always',
        },
        body: buildContextDocBody([
          'Saved career research could not be read safely.',
          'Do not rely on career findings from earlier turns, reports, or transcripts.',
          'No saved career finding is authorized as current artist context until the user clears this record and runs new research.',
        ], {
          version: 1,
          revision: slot?.revision ?? 0,
          identityKey: 'unavailable',
          recoveryRequired: true,
          gaps: [],
          findings: [],
        }),
      });
    }
    deleteContextDoc(workspaceRootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG);
    return null;
  }
  return upsertContextDoc(workspaceRootPath, {
    slug: ARTIST_CAREER_RESEARCH_CONTEXT_SLUG,
    metadata: careerResearchMetadata(record),
    body: compileCareerResearchBody(record),
  });
}

export interface CareerResearchProjection {
  version: 1;
  revision: number;
  identityKey: string;
  lastSuccessfulResearchAt?: string;
  gaps: string[];
  removedClaimKeys?: string[];
  findings: Array<{ claimKey: string; category: CareerResearchCategory; text: string; eventDate?: string; validAsOf?: string; state: CareerResearchFinding['state']; correctedByUser: boolean; sources: Array<{ title: string; url: string; publishedAt?: string }> }>;
}

export function parseCareerResearchProjection(doc: Pick<LoadedContextDoc, 'body'> | undefined): CareerResearchProjection | null {
  const block = doc ? extractJsonBlock(doc.body) : null;
  if (!block) return null;
  try {
    const value = JSON.parse(block) as CareerResearchProjection;
    if (value.version !== 1 || !Number.isInteger(value.revision) || typeof value.identityKey !== 'string' ||
      !Array.isArray(value.gaps) || !Array.isArray(value.findings) || value.findings.some((finding) =>
        !finding || typeof finding.claimKey !== 'string' || typeof finding.text !== 'string' ||
        !CAREER_RESEARCH_CATEGORIES.includes(finding.category) || !Array.isArray(finding.sources))) return null;
    return value;
  } catch { return null; }
}
