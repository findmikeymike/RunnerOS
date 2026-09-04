import type { ArtistCalendar } from '../artist-context/calendar.ts';
import type { ArtistNetwork } from '../artist-context/network.ts';
import type { ArtistProfile } from '../artist-context/profile.ts';
import type { ArtistSpotifySnapshot } from '../artist-context/spotify.ts';
import { CONCIERGE_SLUG } from '../agent-definitions/types.ts';
import type { CommunitySummaryDoc } from '../community/types.ts';
import { ARTIST_VAULT_CONTEXT_SLUG, type VaultManifest } from '../artist-vault/types.ts';
import { isSharedIntelContextSlug, parseSharedIntelNote } from '../shared-intel/index.ts';
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import { hqIntentFingerprint, hqSemanticIntentId } from './intent.ts';
import { buildManagerBrief } from './manager-brief.ts';
import {
  HQ_SOURCE_CONTEXT_SLUGS,
  HQ_STATE_CONTEXT_FENCE,
  HQ_STATE_CONTEXT_SLUG,
  type BuiltHqStateContextDoc,
  type BuildHqStateInput,
  type HqStateAction,
  type HqStateAttentionItem,
  type HqStateGoalProgress,
  type HqStateEntityRef,
  type HqStateNextMove,
  type HqStateOfPlay,
  type HqStateOfPlayV1,
  type HqStateOfPlayV2,
  type HqOperationalItem,
  type HqOperationalSnapshot,
  type HqStateRouteHint,
} from './types.ts';

/**
 * Read view of the Artist Profile doc. Derived from the canonical schema rather
 * than restated, so renaming a profile field breaks this build instead of
 * silently emptying the State of Play. Partial because the doc is user-authored
 * and read here without normalization.
 */
type ArtistProfileDoc = Partial<ArtistProfile>;

/** Read view of the Spotify snapshot doc. See ArtistProfileDoc for why this is derived. */
type SpotifySnapshotDoc = Partial<ArtistSpotifySnapshot>;

/** Read views of the network and calendar docs. See ArtistProfileDoc for why these are derived. */
type NetworkDoc = Partial<ArtistNetwork>;
type CalendarDoc = Partial<ArtistCalendar>;

/**
 * Read view of the community doc. The generated body is v2 (a summary, with
 * fan records kept out of agent context); the inline v1 fields are still
 * accepted for workspaces that have not run the community migration yet.
 */
type CommunityDoc = Partial<CommunitySummaryDoc> & {
  /** v1 only, pre-migration. */
  contacts?: unknown[];
  /** v1 only, pre-migration. */
  emailJobs?: Array<{ status?: string }>;
};

interface HqInputState {
  docs: LoadedContextDoc[];
  now: Date;
  docBySlug: Map<string, LoadedContextDoc>;
  profile: ArtistProfileDoc | null;
  spotify: SpotifySnapshotDoc | null;
  network: NetworkDoc | null;
  calendar: CalendarDoc | null;
  community: CommunityDoc | null;
  vault: VaultManifest | null;
  sharedIntel: NonNullable<ReturnType<typeof parseSharedIntelNote>>[];
  goals: LoadedContextDoc[];
  operational?: HqOperationalSnapshot;
}

