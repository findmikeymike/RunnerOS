import { existsSync, realpathSync } from 'node:fs';
import { importArtistNetworkSchema, type ImportArtistNetworkInput } from '@craft-agent/session-tools-core';
import { artistNetworkMetadata, createNetworkPerson, emptyArtistNetwork, ARTIST_NETWORK_CONTEXT_SLUG } from '@craft-agent/shared/artist-context';
import { canAgentAccessContextDoc, getContextDocFile, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { assertTeamPermission } from '@craft-agent/shared/workspaces';
import { withWorkspaceContextLock } from '../scheduled-work/workspace-context-lock.ts';

type Receipt = { index: number; name: string; personId?: string; reason: string };
export type ArtistNetworkImportResult = {
  added: Receipt[]; existing: Receipt[]; needsClarification: Receipt[];
  counts: { added: number; existing: number; needsClarification: number };
};
type SavedPerson = Record<string, unknown> & { id: string; name: string; email?: string };
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Validate without the display parser's filtering/coercion, so imports never erase malformed rows. */
function validateSavedNetwork(value: unknown): asserts value is Record<string, unknown> & { people: SavedPerson[] } {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.people)) throw new Error('Artist Network has an unsupported shape. Nothing was imported.');
  const ids = new Set<string>();
  for (const person of value.people) {
    if (!isRecord(person) || typeof person.id !== 'string' || !person.id.trim() || ids.has(person.id)
      || typeof person.name !== 'string' || !person.name.trim() || typeof person.category !== 'string'
      || !Array.isArray(person.tags) || person.tags.some(tag => typeof tag !== 'string')
      || (person.email !== undefined && (typeof person.email !== 'string' || !emailValid(person.email)))) {
      throw new Error('Artist Network contains an invalid or duplicate person record. Nothing was imported.');
    }
    for (const key of ['role', 'notes', 'canHelpWith', 'socials', 'location', 'lastTouch', 'createdAt', 'updatedAt']) {
      if (person[key] !== undefined && typeof person[key] !== 'string') throw new Error('Artist Network contains an invalid person field. Nothing was imported.');
    }
    if ((person.starred !== undefined && typeof person.starred !== 'boolean')
      || (person.relationship !== undefined && !['new', 'warm', 'strong', 'vip'].includes(person.relationship as string))
      || (person.workspaceLinks !== undefined && (!Array.isArray(person.workspaceLinks) || person.workspaceLinks.some(link => !isRecord(link)
        || typeof link.workspaceId !== 'string' || !link.workspaceId.trim()
        || ['workspaceName', 'role', 'notes', 'linkedAt'].some(key => link[key] !== undefined && typeof link[key] !== 'string'))))
      || (person.google !== undefined && (!isRecord(person.google)
        || ['resourceName', 'etag', 'syncStatus', 'lastSyncedAt', 'error'].some(key => (person.google as Record<string, unknown>)[key] !== undefined && typeof (person.google as Record<string, unknown>)[key] !== 'string')))) {
      throw new Error('Artist Network contains invalid relationship data. Nothing was imported.');
    }
    ids.add(person.id);
  }
  if (value.categories !== undefined && (!Array.isArray(value.categories) || value.categories.some(category => !isRecord(category) || typeof category.id !== 'string' || typeof category.label !== 'string'))) {
    throw new Error('Artist Network contains invalid categories. Nothing was imported.');
  }
}

