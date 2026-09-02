import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import { buildContextDocBody, extractJsonBlock } from './json-block.ts';
import { normalizeInlineText } from './text.ts';
import {
  normalizeGoogleSyncStatus,
  normalizeWorkspaceLinks,
  upsertWorkspaceLink,
  type ArtistWorkspaceLink,
  type GoogleSyncStatus,
} from './workspace-link.ts';

export const ARTIST_NETWORK_CONTEXT_SLUG = 'artist-network';

const NETWORK_PREAMBLE = [
  'This is global artist relationship context. Treat it as long-term creator context, not one-campaign context.',
];

export type { ArtistWorkspaceLink };

/** Free-form: users add their own categories alongside the built-ins. */
export type ArtistNetworkCategory = string;

export interface ArtistNetworkCategoryDefinition {
  id: ArtistNetworkCategory;
  label: string;
}

export interface GooglePeopleSyncState {
  resourceName?: string;
  etag?: string;
  syncStatus?: GoogleSyncStatus;
  lastSyncedAt?: string;
  error?: string;
}

export type ArtistNetworkRelationship = 'new' | 'warm' | 'strong' | 'vip';

export interface ArtistNetworkPerson {
  id: string;
  name: string;
  category: ArtistNetworkCategory;
  starred?: boolean;
  email?: string;
  role?: string;
  socials?: string;
  location?: string;
  relationship?: ArtistNetworkRelationship;
  lastTouch?: string;
  canHelpWith?: string;
  tags: string[];
  notes?: string;
  workspaceLinks: ArtistWorkspaceLink[];
  google?: GooglePeopleSyncState;
  createdAt: string;
  updatedAt: string;
}

export interface ArtistNetwork {
  version: 1;
  categories: ArtistNetworkCategoryDefinition[];
  people: ArtistNetworkPerson[];
  updatedAt: string;
}

export type ArtistNetworkParseResult =
  | { ok: true; network: ArtistNetwork }
  | { ok: false; network: ArtistNetwork; error: string };

export const NETWORK_CATEGORIES: ArtistNetworkCategoryDefinition[] = [
  { id: 'collaborators', label: 'Collaborators' },
  { id: 'ar', label: 'A&R' },
  { id: 'managers', label: 'Managers' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'press-media', label: 'Press & Media' },
  { id: 'djs-curators', label: 'DJs & Curators' },
  { id: 'creative-team', label: 'Creative Team' },
  { id: 'venues-promoters', label: 'Venues & Promoters' },
  { id: 'brands-partners', label: 'Brands & Partners' },
  { id: 'other', label: 'Other' },
];

const LEGACY_NETWORK_CATEGORY_IDS = new Set([
  'key', 'music', 'collaborators', 'djs', 'producers', 'press', 'playlist-curators',
  'influencers', 'design', 'video', 'venues', 'brands', 'fans-vips', 'other',
]);

export function artistNetworkMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Network',
    description: 'Global people, contacts, and relationship context for the artist.',
    routing: { mode: 'broadcast' },
    delivery: 'on-demand',
    enabled: true,
  };
}

export function emptyArtistNetwork(): ArtistNetwork {
  return {
    version: 1,
    categories: NETWORK_CATEGORIES.map((category) => ({ ...category })),
    people: [],
    updatedAt: new Date().toISOString(),
  };
}