const SOURCE_SLUGS = new Set<string>([
  HQ_STATE_CONTEXT_SLUG,
  ARTIST_VAULT_CONTEXT_SLUG,
  ...Object.values(HQ_SOURCE_CONTEXT_SLUGS),
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export function hqStateContextMetadata(): ContextDocMetadata {
  return {
    name: 'HQ State of Play',
    description: 'Generated operating brief for Artist HQ: next move, attention items, momentum, gaps, and goals.',
    routing: { mode: 'targeted', agents: [CONCIERGE_SLUG] },
    enabled: true,
    delivery: 'always',
  };
}

export function buildHqStateContextDoc(args: BuildHqStateInput): BuiltHqStateContextDoc {
  const state = buildHqStateOfPlay(args);
  return {
    slug: HQ_STATE_CONTEXT_SLUG,
    metadata: hqStateContextMetadata(),
    body: serializeHqStateOfPlay(state),
    state,
  };
}

export function buildHqStateOfPlay(args: BuildHqStateInput): HqStateOfPlayV2 {
  const now = args.now ?? new Date();
  const docs = args.docs.filter((doc) => doc.slug !== HQ_STATE_CONTEXT_SLUG && doc.metadata.enabled !== false);
  const docBySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const input: HqInputState = {
    docs,
    now,
    docBySlug,
    profile: readJsonObject<ArtistProfileDoc>(docBySlug.get(HQ_SOURCE_CONTEXT_SLUGS.profile)),
    spotify: readJsonObject<SpotifySnapshotDoc>(docBySlug.get(HQ_SOURCE_CONTEXT_SLUGS.spotify)),
    network: readJsonObject<NetworkDoc>(docBySlug.get(HQ_SOURCE_CONTEXT_SLUGS.network)),
    calendar: readJsonObject<CalendarDoc>(docBySlug.get(HQ_SOURCE_CONTEXT_SLUGS.calendar)),
    community: readJsonObject<CommunityDoc>(docBySlug.get(HQ_SOURCE_CONTEXT_SLUGS.community)),
    vault: readJsonObject<VaultManifest>(docBySlug.get(HQ_SOURCE_CONTEXT_SLUGS.vault)),
    sharedIntel: docs
      .filter((doc) => isSharedIntelContextSlug(doc.slug))
      .map((doc) => parseSharedIntelNote(doc.body))
      .filter((note): note is NonNullable<ReturnType<typeof parseSharedIntelNote>> => Boolean(note && !note.superseded)),
    goals: docs.filter(isGoalContextDoc),
    operational: args.operational,
  };

  const missing = buildMissing(input);
  const attention = buildAttention(input).slice(0, 3);
  const rankedMoves = buildRankedMoves(input, missing);
  const nextMove = withRoute(input, rankedMoves[0]!);
  const alternatives = rankedMoves.slice(1, 4).map((move) => withRoute(input, move));
  const momentum = buildMomentum(input);
  const goalProgress = buildGoalProgress(input);
  const artistName = clean(input.profile?.artistName) ?? 'Artist HQ';

  const stateV1: HqStateOfPlayV1 = {
    version: 1,
    generatedAt: now.toISOString(),
    sources: buildSources(input),
    sourceHealth: args.operational?.sourceHealth ?? [],
    headline: buildHeadline(artistName, nextMove, missing),
    nextMove,
    alternatives,
    attention,
    momentum,
    missing,
    goalProgress,
  };
  return {
    ...stateV1,
    version: 2,
    managerBrief: buildManagerBrief({
      workspaceId: args.workspaceId,
      docs,
      relatedCampaigns: args.relatedCampaigns,
      operational: args.operational,
      operatingState: {
        nextMove,
        attention,
        blockers: missing,
      },
      timezone: args.timezone,
      now,
    }),
  };
}

export function serializeHqStateOfPlay(state: HqStateOfPlay): string {
  const attention = state.attention.length
    ? state.attention.map((item) => `- ${item.text} (${item.source})`)
    : ['- None'];
  const missing = state.missing.length
    ? state.missing.map((item) => `- ${item}`)
    : ['- None'];

  return [
    'This is the generated Artist HQ operating brief. Treat it as derived context; regenerate it from source context docs instead of hand-editing.',
    '',
    `Headline: ${state.headline}`,
    '',
    '## Next Move',
    '',
    `- ${state.nextMove.title}`,
    `- Why: ${state.nextMove.why}`,
    state.nextMove.worker ? `- Worker: @${state.nextMove.worker}` : '- Worker: none',
    state.nextMove.action ? `- Action: ${state.nextMove.action}` : '- Action: none',
    '',
    '## Attention',
    '',
    ...attention,
    '',
    '## Missing',
    '',
    ...missing,
    '',
    `\`\`\`${HQ_STATE_CONTEXT_FENCE}`,
    JSON.stringify(state, null, 2),
    '```',
  ].join('\n');
}

export function parseHqStateOfPlay(body: string): HqStateOfPlay | null {
  const json = extractJson(body, HQ_STATE_CONTEXT_FENCE);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<HqStateOfPlay>;
    if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.generatedAt || !parsed.headline || !parsed.nextMove) return null;
    const common: Omit<HqStateOfPlayV1, 'version'> = {
      generatedAt: String(parsed.generatedAt),
      sources: isPlainObject(parsed.sources) ? parsed.sources as Record<string, string> : {},
      sourceHealth: Array.isArray(parsed.sourceHealth) ? parsed.sourceHealth : [],
      recentOutcome: normalizeRecentOutcome(parsed.recentOutcome),
      headline: String(parsed.headline),
      nextMove: normalizeNextMove(parsed.nextMove),
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.map(normalizeNextMove) : [],
      attention: Array.isArray(parsed.attention) ? parsed.attention.map(normalizeAttention).filter(Boolean) as HqStateAttentionItem[] : [],
      momentum: {
        up: Array.isArray(parsed.momentum?.up) ? parsed.momentum.up.map(String) : [],
        down: Array.isArray(parsed.momentum?.down) ? parsed.momentum.down.map(String) : [],
      },
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
      goalProgress: Array.isArray(parsed.goalProgress) ? parsed.goalProgress.map(normalizeGoalProgress).filter(Boolean) as HqStateGoalProgress[] : [],
    };
    if (parsed.version === 1) return { version: 1, ...common };
    const managerBrief = normalizeManagerBrief((parsed as Partial<HqStateOfPlayV2>).managerBrief);
    return managerBrief ? { version: 2, ...common, managerBrief } : null;
  } catch {
    return null;
  }
}