/** Append-only, local Network import. No mailing-list enrollment or provider synchronization. */
export async function importArtistNetwork(rootPath: string, input: ImportArtistNetworkInput, agentSlug: string): Promise<ArtistNetworkImportResult> {
  const parsed = importArtistNetworkSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid Network import. Supply valid names and email addresses for at most 100 people.');
  const canonicalRoot = realpathSync(rootPath);
  assertTeamPermission(canonicalRoot, 'files.write');
  return withWorkspaceContextLock(canonicalRoot, async () => {
    const doc = loadContextDoc(canonicalRoot, ARTIST_NETWORK_CONTEXT_SLUG);
    if (doc && !canAgentAccessContextDoc(doc, agentSlug)) throw new Error('Artist Network is disabled or unavailable to this agent. Nothing was imported.');
    if ((!doc && existsSync(getContextDocFile(canonicalRoot, ARTIST_NETWORK_CONTEXT_SLUG))) || doc?.parseWarnings?.length) {
      throw new Error('Artist Network could not be read safely. Nothing was imported.');
    }
    let json: string | undefined;
    let saved: unknown = emptyArtistNetwork();
    if (doc) {
      json = doc.body.match(/```json\s*([\s\S]*?)```/i)?.[1];
      if (!json) {
        const start = doc.body.indexOf('{'), end = doc.body.lastIndexOf('}');
        if (start >= 0 && end > start) json = doc.body.slice(start, end + 1);
      }
      if (!json) throw new Error('Artist Network has no readable JSON record. Nothing was imported.');
      try { saved = JSON.parse(json); } catch { throw new Error('Artist Network JSON is malformed. Nothing was imported.'); }
    }
    validateSavedNetwork(saved);
    const result: ArtistNetworkImportResult = { added: [], existing: [], needsClarification: [], counts: { added: 0, existing: 0, needsClarification: 0 } };
    const conflictingEmailNames = new Map<string, Set<string>>();
    const inputNames = new Map<string, typeof parsed.data.people>();
    for (const person of parsed.data.people) {
      const name = normalized(person.name);
      inputNames.set(name, [...(inputNames.get(name) ?? []), person]);
      if (person.email) {
        const email = normalized(person.email);
        conflictingEmailNames.set(email, new Set([...(conflictingEmailNames.get(email) ?? []), name]));
      }
    }
    for (const [index, person] of parsed.data.people.entries()) {
      const name = normalized(person.name);
      const email = person.email ? normalized(person.email) : undefined;
      const sameNameInputs = inputNames.get(name)!;
      const nameEmailConflict = new Set(sameNameInputs.flatMap(row => row.email ? [normalized(row.email)] : [])).size > 1
        && !sameNameInputs.every(row => row.distinctPersonConfirmed === true);
      if ((email && conflictingEmailNames.get(email)!.size > 1) || nameEmailConflict) {
        result.needsClarification.push({ index, name: person.name, reason: 'The supplied list contains conflicting names or emails for this person. Clarify those entries before importing them.' });
        continue;
      }
      const emailMatches = email ? saved.people.filter(row => row.email && normalized(row.email) === email) : [];
      const nameMatches = saved.people.filter(row => normalized(row.name) === name);
      const confirmedDistinct = person.distinctPersonConfirmed === true && email && emailMatches.length === 0
        && nameMatches.every(row => row.email && normalized(row.email) !== email);
      const matches = emailMatches.length ? emailMatches : confirmedDistinct ? [] : nameMatches;
      if (matches.length > 1) {
        result.needsClarification.push({ index, name: person.name, reason: 'Multiple saved people match this name or email. Choose the intended person.' });
      } else if (matches.length === 1) {
        const match = matches[0]!;
        const sameName = normalized(match.name) === name;
        const sameEmail = !email || (match.email && normalized(match.email) === email);
        if (!sameName || !sameEmail) {
          result.needsClarification.push({ index, name: person.name, personId: match.id, reason: 'The saved name or email differs. Confirm whether this is the same person; nothing was changed.' });
        } else {
          const differentDetails = ['role', 'notes', 'canHelpWith'].some(key => {
            const supplied = person[key as 'role' | 'notes' | 'canHelpWith'];
            return supplied !== undefined && supplied !== match[key];
          }) || (person.tags !== undefined && JSON.stringify(person.tags) !== JSON.stringify(match.tags));
          result.existing.push({ index, name: person.name, personId: match.id, reason: differentDetails ? 'Already saved. Supplied differing details were not applied; existing information was preserved.' : 'Already saved; no changes made.' });
        }
      } else {
        const created = createNetworkPerson({ ...person, category: 'other', tags: undefined });
        // Preserve supplied notes and tag boundaries rather than flattening a pasted note or splitting tag commas.
        created.notes = person.notes;
        created.tags = person.tags ?? [];
        saved.people.push(created as unknown as SavedPerson);
        result.added.push({ index, name: person.name, personId: created.id, reason: 'Added to the local Artist Network.' });
      }
    }
    if (result.added.length) {
      const categories = (saved.categories ?? emptyArtistNetwork().categories) as Array<Record<string, unknown>>;
      if (!categories.some(category => category.id === 'other')) categories.push({ id: 'other', label: 'Other' });
      saved.categories = categories;
      saved.updatedAt = new Date().toISOString();
      const serialized = JSON.stringify(saved, null, 2);
      const body = doc && json ? doc.body.replace(json, () => serialized) : `This is global artist relationship context.\n\n\`\`\`json\n${serialized}\n\`\`\``;
      upsertContextDoc(canonicalRoot, { slug: ARTIST_NETWORK_CONTEXT_SLUG, metadata: doc?.metadata ?? artistNetworkMetadata(), body });
    }
    result.counts = { added: result.added.length, existing: result.existing.length, needsClarification: result.needsClarification.length };
    return result;
  });
}
