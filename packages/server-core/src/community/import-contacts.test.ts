import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunityEmailJob, listCommunityEmailJobs, listCommunitySuppressions, readCommunityState, suppressCommunityContact, upsertCommunityContact } from '@craft-agent/shared/community';
import { importArtistCommunitySchema } from '@craft-agent/session-tools-core';
import { importArtistCommunityContacts } from './import-contacts';

const roots: string[] = [];
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'community-import-'));
  roots.push(root);
  process.env.CRAFT_CONFIG_DIR = join(root, 'private');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'community-test', name: 'Community Test', slug: 'community-test', createdAt: 1, updatedAt: 1 }));
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
});

describe('Community conversational import', () => {
  test('saves to the UI record store with unknown consent and no sending jobs', () => {
    const root = fixture();
    expect(importArtistCommunityContacts(root, { people: [{ email: 'Fan@Example.com', name: 'A Fan', notes: 'Met at the show', segment: 'local' }] }).added).toBe(1);
    const state = readCommunityState(root);
    expect(state.contacts[0]).toMatchObject({ email: 'fan@example.com', name: 'A Fan', consentStatus: 'unknown', notes: 'Met at the show', segments: ['local'] });
    expect(state.contacts[0]?.consentEvidence).toBeUndefined();
    expect(state.index.totalContacts).toBe(1);
    expect(listCommunityEmailJobs(root)).toEqual([]);
    const draft = createCommunityEmailJob(root, 'test-machine', { title: 'Newsletter', segmentIds: ['local'] });
    expect(draft.audience.estimatedRecipients).toBe(0);
    expect(draft.audience.excludedUnknownConsent).toBe(1);
  });
  test('deduplicates within the batch and retries without modifying saved details or consent', () => {
    const root = fixture();
    const first = importArtistCommunityContacts(root, { people: [{ email: 'fan@example.com', notes: 'Original' }, { email: 'FAN@example.com', notes: 'Replacement' }] });
    expect([first.added, first.existing]).toEqual([1, 1]);
    const before = readCommunityState(root).contacts[0];
    const retry = importArtistCommunityContacts(root, { people: [{ email: 'fan@example.com', consent: { status: 'opted-in', source: 'new claim' } }] });
    expect(retry.existing).toBe(1);
    expect(readCommunityState(root).contacts[0]).toEqual(before);
  });
  test('preserves unsubscribed contacts and suppression-only records without resurrecting them', () => {
    const root = fixture();
    upsertCommunityContact(root, 'test-machine', { email: 'left@example.com', consentStatus: 'unsubscribed' });
    suppressCommunityContact(root, 'test-machine', 'blocked@example.com', 'manual-block');
    const before = listCommunitySuppressions(root);
    const result = importArtistCommunityContacts(root, { people: ['left@example.com', 'blocked@example.com'].map(email => ({ email, consent: { status: 'opted-in' as const, source: 'claimed list' } })) });
    expect(result.existing).toBe(2);
    expect(result.added).toBe(0);
    expect(listCommunitySuppressions(root)).toEqual(before);
    expect(readCommunityState(root).contacts).toHaveLength(1);
    expect(readCommunityState(root).contacts[0]?.consentStatus).toBe('unsubscribed');
  });
  test('holds conflicting batch and saved identities without choosing whichever appeared first', () => {
    const root = fixture();
    upsertCommunityContact(root, 'test-machine', { email: 'original@example.com', name: 'Original' });
    const result = importArtistCommunityContacts(root, { people: [
      { email: 'same@example.com', name: 'One' }, { email: 'same@example.com', name: 'Two' },
      { email: 'original@example.com', name: 'Different' }, { email: 'new@example.com', name: 'Original' },
    ] });
    expect(result.needsClarification).toBe(4);
    expect(result.added).toBe(0);
    expect(readCommunityState(root).contacts).toHaveLength(1);
  });
  test('persists only explicitly supplied consent evidence for new contacts', () => {
    const root = fixture();
    importArtistCommunityContacts(root, { people: [{ email: 'yes@example.com', consent: { status: 'opted-in', source: 'User supplied newsletter signup export', capturedAt: '2026-09-01T00:00:00Z' } }] });
    expect(readCommunityState(root).contacts[0]).toMatchObject({ consentStatus: 'opted-in', consentEvidence: { source: 'User supplied newsletter signup export', capturedAt: '2026-09-01T00:00:00Z' } });
  });
  test('holds conflicting consent claims instead of picking the first input', () => {
    const root = fixture();
    const result = importArtistCommunityContacts(root, { people: [
      { email: 'fan@example.com', consent: { status: 'opted-in', source: 'newsletter list' } },
      { email: 'fan@example.com', consent: { status: 'transactional-only', source: 'purchase receipt' } },
    ] });
    expect(result.needsClarification).toBe(2);
    expect(readCommunityState(root).contacts).toEqual([]);
  });
  test('rejects unbounded input, invalid addresses and consent without evidence before writes', () => {
    const root = fixture();
    expect(importArtistCommunitySchema.safeParse({ people: Array.from({ length: 101 }, () => ({ email: 'fan@example.com' })) }).success).toBe(false);
    expect(importArtistCommunitySchema.safeParse({ people: [{ email: 'fan@example.com', consent: { status: 'opted-in' } }] }).success).toBe(false);
    expect(() => importArtistCommunityContacts(root, { people: [{ email: 'invalid' }] })).toThrow();
    expect(readCommunityState(root).contacts).toEqual([]);
  });
});