function normalizeManagerBrief(value: unknown): HqStateOfPlayV2['managerBrief'] | null {
  if (!isPlainObject(value) || value.version !== 1) return null;
  if (!clean(value.workspaceId) || !clean(value.revision) || !clean(value.generatedAt)) return null;
  if (!isPlainObject(value.identity) || !isPlainObject(value.growth) || !isPlainObject(value.operatingState)) return null;
  if (!Array.isArray(value.trajectory) || !Array.isArray(value.intelligence) || !Array.isArray(value.sourceHealth)) return null;
  if (!isPlainObject(value.budget) || value.budget.maxChars !== 8000 || typeof value.budget.actualChars !== 'number') return null;
  return value as unknown as HqStateOfPlayV2['managerBrief'];
}

function normalizeRecentOutcome(value: unknown): HqStateOfPlay['recentOutcome'] {
  if (!isPlainObject(value)) return undefined;
  const recommendationStatus = value.recommendationStatus;
  const outcomeStatus = value.outcomeStatus;
  if (!['completed', 'failed', 'superseded'].includes(String(recommendationStatus))) return undefined;
  if (!['successful', 'partial', 'unsuccessful', 'unknown'].includes(String(outcomeStatus))) return undefined;
  if (!clean(String(value.recommendationId ?? '')) || !clean(String(value.title ?? '')) || !clean(String(value.evaluatedAt ?? ''))) return undefined;
  return {
    recommendationId: String(value.recommendationId),
    title: String(value.title),
    recommendationStatus: recommendationStatus as 'completed' | 'failed' | 'superseded',
    outcomeStatus: outcomeStatus as 'successful' | 'partial' | 'unsuccessful' | 'unknown',
    evaluatedAt: String(value.evaluatedAt),
    userUsefulness: ['useful', 'neutral', 'not_useful'].includes(String(value.userUsefulness))
      ? value.userUsefulness as 'useful' | 'neutral' | 'not_useful'
      : undefined,
  };
}

function buildRankedMoves(input: HqInputState, missing: string[]): HqStateNextMove[] {
  const moves: HqStateNextMove[] = [];
  for (const approval of sortedOperationalItems(input, input.operational?.approvals, 'oldest').slice(0, 3)) {
    moves.push({
      title: `Review ${approval.title}`,
      why: `${operationalKindLabel(approval)} is waiting for approval before work can continue.`,
      action: 'review',
      oneClick: false,
      attentionRequired: true,
      entityRef: operationalEntityRef(approval),
    });
  }

  for (const failure of sortedOperationalItems(input, input.operational?.failures).slice(0, 3)) {
    moves.push({
      title: `Recover ${failure.title}`,
      why: `${operationalKindLabel(failure)} needs attention after ending in ${failure.status}.`,
      worker: 'concierge',
      action: 'review',
      oneClick: false,
      attentionRequired: true,
      entityRef: operationalEntityRef(failure),
    });
  }

  const candidate = buildContextNextMove(input, missing);
  const duplicate = findActiveDuplicate(input, {
    worker: candidate.worker,
    terms: [candidate.title, candidate.why],
    semanticIntentId: candidate.semanticIntentId,
  });
  if (duplicate) {
    moves.push({
      title: `Track ${duplicate.title}`,
      why: `${operationalKindLabel(duplicate)} is already ${duplicate.status} and appears to cover this next move.`,
      action: 'review',
      oneClick: false,
      attentionRequired: false,
      entityRef: operationalEntityRef(duplicate),
    });
  } else {
    moves.push(candidate);
  }
  return dedupeMoves(moves);
}

function withRoute(input: HqInputState, move: HqStateNextMove): HqStateNextMove {
  return { ...move, route: buildRouteHint(input, move) };
}

function buildContextNextMove(input: HqInputState, missing: string[]): HqStateNextMove {

  const urgentEvent = nextUpcomingEvent(input, 14);
  const vault = summarizeVault(input.vault);
  const community = summarizeCommunity(input.community);

  if (urgentEvent && (!vault.finalMaster || !vault.coverArt || !vault.pressPhoto)) {
    const missingAssets = missingVaultLabels(vault);
    return {
      title: `Close asset gaps before ${urgentEvent.title}`,
      why: `Calendar shows "${urgentEvent.title}" on ${urgentEvent.date}, but Vault is missing ${missingVaultLabels(vault).join(', ')}.`,
      worker: 'art-director',
      action: 'organize',
      oneClick: false,
      attentionRequired: true,
      semanticIntentId: missingAssets.length === 1
        ? hqSemanticIntentId({ title: missingAssets[0] ?? '' })
        : 'release-assets-general',
    };
  }

  if (!clean(input.profile?.artistName) || !clean(input.profile?.sound) || !clean(input.profile?.audience)) {
    return {
      title: 'Complete Artist Profile',
      why: 'The HQ brain cannot make sharp worker recommendations until artist identity, sound, and audience are defined.',
      worker: 'branding-agent',
      action: 'review',
      oneClick: false,
      attentionRequired: true,
    };
  }

  if (community.contacts > 0 && community.unsentDrafts > 0) {
    return {
      title: 'Finish the pending fan update',
      why: `Community has ${community.contacts} contact${community.contacts === 1 ? '' : 's'} and ${community.unsentDrafts} unsent email draft${community.unsentDrafts === 1 ? '' : 's'}.`,
      worker: 'comms-agent',
      action: 'draft',
      oneClick: true,
      attentionRequired: true,
    };
  }

  if (!input.spotify) {
    return {
      title: 'Add a Spotify snapshot',
      why: 'HQ has no current streaming context, so it cannot read momentum or market signals.',
      worker: 'spotify-analyst',
      action: 'refresh',
      oneClick: true,
      attentionRequired: false,
    };
  }

  if (missing.length > 0) {
    return {
      title: `Fill ${missing[0]}`,
      why: 'The strongest next move is to close the highest-impact missing context gap.',
      worker: 'concierge',
      action: 'review',
      oneClick: false,
      attentionRequired: false,
    };
  }

  return {
    title: 'Run the weekly HQ review',
    why: 'Core context is present. Review current work, deadlines, and recent signals together.',
    worker: 'concierge',
    action: 'review',
    oneClick: true,
    attentionRequired: false,
  };
}