export function parseArtistNetworkDoc(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistNetwork {
  return parseArtistNetworkDocResult(doc).network;
}

export function parseArtistNetworkDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistNetworkParseResult {
  if (!doc?.body.trim()) return { ok: true, network: emptyArtistNetwork() };

  const json = extractJsonBlock(doc.body);
  if (!json) {
    return {
      ok: false,
      network: emptyArtistNetwork(),
      error: 'Artist Network exists, but no JSON block could be read.',
    };
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistNetwork>;
    if (parsed.version !== 1 || !Array.isArray(parsed.people)) {
      return {
        ok: false,
        network: emptyArtistNetwork(),
        error: 'Artist Network JSON has an unsupported shape.',
      };
    }
    const people = parsed.people.filter(isPerson).map(normalizePerson);
    const savedCategories = normalizeCategories(parsed.categories);
    const categories = people.length === 0 && isLegacyDefaultCategoryList(savedCategories)
      ? NETWORK_CATEGORIES.map((category) => ({ ...category }))
      : savedCategories;
    return {
      ok: true,
      network: {
        version: 1,
        categories,
        people,
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    };
  } catch {
    return {
      ok: false,
      network: emptyArtistNetwork(),
      error: 'Artist Network JSON is malformed.',
    };
  }
}

export function serializeArtistNetworkBody(network: ArtistNetwork): string {
  return buildContextDocBody(NETWORK_PREAMBLE, {
    version: 1,
    categories: normalizeCategories(network.categories),
    people: [...network.people].sort((left, right) => left.name.localeCompare(right.name)),
    updatedAt: new Date().toISOString(),
  });
}

export function createNetworkPerson(input: {
  name: string;
  category: ArtistNetworkCategory;
  role?: string;
  email?: string;
  notes?: string;
  canHelpWith?: string;
  tags?: string;
  workspaceLink?: Omit<ArtistWorkspaceLink, 'linkedAt'>;
}): ArtistNetworkPerson {
  const now = new Date().toISOString();
  return {
    id: `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    category: input.category,
    starred: false,
    role: normalizeInlineText(input.role),
    email: normalizeArtistNetworkEmail(input.email),
    notes: normalizeInlineText(input.notes),
    canHelpWith: normalizeInlineText(input.canHelpWith),
    relationship: 'new',
    tags: parseTags(input.tags),
    workspaceLinks: input.workspaceLink
      ? normalizeWorkspaceLinks([{ ...input.workspaceLink, linkedAt: now }])
      : [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateNetworkPerson(
  person: ArtistNetworkPerson,
  input: {
    name: string;
    category: ArtistNetworkCategory;
    role?: string;
    email?: string;
    notes?: string;
    canHelpWith?: string;
    tags?: string;
    workspaceLink?: Omit<ArtistWorkspaceLink, 'linkedAt'>;
  },
): ArtistNetworkPerson {
  return {
    ...person,
    name: input.name.trim(),
    category: input.category,
    role: normalizeInlineText(input.role),
    email: normalizeArtistNetworkEmail(input.email),
    notes: normalizeInlineText(input.notes),
    canHelpWith: normalizeInlineText(input.canHelpWith),
    tags: parseTags(input.tags),
    workspaceLinks: input.workspaceLink
      ? upsertWorkspaceLink(person.workspaceLinks, input.workspaceLink)
      : person.workspaceLinks,
    updatedAt: new Date().toISOString(),
  };
}

/** Slugifies the label, disambiguating with a numeric suffix on collision. */
export function createNetworkCategory(
  label: string,
  existingCategories: ArtistNetworkCategoryDefinition[],
): ArtistNetworkCategoryDefinition {
  const cleanLabel = label.replace(/\s+/g, ' ').trim();
  const base = slugify(cleanLabel || 'category');
  const existingIds = new Set(existingCategories.map((category) => category.id));
  let id = base;
  let count = 2;
  while (existingIds.has(id)) {
    id = `${base}-${count}`;
    count += 1;
  }
  return { id, label: cleanLabel || 'Category' };
}

export function linkNetworkPersonToWorkspace(
  person: ArtistNetworkPerson,
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistNetworkPerson {
  return {
    ...person,
    workspaceLinks: upsertWorkspaceLink(person.workspaceLinks, link),
    updatedAt: new Date().toISOString(),
  };
}

export function unlinkNetworkPersonFromWorkspace(
  person: ArtistNetworkPerson,
  workspaceId: string,
): ArtistNetworkPerson {
  return {
    ...person,
    workspaceLinks: person.workspaceLinks.filter((link) => link.workspaceId !== workspaceId),
    updatedAt: new Date().toISOString(),
  };
}

export function networkPeopleForWorkspace(
  people: ArtistNetworkPerson[],
  workspaceId: string,
): ArtistNetworkPerson[] {
  return people.filter((person) =>
    person.workspaceLinks.some((link) => link.workspaceId === workspaceId),
  );
}

function parseTags(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizePerson(person: ArtistNetworkPerson): ArtistNetworkPerson {
  return {
    ...person,
    name: person.name.trim(),
    starred: person.starred === true,
    email: normalizeArtistNetworkEmail(person.email),
    role: normalizeInlineText(person.role),
    socials: normalizeInlineText(person.socials),
    location: normalizeInlineText(person.location),
    relationship: normalizeRelationship(person.relationship),
    lastTouch: normalizeInlineText(person.lastTouch),
    canHelpWith: normalizeInlineText(person.canHelpWith),
    tags: Array.isArray(person.tags)
      ? person.tags.map(String).map((tag) => tag.trim()).filter(Boolean)
      : [],
    notes: normalizeInlineText(person.notes),
    workspaceLinks: normalizeWorkspaceLinks(person.workspaceLinks),
    google: normalizeGoogleSync(person.google),
    createdAt: typeof person.createdAt === 'string' ? person.createdAt : new Date().toISOString(),
    updatedAt: typeof person.updatedAt === 'string' ? person.updatedAt : new Date().toISOString(),
  };
}

export function normalizeArtistNetworkEmail(value: unknown): string | undefined {
  const normalized = normalizeInlineText(value);
  if (!normalized) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function normalizeGoogleSync(value: unknown): GooglePeopleSyncState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as GooglePeopleSyncState;
  return {
    resourceName: normalizeInlineText(candidate.resourceName),
    etag: normalizeInlineText(candidate.etag),
    syncStatus: normalizeGoogleSyncStatus(candidate.syncStatus),
    lastSyncedAt: normalizeInlineText(candidate.lastSyncedAt),
    error: normalizeInlineText(candidate.error),
  };
}

/** Unknown relationships fall back to 'new' rather than being dropped. */
function normalizeRelationship(value: unknown): ArtistNetworkRelationship {
  return value === 'new' || value === 'warm' || value === 'strong' || value === 'vip'
    ? value
    : 'new';
}

/** Defaults seed new networks only. Saved lists stay user-controlled. */
function normalizeCategories(categories: unknown): ArtistNetworkCategoryDefinition[] {
  const savedCategories = Array.isArray(categories)
    ? categories.filter(isCategory).map((category) => ({
      id: slugify(category.id),
      label: category.label.replace(/\s+/g, ' ').trim(),
    }))
    : NETWORK_CATEGORIES;

  const merged = new Map<string, ArtistNetworkCategoryDefinition>();
  for (const category of savedCategories) {
    if (!category.id || !category.label) continue;
    merged.set(category.id, category);
  }
  return [...merged.values()];
}

function isLegacyDefaultCategoryList(categories: ArtistNetworkCategoryDefinition[]): boolean {
  return categories.length === LEGACY_NETWORK_CATEGORY_IDS.size
    && categories.every((category) => LEGACY_NETWORK_CATEGORY_IDS.has(category.id));
}

function isCategory(value: unknown): value is ArtistNetworkCategoryDefinition {
  const candidate = value as Partial<ArtistNetworkCategoryDefinition>;
  return typeof candidate.id === 'string' && typeof candidate.label === 'string';
}

function isPerson(value: unknown): value is ArtistNetworkPerson {
  const candidate = value as Partial<ArtistNetworkPerson>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.category === 'string'
    && Array.isArray(candidate.tags)
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category'
  );
}
