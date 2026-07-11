import { ARTIST_VAULT_CONTEXT_SLUG, type VaultManifest } from '../artist-vault/types.ts';
import { isSharedIntelContextSlug, parseSharedIntelNote } from '../shared-intel/index.ts';
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import {
  HQ_SOURCE_CONTEXT_SLUGS,
  HQ_STATE_CONTEXT_FENCE,
  HQ_STATE_CONTEXT_SLUG,
  type BuiltHqStateContextDoc,
  type HqStateAction,
  type HqStateAttentionItem,
  type HqStateGoalProgress,
  type HqStateNextMove,
  type HqStateOfPlay,
  type HqOperationalItem,
  type HqOperationalSnapshot,
  type HqStateRouteHint,
} from './types.ts';

interface ArtistProfileDoc {
  artistName?: string;
  bio?: string;
  themes?: string;
  sound?: string;
  visualWorld?: string;
  audience?: string;
  similarArtists?: string;
  priorityMarkets?: string;
  spotifyProfile?: string;
  promoBudget?: string;
  rules?: string;
  updatedAt?: string;
}

interface SpotifySnapshotDoc {
  snapshotDate?: string;
  windowDays?: number;
  metrics?: {
    streams?: number;
    listeners?: number;
    followers?: number;
    popularity?: number;
  };
  geo?: {
    topCities?: Array<{ city?: string; country?: string; listeners?: number }>;
  };
  tracks?: Array<{ name?: string; streams?: number; saves?: number; playlistAdds?: number }>;
  playlistsDriving?: Array<{ name?: string; listeners?: number }>;
  partial?: boolean;
  errors?: string[];
  updatedAt?: string;
}

interface NetworkDoc {
  people?: Array<{
    name?: string;
    category?: string;
    role?: string;
    relationship?: string;
    lastTouch?: string;
    canHelpWith?: string;
  }>;
  updatedAt?: string;
}

interface CalendarDoc {
  events?: Array<{
    date?: string;
    title?: string;
    time?: string;
    deletedAt?: string;
  }>;
  updatedAt?: string;
}

interface CommunityDoc {
  contacts?: Array<{ segment?: string; city?: string; lastContacted?: string }>;
  emailJobs?: Array<{ title?: string; status?: string; createdAt?: string; updatedAt?: string }>;
  updatedAt?: string;
}

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
    routing: { mode: 'broadcast' },
    enabled: true,
  };
}

export function buildHqStateContextDoc(args: { docs: LoadedContextDoc[]; now?: Date; operational?: HqOperationalSnapshot }): BuiltHqStateContextDoc {
  const state = buildHqStateOfPlay(args);
  return {
    slug: HQ_STATE_CONTEXT_SLUG,
    metadata: hqStateContextMetadata(),
    body: serializeHqStateOfPlay(state),
    state,
  };
}

export function buildHqStateOfPlay(args: { docs: LoadedContextDoc[]; now?: Date; operational?: HqOperationalSnapshot }): HqStateOfPlay {
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
  const baseNextMove = buildNextMove(input, missing);
  const nextMove = {
    ...baseNextMove,
    route: buildRouteHint(input, baseNextMove),
  };
  const momentum = buildMomentum(input);
  const goalProgress = buildGoalProgress(input);
  const artistName = clean(input.profile?.artistName) ?? 'Artist HQ';

  return {
    version: 1,
    generatedAt: now.toISOString(),
    sources: buildSources(input),
    headline: buildHeadline(artistName, nextMove, missing),
    nextMove,
    attention,
    momentum,
    missing,
    goalProgress,
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
    if (parsed.version !== 1 || !parsed.generatedAt || !parsed.headline || !parsed.nextMove) return null;
    return {
      version: 1,
      generatedAt: String(parsed.generatedAt),
      sources: isPlainObject(parsed.sources) ? parsed.sources as Record<string, string> : {},
      headline: String(parsed.headline),
      nextMove: normalizeNextMove(parsed.nextMove),
      attention: Array.isArray(parsed.attention) ? parsed.attention.map(normalizeAttention).filter(Boolean) as HqStateAttentionItem[] : [],
      momentum: {
        up: Array.isArray(parsed.momentum?.up) ? parsed.momentum.up.map(String) : [],
        down: Array.isArray(parsed.momentum?.down) ? parsed.momentum.down.map(String) : [],
      },
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
      goalProgress: Array.isArray(parsed.goalProgress) ? parsed.goalProgress.map(normalizeGoalProgress).filter(Boolean) as HqStateGoalProgress[] : [],
    };
  } catch {
    return null;
  }
}