function buildRouteHint(input: HqInputState, nextMove: HqStateNextMove): HqStateRouteHint {
  const action = nextMove.action ?? 'review';
  const agentSlug = clean(nextMove.worker);
  const contextDocSlugs = routeContextDocSlugs(input, action, nextMove);
  const blockedReason = routeBlockedReason(input, nextMove);
  return {
    target: agentSlug ? 'agent' : 'manual',
    action,
    prompt: buildRoutePrompt(nextMove, contextDocSlugs),
    confidence: routeConfidence(nextMove, blockedReason),
    agentSlug: agentSlug || undefined,
    contextDocSlugs,
    blockedReason,
  };
}

function routeContextDocSlugs(input: HqInputState, action: HqStateAction, nextMove: HqStateNextMove): string[] {
  const slugs = new Set<string>();
  const has = (slug: string) => input.docBySlug.has(slug);
  const add = (slug: string) => {
    if (has(slug)) slugs.add(slug);
  };

  if (nextMove.worker === 'branding-agent') add(HQ_SOURCE_CONTEXT_SLUGS.profile);
  if (nextMove.worker === 'art-director') {
    add(HQ_SOURCE_CONTEXT_SLUGS.calendar);
    add(HQ_SOURCE_CONTEXT_SLUGS.vault);
    add(HQ_SOURCE_CONTEXT_SLUGS.profile);
  }
  if (nextMove.worker === 'comms-agent') {
    add(HQ_SOURCE_CONTEXT_SLUGS.community);
    add(HQ_SOURCE_CONTEXT_SLUGS.profile);
  }
  if (nextMove.worker === 'outreach-agent') {
    add(HQ_SOURCE_CONTEXT_SLUGS.network);
    add(HQ_SOURCE_CONTEXT_SLUGS.profile);
  }
  if (nextMove.worker === 'spotify-analyst' || action === 'refresh') add(HQ_SOURCE_CONTEXT_SLUGS.spotify);
  if (nextMove.worker === 'concierge') {
    add(HQ_SOURCE_CONTEXT_SLUGS.profile);
    add(HQ_SOURCE_CONTEXT_SLUGS.calendar);
    add(HQ_SOURCE_CONTEXT_SLUGS.vault);
    for (const goal of rankGoals(input).slice(0, 3)) slugs.add(goal.slug);
  }

  if (slugs.size === 0) {
    for (const slug of Object.values(HQ_SOURCE_CONTEXT_SLUGS)) add(slug);
  }

  return [...slugs].sort();
}

function routeBlockedReason(input: HqInputState, nextMove: HqStateNextMove): string | undefined {
  if (!clean(nextMove.worker)) return 'No target worker was selected.';
  if (nextMove.worker === 'branding-agent' && (!clean(input.profile?.artistName) || !clean(input.profile?.sound) || !clean(input.profile?.audience))) {
    return 'Artist profile is not complete enough for an autonomous worker launch.';
  }
  if (!nextMove.oneClick) return 'Needs user review before launch.';
  return undefined;
}

function routeConfidence(nextMove: HqStateNextMove, blockedReason: string | undefined): HqStateRouteHint['confidence'] {
  if (blockedReason) return nextMove.oneClick ? 'medium' : 'low';
  return nextMove.oneClick ? 'high' : 'medium';
}

function buildRoutePrompt(nextMove: HqStateNextMove, contextDocSlugs: string[]): string {
  const sources = contextDocSlugs.length ? contextDocSlugs.map((slug) => `@${slug}`).join(', ') : 'the available Artist HQ context';
  return [
    `Run this Artist HQ next move: ${nextMove.title}.`,
    `Reason: ${nextMove.why}`,
    `Use these context docs as source of truth: ${sources}.`,
    'Return the concrete next action, any blockers, and the exact artifact or update the artist should approve.',
  ].join('\n');
}

