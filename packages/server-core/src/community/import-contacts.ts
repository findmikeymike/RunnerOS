import { importArtistCommunitySchema, type ImportArtistCommunityInput } from '@craft-agent/session-tools-core';
import { communityEmailHash, listCommunityContacts, listCommunitySuppressions, loadCommunityState, upsertCommunityContact } from '@craft-agent/shared/community';
import { assertTeamPermission, getTeamModeStatus } from '@craft-agent/shared/workspaces';

const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
type Receipt = { row: number; status: 'added' | 'existing' | 'needsClarification'; reason: string };

/** Local-only import into the same durable records consumed by Community UI. Never edits existing people. */
export function importArtistCommunityContacts(root: string, input: ImportArtistCommunityInput) {
  const { people } = importArtistCommunitySchema.parse(input);
  assertTeamPermission(root, 'records.write');
  const machineId = getTeamModeStatus(root).machine.machineId.trim() || 'local-machine';
  // Materialize any legacy Community records before deduplication.
  loadCommunityState(root, machineId);
  const rows: Receipt[] = [];
  for (const [index, person] of people.entries()) {
    const row = index + 1;
    const email = person.email.trim().toLowerCase();
    const name = person.name ? normalized(person.name) : undefined;
    const hash = communityEmailHash(email);
    // Refresh for every row; no await between the read and durable write.
    const contacts = listCommunityContacts(root);
    const saved = contacts.filter(contact => contact.emailHash === hash);
    if (listCommunitySuppressions(root).some(item => item.emailHash === hash && !item.deletedAt)
      || saved.some(contact => contact.deletedAt || ['unsubscribed', 'bounced'].includes(contact.consentStatus))) {
      rows.push({ row, status: 'existing', reason: 'Previously removed or suppressed; preserved without changes.' });
      continue;
    }
    const conflictsInBatch = people.some((other, otherIndex) => otherIndex !== index && (
      (other.email.toLowerCase() === email && !!name && !!other.name && normalized(other.name) !== name)
      || (!!name && !!other.name && normalized(other.name) === name && other.email.toLowerCase() !== email)
      || (other.email.toLowerCase() === email && !!other.consent && !!person.consent
        && other.consent.status !== person.consent.status)
    ));
    const conflictingSavedName = name && contacts.some(contact => !contact.deletedAt && contact.name
      && normalized(contact.name) === name && contact.emailHash !== hash);
    if (conflictsInBatch || conflictingSavedName || saved.length > 1
      || (saved[0]?.name && name && normalized(saved[0].name) !== name)) {
      rows.push({ row, status: 'needsClarification', reason: 'Conflicting identity or consent information; nothing changed.' });
      continue;
    }
    if (saved.length) {
      rows.push({ row, status: 'existing', reason: 'Already saved; existing details and consent preserved.' });
      continue;
    }
    try {
      upsertCommunityContact(root, machineId, {
        email, name: person.name, city: person.city, notes: person.notes,
        tags: person.tags, segment: person.segment, source: 'manual',
        consentStatus: person.consent?.status ?? 'unknown',
        ...(person.consent ? { consentEvidence: {
          source: person.consent.source,
          ...(person.consent.capturedAt ? { capturedAt: person.consent.capturedAt } : {}),
        } } : {}),
      });
      rows.push({ row, status: 'added', reason: 'Saved locally to Community. No message sent or external sync.' });
    } catch {
      rows.push({ row, status: 'needsClarification', reason: 'Could not confirm the save. Recheck Community before retrying.' });
    }
  }
  return {
    destination: 'community' as const,
    added: rows.filter(row => row.status === 'added').length,
    existing: rows.filter(row => row.status === 'existing').length,
    needsClarification: rows.filter(row => row.status === 'needsClarification').length,
    rows,
  };
}
