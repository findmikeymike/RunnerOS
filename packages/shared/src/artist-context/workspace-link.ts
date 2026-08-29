/**
 * Artist context — workspace links and Google sync state
 *
 * Calendar events and network people both carry links to the workspaces they
 * belong to, and both track Google sync status. The definitions were duplicated
 * verbatim in the two renderer modules; they live here once.
 */
import { normalizeInlineText } from './text.ts';

/** Ties a calendar event or person to a workspace it is relevant to. */
export interface ArtistWorkspaceLink {
  workspaceId: string;
  workspaceName?: string;
  role?: string;
  notes?: string;
  linkedAt: string;
}

/** Shared by Google Calendar and Google People sync. */
export type GoogleSyncStatus =
  | 'not-synced'
  | 'synced'
  | 'local-change'
  | 'remote-change'
  | 'conflict'
  | 'error';

const GOOGLE_SYNC_STATUSES: readonly GoogleSyncStatus[] = [
  'not-synced',
  'synced',
  'local-change',
  'remote-change',
  'conflict',
  'error',
];

export function normalizeGoogleSyncStatus(value: unknown): GoogleSyncStatus | undefined {
  return GOOGLE_SYNC_STATUSES.includes(value as GoogleSyncStatus)
    ? (value as GoogleSyncStatus)
    : undefined;
}

/** Drops links without a workspace id; everything else degrades field-by-field. */
export function normalizeWorkspaceLinks(value: unknown): ArtistWorkspaceLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (link): link is ArtistWorkspaceLink =>
        typeof link?.workspaceId === 'string' && Boolean(link.workspaceId.trim()),
    )
    .map((link) => ({
      workspaceId: link.workspaceId.trim(),
      workspaceName: normalizeInlineText(link.workspaceName),
      role: normalizeInlineText(link.role),
      notes: normalizeInlineText(link.notes),
      linkedAt: typeof link.linkedAt === 'string' ? link.linkedAt : new Date().toISOString(),
    }));
}

/** Adds or replaces the link for a workspace. One link per workspace. */
export function upsertWorkspaceLink(
  links: ArtistWorkspaceLink[],
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistWorkspaceLink[] {
  const normalized = normalizeWorkspaceLinks([{ ...link, linkedAt: new Date().toISOString() }])[0];
  if (!normalized) return links;
  return [
    ...links.filter((existing) => existing.workspaceId !== normalized.workspaceId),
    normalized,
  ];
}

/** Deduplicates and trims a list of ids, dropping blanks and non-strings. */
export function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  ];
}