function buildAttention(input: HqInputState): HqStateAttentionItem[] {
  const items: HqStateAttentionItem[] = [];
  const urgentEvent = nextUpcomingEvent(input, 21);
  const vault = summarizeVault(input.vault);

  const degradedSource = input.operational?.sourceHealth.find((source) => source.status !== 'fresh');
  if (degradedSource) {
    items.push({
      kind: 'source-health',
      text: `${degradedSource.source} operational data is ${degradedSource.status}${degradedSource.message ? `: ${degradedSource.message}` : '.'}`,
      source: `operational:${degradedSource.source}`,
    });
  }

  const approval = newestOperationalItem(input, input.operational?.approvals);
  if (approval) {
    items.push({
      kind: 'approval',
      text: `${approval.title} is waiting for approval.`,
      source: approval.source,
    });
  }

  const failure = newestOperationalItem(input, input.operational?.failures);
  if (failure) {
    items.push({
      kind: 'failure',
      text: `${failure.title} needs attention after ${failure.status}.`,
      source: failure.source,
    });
  }

  if (urgentEvent) {
    items.push({
      kind: 'calendar',
      text: `${urgentEvent.title} is on ${urgentEvent.date}; check assets and messaging now.`,
      source: HQ_SOURCE_CONTEXT_SLUGS.calendar,
    });
  }

  const missingVault = missingVaultLabels(vault);
  if (urgentEvent && missingVault.length > 0) {
    items.push({
      kind: 'vault',
      text: `Vault is missing ${missingVault.join(', ')} for agent-ready campaign execution.`,
      source: HQ_SOURCE_CONTEXT_SLUGS.vault,
    });
  }

  if (input.spotify?.partial || asArray(input.spotify?.errors).length > 0) {
    items.push({
      kind: 'spotify',
      text: 'Spotify snapshot is partial or has errors; refresh before making performance calls.',
      source: HQ_SOURCE_CONTEXT_SLUGS.spotify,
    });
  }

  return dedupeAttention(items);
}

function buildMomentum(input: HqInputState): HqStateOfPlay['momentum'] {
  const up: string[] = [];
  const down: string[] = [];
  const spotify = input.spotify;
  const community = summarizeCommunity(input.community);
  const vault = summarizeVault(input.vault);

  if (spotify?.metrics?.listeners) up.push(`${formatNumber(spotify.metrics.listeners)} Spotify listeners in latest snapshot.`);
  if (spotify?.metrics?.streams) up.push(`${formatNumber(spotify.metrics.streams)} Spotify streams in latest snapshot.`);
  const topTrack = asArray(spotify?.tracks).find((track) => clean(track.name));
  if (topTrack?.name) up.push(`Top track signal: ${topTrack.name}${topTrack.streams ? ` (${formatNumber(topTrack.streams)} streams)` : ''}.`);
  const topCity = asArray(spotify?.geo?.topCities).find((city) => clean(city.city));
  if (topCity?.city) up.push(`Top city signal: ${topCity.city}${topCity.country ? `, ${topCity.country}` : ''}.`);
  if (community.contacts > 0) up.push(`${community.contacts} community contact${community.contacts === 1 ? '' : 's'} tracked.`);
  if (vault.agentUsable > 0) up.push(`${vault.agentUsable} agent-usable Vault asset${vault.agentUsable === 1 ? '' : 's'} available.`);
  if (vault.faceReference) up.push('Face reference is available in Vault for visual generation.');

  if (!spotify) down.push('No Spotify snapshot yet.');
  else if (spotify.partial) down.push('Spotify snapshot is marked partial.');
  const spotifyErrorCount = asArray(spotify?.errors).length;
  if (spotifyErrorCount > 0) down.push(`Spotify snapshot has ${spotifyErrorCount} error${spotifyErrorCount === 1 ? '' : 's'}.`);
  if (community.contacts === 0) down.push('No community contacts tracked yet.');
  if (vault.total === 0) down.push('Vault has no assets yet.');
  if (input.goals.length === 0) down.push('No active HQ goals are tracked.');

  return { up: up.slice(0, 5), down: down.slice(0, 5) };
}

function buildMissing(input: HqInputState): string[] {
  const missing: string[] = [];
  const profile = input.profile;
  const vault = summarizeVault(input.vault);

  if (!clean(profile?.artistName)) missing.push('artist name');
  if (!clean(profile?.sound)) missing.push('artist sound');
  if (!clean(profile?.audience)) missing.push('target audience');
  if (!clean(profile?.visualWorld)) missing.push('visual world');
  if (!input.spotify) missing.push('Spotify snapshot');
  if (!asArray(input.calendar?.events).some((event) => !event.deletedAt)) missing.push('calendar dates');
  if (asArray(input.network?.people).length === 0) missing.push('network contacts');
  // Via summarizeCommunity so this understands both the generated v2 summary
  // and the pre-migration v1 body; reading `contacts` directly reported every
  // v2 workspace as having none.
  if (summarizeCommunity(input.community).contacts === 0) missing.push('community contacts');
  if (!vault.finalMaster) missing.push('final master in Vault');
  if (!vault.coverArt) missing.push('cover art in Vault');
  if (!vault.pressPhoto) missing.push('press photo in Vault');

  return [...new Set(missing)].slice(0, 10);
}

