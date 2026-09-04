import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listCommunityContacts,
  suppressCommunityContact,
  upsertCommunityContact,
} from '../community/index.ts';
import { describeCapture, importCapturedSubscribers, type CapturedSubscriber } from './capture.ts';

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'website-capture-'));
}

function signup(overrides: Partial<CapturedSubscriber> = {}): CapturedSubscriber {
  return {
    email: 'fan@example.com',
    formId: 'newsletter',
    capturedAt: '2026-09-05T10:00:00.000Z',
    ipHash: 'ip-hash-1',
    ...overrides,
  };
}

describe('capture door', () => {
  test('a site signup lands with source, form tag, and full consent evidence', () => {
    const root = workspace();
    try {
      const result = importCapturedSubscribers(root, 'machine-1', [signup()]);

      expect(result.imported).toBe(1);
      expect(result.duplicates).toBe(0);

      const contact = listCommunityContacts(root)[0]!;
      expect(contact.source).toBe('signup-form');
      expect(contact.consentStatus).toBe('opted-in');
      expect(contact.consentEvidence).toMatchObject({
        source: 'website',
        formId: 'newsletter',
        ipHash: 'ip-hash-1',
        capturedAt: '2026-09-05T10:00:00.000Z',
      });
      expect(contact.tags).toContain('site-signup');
      expect(contact.tags).toContain('form:newsletter');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a signup with no edge proof stays unknown so it cannot be broadcast to', () => {
    const root = workspace();
    try {
      importCapturedSubscribers(root, 'machine-1', [signup({ ipHash: undefined })]);
      expect(listCommunityContacts(root)[0]!.consentStatus).toBe('unknown');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a sneak-peek signup is tagged with the release it unlocked', () => {
    const root = workspace();
    try {
      importCapturedSubscribers(root, 'machine-1', [
        signup({ formId: 'sneak-peek', reward: { kind: 'download', releaseId: 'low-tide' } }),
      ]);
      expect(listCommunityContacts(root)[0]!.tags).toContain('sneak-peek-low-tide');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the same address twice counts once as a fan and once as a duplicate', () => {
    const root = workspace();
    try {
      const result = importCapturedSubscribers(root, 'machine-1', [
        signup(),
        signup({ capturedAt: '2026-09-05T11:00:00.000Z' }),
      ]);
      expect(result.imported).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(listCommunityContacts(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an existing fan signing up again is a duplicate, not a new import', () => {
    const root = workspace();
    try {
      upsertCommunityContact(root, 'machine-1', { email: 'fan@example.com', segment: 'vip' });

      const result = importCapturedSubscribers(root, 'machine-1', [signup()]);
      expect(result.imported).toBe(0);
      expect(result.duplicates).toBe(1);
      expect(listCommunityContacts(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a suppressed address is skipped and never re-added by a form post', () => {
    const root = workspace();
    try {
      upsertCommunityContact(root, 'machine-1', { email: 'gone@example.com' });
      suppressCommunityContact(root, 'machine-1', 'gone@example.com', 'unsubscribed');

      const result = importCapturedSubscribers(root, 'machine-1', [
        signup({ email: 'gone@example.com' }),
      ]);

      expect(result.skippedSuppressed).toBe(1);
      expect(result.imported).toBe(0);

      const contact = listCommunityContacts(root).find(entry => entry.email === 'gone@example.com')!;
      expect(contact.consentStatus).not.toBe('opted-in');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('malformed addresses are counted, not written', () => {
    const root = workspace();
    try {
      const result = importCapturedSubscribers(root, 'machine-1', [
        signup({ email: 'not-an-email' }),
        signup({ email: '' }),
        signup({ email: 'real@example.com' }),
      ]);
      expect(result.invalid).toBe(2);
      expect(result.imported).toBe(1);
      expect(listCommunityContacts(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the summary reads as plain language for the card', () => {
    expect(describeCapture({ imported: 0, duplicates: 0, skippedSuppressed: 0, invalid: 0, contacts: [], changes: [] }))
      .toBe('No new signups from the site.');
    expect(describeCapture({ imported: 1, duplicates: 2, skippedSuppressed: 1, invalid: 0, contacts: [], changes: [] }))
      .toBe('1 new fan, 2 already known, 1 suppressed from the site.');
  });
});