function buildNextMove(input: HqInputState, missing: string[]): HqStateNextMove {
  const approval = newestOperationalItem(input.operational?.approvals);
  if (approval) {
    return {
      title: `Review ${approval.title}`,
      why: `${operationalKindLabel(approval)} is waiting for approval before work can continue.`,
      action: 'review',
      oneClick: false,
    };
  }

  const failure = newestOperationalItem(input.operational?.failures);
  if (failure) {
    return {
      title: `Recover ${failure.title}`,
      why: `${operationalKindLabel(failure)} needs attention after ending in ${failure.status}.`,
      worker: 'concierge',
      action: 'review',
      oneClick: false,
    };
  }

  const candidate = buildContextNextMove(input, missing);
  const duplicate = findActiveDuplicate(input, {
    worker: candidate.worker,
    terms: [candidate.title, candidate.why],
  });
  if (duplicate) {
    return {
      title: `Track ${duplicate.title}`,
      why: `${operationalKindLabel(duplicate)} is already ${duplicate.status} and appears to cover this next move.`,
      action: 'review',
      oneClick: false,
    };
  }
  return candidate;
}

function buildContextNextMove(input: HqInputState, missing: string[]): HqStateNextMove {

  const urgentEvent = nextUpcomingEvent(input, 14);
  const vault = summarizeVault(input.vault);
  const stalePerson = mostActionableStalePerson(input);
  const topGoal = rankGoals(input)[0];
  const community = summarizeCommunity(input.community);

  if (!clean(input.profile?.artistName) || !clean(input.profile?.sound) || !clean(input.profile?.audience)) {
    return {
      title: 'Complete Artist Profile',
      why: 'The HQ brain cannot make sharp worker recommendations until artist identity, sound, and audience are defined.',
      worker: 'branding-agent',
      action: 'review',
      oneClick: false,
    };
  }

  if (urgentEvent && (!vault.finalMaster || !vault.coverArt || !vault.pressPhoto)) {
    return {
      title: `Close asset gaps before ${urgentEvent.title}`,
      why: `Calendar shows "${urgentEvent.title}" on ${urgentEvent.date}, but Vault is missing ${missingVaultLabels(vault).join(', ')}.`,
      worker: 'art-director',
      action: 'organize',
      oneClick: false,
    };
  }

  if (topGoal && topGoal.metadata.status === 'active') {
    return {
      title: `Push goal: ${topGoal.metadata.name}`,
      why: goalUrgencyNote(topGoal, input.now),
      worker: 'concierge',
      action: 'schedule',
      oneClick: false,
    };
  }

  if (community.contacts > 0 && community.unsentDrafts > 0) {
    return {
      title: 'Finish the pending fan update',
      why: `Community has ${community.contacts} contact${community.contacts === 1 ? '' : 's'} and ${community.unsentDrafts} unsent email draft${community.unsentDrafts === 1 ? '' : 's'}.`,
      worker: 'comms-agent',
      action: 'draft',
      oneClick: true,
    };
  }

  if (stalePerson) {
    return {
      title: `Re-open ${stalePerson.name}`,
      why: `${stalePerson.name} is a ${stalePerson.relationship ?? 'network'} contact${stalePerson.canHelpWith ? ` who can help with ${stalePerson.canHelpWith}` : ''}.`,
      worker: 'outreach-agent',
      action: 'outreach',
      oneClick: true,
    };
  }

  if (!input.spotify) {
    return {
      title: 'Add a Spotify snapshot',
      why: 'HQ has no current streaming context, so it cannot read momentum or market signals.',
      worker: 'spotify-analyst',
      action: 'refresh',
      oneClick: false,
    };
  }

  if (missing.length > 0) {
    return {
      title: `Fill ${missing[0]}`,
      why: 'The strongest next move is to close the highest-impact missing context gap.',
      worker: 'concierge',
      action: 'review',
      oneClick: false,
    };
  }

  return {
    title: 'Run the weekly HQ review',
    why: 'Core context is present. The next production-grade move is to review goals, momentum, and worker queue together.',
    worker: 'concierge',
    action: 'review',
    oneClick: true,
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
  if (nextMove.worker === 'spotify-analyst' && !input.spotify) return 'Spotify context is missing.';
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
  const stalePerson = mostActionableStalePerson(input);
  const latestIntel = [...input.sharedIntel].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const community = summarizeCommunity(input.community);

  const approval = newestOperationalItem(input.operational?.approvals);
  if (approval) {
    items.push({
      kind: 'approval',
      text: `${approval.title} is waiting for approval.`,
      source: approval.source,
    });
  }

  const failure = newestOperationalItem(input.operational?.failures);
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
  if (missingVault.length > 0) {
    items.push({
      kind: 'vault',
      text: `Vault is missing ${missingVault.join(', ')} for agent-ready campaign execution.`,
      source: HQ_SOURCE_CONTEXT_SLUGS.vault,
    });
  }

  if (stalePerson) {
    items.push({
      kind: 'network',
      text: `${stalePerson.name} looks outreach-ready${stalePerson.canHelpWith ? ` for ${stalePerson.canHelpWith}` : ''}.`,
      source: HQ_SOURCE_CONTEXT_SLUGS.network,
    });
  }

  if (community.contacts > 0 && community.sentJobs === 0) {
    items.push({
      kind: 'community',
      text: `${community.contacts} fan contact${community.contacts === 1 ? '' : 's'} exist, but no sent broadcast is recorded.`,
      source: HQ_SOURCE_CONTEXT_SLUGS.community,
    });
  }

  if (input.spotify?.partial || input.spotify?.errors?.length) {
    items.push({
      kind: 'spotify',
      text: 'Spotify snapshot is partial or has errors; refresh before making performance calls.',
      source: HQ_SOURCE_CONTEXT_SLUGS.spotify,
    });
  }

  if (latestIntel) {
    items.push({
      kind: 'shared-intel',
      text: `Recent shared intel: ${latestIntel.title}.`,
      source: latestIntel.id,
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
  const topTrack = spotify?.tracks?.find((track) => clean(track.name));
  if (topTrack?.name) up.push(`Top track signal: ${topTrack.name}${topTrack.streams ? ` (${formatNumber(topTrack.streams)} streams)` : ''}.`);
  const topCity = spotify?.geo?.topCities?.find((city) => clean(city.city));
  if (topCity?.city) up.push(`Top city signal: ${topCity.city}${topCity.country ? `, ${topCity.country}` : ''}.`);
  if (community.contacts > 0) up.push(`${community.contacts} community contact${community.contacts === 1 ? '' : 's'} tracked.`);
  if (vault.agentUsable > 0) up.push(`${vault.agentUsable} agent-usable Vault asset${vault.agentUsable === 1 ? '' : 's'} available.`);
  if (vault.faceReference) up.push('Face reference is available in Vault for visual generation.');

  if (!spotify) down.push('No Spotify snapshot yet.');
  else if (spotify.partial) down.push('Spotify snapshot is marked partial.');
  if (spotify?.errors?.length) down.push(`Spotify snapshot has ${spotify.errors.length} error${spotify.errors.length === 1 ? '' : 's'}.`);
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
  if (!input.calendar?.events?.some((event) => !event.deletedAt)) missing.push('calendar dates');
  if (!input.network?.people?.length) missing.push('network contacts');
  if (!input.community?.contacts?.length) missing.push('community contacts');
  if (!vault.finalMaster) missing.push('final master in Vault');
  if (!vault.coverArt) missing.push('cover art in Vault');
  if (!vault.pressPhoto) missing.push('press photo in Vault');
  if (input.goals.length === 0) missing.push('active HQ goal');

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

function newestOperationalItem(items: HqOperationalItem[] | undefined): HqOperationalItem | null {
  return [...(items ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function operationalKindLabel(item: HqOperationalItem): string {
  if (item.kind === 'workflow-run') return 'Workflow';
  if (item.kind === 'automation-run') return 'Automation';
  if (item.kind === 'scheduled-work') return 'Scheduled work';
  return 'Output';
}

function findActiveDuplicate(
  input: HqInputState,
  candidate: { worker?: string; terms: string[] },
): HqOperationalItem | null {
  const terms = candidate.terms.flatMap(intentTokens);
  return (input.operational?.active ?? []).find((item) => {
    const itemTokens = new Set(intentTokens(`${item.title} ${item.intent ?? ''}`));
    const overlap = terms.filter((term) => itemTokens.has(term)).length;
    return candidate.worker && item.worker === candidate.worker ? overlap >= 1 : overlap >= 2;
  }) ?? null;
}

function intentTokens(value: string): string[] {
  const ignored = new Set(['and', 'for', 'the', 'this', 'with', 'work', 'task', 'run']);
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !ignored.has(token));
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
  const events = input.calendar?.events ?? [];
  return events
    .filter((event) => event.date && event.title && !event.deletedAt)
    .map((event) => ({ event, days: daysUntil(event.date!, input.now) }))
    .filter((entry): entry is { event: NonNullable<CalendarDoc['events']>[number]; days: number } => entry.days != null && entry.days >= 0 && entry.days <= withinDays)
    .sort((a, b) => a.days - b.days)[0]?.event ?? null;
}

function mostActionableStalePerson(input: HqInputState): NonNullable<NetworkDoc['people']>[number] | null {
  const people = input.network?.people ?? [];
  return people
    .filter((person) => clean(person.name))
    .map((person) => ({ person, score: personScore(person, input.now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.person ?? null;
}

function personScore(person: NonNullable<NetworkDoc['people']>[number], now: Date): number {
  const relationshipScore = person.relationship === 'vip' ? 5 : person.relationship === 'strong' ? 4 : person.relationship === 'warm' ? 3 : 0;
  const helpScore = clean(person.canHelpWith) ? 2 : 0;
  if (relationshipScore === 0 && helpScore === 0) return 0;
  const lastTouchDays = person.lastTouch ? Math.floor((startOfDay(now).getTime() - startOfDay(new Date(person.lastTouch)).getTime()) / DAY_MS) : 120;
  const staleScore = lastTouchDays >= 90 ? 4 : lastTouchDays >= 45 ? 2 : 0;
  return relationshipScore + staleScore + helpScore;
}

function summarizeCommunity(community: CommunityDoc | null): { contacts: number; unsentDrafts: number; sentJobs: number } {
  const jobs = community?.emailJobs ?? [];
  return {
    contacts: community?.contacts?.length ?? 0,
    unsentDrafts: jobs.filter((job) => job.status !== 'sent').length,
    sentJobs: jobs.filter((job) => job.status === 'sent').length,
  };
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
    why: clean(candidate.why) ?? 'No reason was recorded.',
    worker: clean(candidate.worker),
    action: normalizeAction(candidate.action),
    oneClick: typeof candidate.oneClick === 'boolean' ? candidate.oneClick : undefined,
    route: normalizeRouteHint(candidate.route),
  };
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