function buildGoalProgress(input: HqInputState): HqStateGoalProgress[] {
  return rankGoals(input).slice(0, 7).map((doc) => ({
    goal: doc.metadata.name,
    status: doc.metadata.status ?? 'unknown',
    priority: doc.metadata.priority,
    deadline: doc.metadata.deadline,
    note: goalUrgencyNote(doc, input.now),
  }));
}

function buildSources(input: HqInputState): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const doc of input.docs) {
    if (doc.slug === HQ_STATE_CONTEXT_SLUG) continue;
    const json = readJsonObject<Record<string, unknown>>(doc);
    const updatedAt = clean(json?.updatedAt)
      ?? clean(json?.snapshotDate)
      ?? (isSharedIntelContextSlug(doc.slug) ? clean(parseSharedIntelNote(doc.body)?.updatedAt) : undefined)
      ?? 'present';
    sources[doc.slug] = updatedAt;
  }
  if (input.operational) sources['hq-operational-snapshot'] = input.operational.generatedAt;
  return sources;
}

function newestOperationalItem(input: HqInputState, items: HqOperationalItem[] | undefined): HqOperationalItem | null {
  return sortedOperationalItems(input, items)[0] ?? null;
}

function sortedOperationalItems(
  input: HqInputState,
  items: HqOperationalItem[] | undefined,
  order: 'newest' | 'oldest' = 'newest',
): HqOperationalItem[] {
  return visibleOperationalItems(input, items).sort((a, b) => (
    order === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)
  ));
}

function dedupeMoves(moves: HqStateNextMove[]): HqStateNextMove[] {
  const seen = new Set<string>();
  return moves.filter((move) => {
    const key = move.entityRef?.source ?? `${move.worker ?? 'manual'}:${move.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function operationalKindLabel(item: HqOperationalItem): string {
  if (item.kind === 'workflow-run') return 'Workflow';
  if (item.kind === 'automation-run') return 'Automation';
  if (item.kind === 'scheduled-work') return 'Scheduled work';
  return 'Output';
}

function findActiveDuplicate(
  input: HqInputState,
  candidate: { worker?: string; terms: string[]; semanticIntentId?: string },
): HqOperationalItem | null {
  const semanticIntentId = candidate.semanticIntentId ?? hqSemanticIntentId({
    title: candidate.terms[0] ?? '',
    intent: candidate.terms.slice(1).join(' '),
  });
  const fingerprint = hqIntentFingerprint({
    scope: { type: 'hq' },
    worker: candidate.worker,
    title: candidate.terms[0] ?? '',
    intent: candidate.terms.slice(1).join(' '),
    semanticIntentId,
  });
  return visibleOperationalItems(input, input.operational?.active).find((item) => {
    return item.fingerprint === fingerprint;
  }) ?? null;
}

function visibleOperationalItems(input: HqInputState, items: HqOperationalItem[] | undefined): HqOperationalItem[] {
  const scope = input.operational?.scope ?? { type: 'hq' as const };
  return (items ?? []).filter((item) => sameOperationalScope(item.scope, scope) && !isExpired(item.expiresAt, input.now));
}

function sameOperationalScope(left: HqOperationalItem['scope'], right: HqOperationalItem['scope']): boolean {
  return left.type === right.type && (left.type === 'hq' || left.campaignId === (right.type === 'campaign' ? right.campaignId : undefined));
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isNaN(timestamp) && timestamp <= now.getTime();
}

function operationalEntityRef(item: HqOperationalItem): HqStateEntityRef {
  return { kind: item.kind, id: item.id, source: item.source, scope: item.scope };
}

function buildHeadline(artistName: string, nextMove: HqStateNextMove, missing: string[]): string {
  if (missing.length > 0) {
    return `${artistName}: ${nextMove.title} is the next move; ${missing.length} context gap${missing.length === 1 ? '' : 's'} still block sharper calls.`;
  }
  return `${artistName}: ${nextMove.title} is the next move.`;
}

function isGoalContextDoc(doc: LoadedContextDoc): boolean {
  if (!doc.metadata.enabled || !doc.metadata.status) return false;
  if (SOURCE_SLUGS.has(doc.slug)) return false;
  if (isSharedIntelContextSlug(doc.slug)) return false;
  return true;
}

function rankGoals(input: HqInputState): LoadedContextDoc[] {
  const priorityRank = new Map([['high', 0], ['normal', 1], ['low', 2]]);
  const statusRank = new Map([['active', 0], ['blocked', 1], ['paused', 2], ['done', 3]]);
  return [...input.goals].sort((a, b) => {
    const aDeadline = a.metadata.deadline ? Date.parse(a.metadata.deadline) : Number.POSITIVE_INFINITY;
    const bDeadline = b.metadata.deadline ? Date.parse(b.metadata.deadline) : Number.POSITIVE_INFINITY;
    return (statusRank.get(a.metadata.status ?? '') ?? 9) - (statusRank.get(b.metadata.status ?? '') ?? 9)
      || (priorityRank.get(a.metadata.priority ?? 'normal') ?? 1) - (priorityRank.get(b.metadata.priority ?? 'normal') ?? 1)
      || aDeadline - bDeadline
      || a.metadata.name.localeCompare(b.metadata.name);
  });
}

function goalUrgencyNote(doc: LoadedContextDoc, now: Date): string {
  const status = doc.metadata.status ?? 'unknown';
  const priority = doc.metadata.priority ?? 'normal';
  if (!doc.metadata.deadline) return `${status} goal, ${priority} priority, no deadline set.`;
  const days = daysUntil(doc.metadata.deadline, now);
  if (days == null) return `${status} goal, ${priority} priority, deadline ${doc.metadata.deadline}.`;
  if (days < 0) return `${status} goal, ${priority} priority, overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}.`;
  if (days === 0) return `${status} goal, ${priority} priority, due today.`;
  return `${status} goal, ${priority} priority, due in ${days} day${days === 1 ? '' : 's'}.`;
}

function summarizeVault(vault: VaultManifest | null): {
  total: number;
  agentUsable: number;
  finalMaster: boolean;
  coverArt: boolean;
  pressPhoto: boolean;
  faceReference: boolean;
  epk: boolean;
} {
  const assets = vault?.assets ?? [];
  const usable = assets.filter(isAgentUsableVaultAsset);
  return {
    total: assets.length,
    agentUsable: usable.length,
    finalMaster: usable.some((asset) => asset.kind === 'master-final'),
    coverArt: usable.some((asset) => asset.kind === 'cover-art'),
    pressPhoto: usable.some((asset) => asset.kind === 'artist-photo'),
    faceReference: usable.some((asset) => asset.kind === 'face-reference'),
    epk: usable.some((asset) => asset.kind === 'epk' || asset.kind === 'one-sheet'),
  };
}

function missingVaultLabels(vault: ReturnType<typeof summarizeVault>): string[] {
  return [
    vault.finalMaster ? null : 'final master',
    vault.coverArt ? null : 'cover art',
    vault.pressPhoto ? null : 'press photo',
  ].filter((item): item is string => Boolean(item));
}

function isAgentUsableVaultAsset(asset: VaultManifest['assets'][number]): boolean {
  if (!asset.usableByAgents) return false;
  if (asset.rightsStatus === 'private' || asset.rightsStatus === 'needs-clearance') return false;
  if (asset.status === 'draft' || asset.status === 'archived' || asset.status === 'missing') return false;
  return true;
}

function nextUpcomingEvent(input: HqInputState, withinDays: number): NonNullable<CalendarDoc['events']>[number] | null {
  const events = asArray(input.calendar?.events);
  return events
    .filter((event) => event.date && event.title && !event.deletedAt)
    .map((event) => ({ event, days: daysUntil(event.date!, input.now) }))
    .filter((entry): entry is { event: NonNullable<CalendarDoc['events']>[number]; days: number } => entry.days != null && entry.days >= 0 && entry.days <= withinDays)
    .sort((a, b) => a.days - b.days)[0]?.event ?? null;
}

function summarizeCommunity(community: CommunityDoc | null): { contacts: number; unsentDrafts: number; sentJobs: number } {
  if (!community) return { contacts: 0, unsentDrafts: 0, sentJobs: 0 };

  // v2: the generated summary. `recentBroadcasts` holds sent jobs only.
  // Counts are type-checked rather than trusted: the doc is parsed without
  // validation, so a string here would flow straight into the brief.
  if (isPlainObject(community.summary)) {
    const summary = community.summary as Partial<CommunitySummaryDoc['summary']>;
    return {
      contacts: countOf(summary.totalContacts),
      unsentDrafts: countOf(summary.draftBroadcasts),
      sentJobs: Array.isArray(community.recentBroadcasts) ? community.recentBroadcasts.length : 0,
    };
  }

  // v1: inline records, before the community migration ran.
  const jobs = Array.isArray(community.emailJobs) ? community.emailJobs : [];
  return {
    contacts: Array.isArray(community.contacts) ? community.contacts.length : 0,
    unsentDrafts: jobs.filter((job) => job?.status !== 'sent').length,
    sentJobs: jobs.filter((job) => job?.status === 'sent').length,
  };
}

/** Non-negative integer counts only; anything else reads as zero. */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function dedupeAttention(items: HqStateAttentionItem[]): HqStateAttentionItem[] {
  const seen = new Set<string>();
  const out: HqStateAttentionItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Collection fields read off source docs, which are parsed without validation.
 * A doc written by hand or by an agent can carry a string where an array
 * belongs, and reaching `.filter()` on it would throw and take the whole brief
 * down. Anything that is not an array reads as empty.
 */
function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function readJsonObject<T extends object>(doc: LoadedContextDoc | undefined): T | null {
  if (!doc?.body.trim()) return null;
  const json = extractJson(doc.body);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return isPlainObject(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}

function extractJson(body: string, fence?: string): string | null {
  if (fence) {
    const escaped = fence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = body.match(new RegExp(`\`\`\`${escaped}\\s*\\n([\\s\\S]*?)\\n\`\`\``));
    if (match?.[1]) return match[1];
  }
  const fenced = body.match(/```(?:json(?:\s+[a-z0-9-]+)?)?\s*\n([\s\S]*?)\n```/i);
  if (fenced?.[1]) return fenced[1];
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  return body.slice(firstBrace, lastBrace + 1);
}

function normalizeNextMove(value: unknown): HqStateNextMove {
  const candidate = isPlainObject(value) ? value as Partial<HqStateNextMove> : {};
  return {
    title: clean(candidate.title) ?? 'Run the weekly HQ review',
    recommendationId: clean(candidate.recommendationId),
    recommendationStatus: normalizeRecommendationStatus(candidate.recommendationStatus),
    snoozedUntil: clean(candidate.snoozedUntil),
    why: clean(candidate.why) ?? 'No reason was recorded.',
    worker: clean(candidate.worker),
    action: normalizeAction(candidate.action),
    oneClick: typeof candidate.oneClick === 'boolean' ? candidate.oneClick : undefined,
    route: normalizeRouteHint(candidate.route),
    entityRef: normalizeEntityRef(candidate.entityRef),
    semanticIntentId: clean(candidate.semanticIntentId),
    attentionRequired: typeof candidate.attentionRequired === 'boolean' ? candidate.attentionRequired : undefined,
  };
}

function normalizeRecommendationStatus(value: unknown): HqStateNextMove['recommendationStatus'] {
  return value === 'proposed' || value === 'viewed' || value === 'accepted' || value === 'launched'
    || value === 'in_progress' || value === 'awaiting_approval' || value === 'completed'
    || value === 'failed' || value === 'dismissed' || value === 'snoozed'
    || value === 'expired' || value === 'superseded' ? value : undefined;
}

function normalizeEntityRef(value: unknown): HqStateEntityRef | undefined {
  if (!isPlainObject(value)) return undefined;
  const kind = value.kind;
  const id = clean(value.id);
  const source = clean(value.source);
  const rawScope = value.scope;
  if (!id || !source || !isPlainObject(rawScope)) return undefined;
  if (kind !== 'output' && kind !== 'scheduled-work' && kind !== 'workflow-run' && kind !== 'automation-run') return undefined;
  const scope = rawScope.type === 'campaign' && clean(rawScope.campaignId)
    ? { type: 'campaign' as const, campaignId: clean(rawScope.campaignId)! }
    : rawScope.type === 'hq' ? { type: 'hq' as const } : undefined;
  return scope ? { kind, id, source, scope } : undefined;
}

function normalizeRouteHint(value: unknown): HqStateRouteHint | undefined {
  if (!isPlainObject(value)) return undefined;
  const candidate = value as Partial<HqStateRouteHint>;
  const action = normalizeAction(candidate.action);
  const prompt = clean(candidate.prompt);
  if (!action || !prompt) return undefined;
  const target = candidate.target === 'agent' ? 'agent' : 'manual';
  const confidence = candidate.confidence === 'high' || candidate.confidence === 'medium' || candidate.confidence === 'low'
    ? candidate.confidence
    : 'low';
  return {
    target,
    action,
    prompt,
    confidence,
    agentSlug: clean(candidate.agentSlug),
    contextDocSlugs: normalizeStringArray(candidate.contextDocSlugs ?? (candidate as { sourceSlugs?: unknown }).sourceSlugs),
    blockedReason: clean(candidate.blockedReason),
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter((item): item is string => Boolean(item)) : [];
}

function normalizeAction(value: unknown): HqStateAction | undefined {
  if (
    value === 'draft'
    || value === 'review'
    || value === 'schedule'
    || value === 'research'
    || value === 'outreach'
    || value === 'refresh'
    || value === 'organize'
  ) {
    return value;
  }
  return undefined;
}

function normalizeAttention(value: unknown): HqStateAttentionItem | null {
  if (!isPlainObject(value)) return null;
  const candidate = value as Partial<HqStateAttentionItem>;
  const text = clean(candidate.text);
  if (!text) return null;
  return {
    kind: clean(candidate.kind) ?? 'note',
    text,
    source: clean(candidate.source) ?? 'unknown',
  };
}

function normalizeGoalProgress(value: unknown): HqStateGoalProgress | null {
  if (!isPlainObject(value)) return null;
  const candidate = value as Partial<HqStateGoalProgress>;
  const goal = clean(candidate.goal);
  if (!goal) return null;
  return {
    goal,
    status: clean(candidate.status) ?? 'unknown',
    note: clean(candidate.note) ?? '',
    priority: clean(candidate.priority),
    deadline: clean(candidate.deadline),
  };
}

function daysUntil(date: string, now: Date): number | null {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((parsed.getTime() - startOfDay(now).getTime()) / DAY_MS);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return trimmed || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
