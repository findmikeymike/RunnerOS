/**
 * The capture door: where a signup on the artist's site becomes a fan in
 * Community (spec 41, "Subscriber handoff").
 *
 * One contract, whatever the backend. The site's signup function writes to
 * Resend contacts or Cloudflare KV; the drain reads either and lands every
 * signup here with the consent evidence intact, because a contact without
 * evidence never receives a broadcast.
 */

import {
  communityEmailHash,
  listCommunityContacts,
  listCommunitySuppressions,
  upsertCommunityContact,
} from '../community/index.ts';
import type { CommunityContactRecord } from '../community/types.ts';

export interface CapturedSubscriber {
  email: string;
  formId: string;
  capturedAt: string;
  /** Hashed at the edge. The raw address never reaches the app. */
  ipHash?: string;
  firstName?: string;
  /** Set when the form gated a download or stream. */
  reward?: { kind: 'download' | 'stream'; releaseId?: string };
  siteUrl?: string;
}

export interface ImportCaptureResult {
  imported: number;
  duplicates: number;
  skippedSuppressed: number;
  invalid: number;
  /** Contacts touched, newest first. Never contains raw addresses in logs. */
  contacts: CommunityContactRecord[];
  /** One line per outcome class, safe to put in a receipt. */
  changes: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tagsFor(subscriber: CapturedSubscriber): string[] {
  const tags = ['site-signup', `form:${subscriber.formId}`];
  if (subscriber.reward?.releaseId) tags.push(`sneak-peek-${subscriber.reward.releaseId}`);
  return tags;
}

/**
 * Import captured signups into Community.
 *
 * A signup through the artist's own form carries an `ipHash` from the edge,
 * which is single opt-in evidence, so those land as `opted-in`. Anything
 * without that proof stays `unknown` and waits for the double opt-in path,
 * which means it will not receive a broadcast in the meantime.
 */
export function importCapturedSubscribers(
  workspaceRootPath: string,
  machineId: string,
  subscribers: CapturedSubscriber[],
  options: { now?: string } = {},
): ImportCaptureResult {
  const suppressed = new Set(
    listCommunitySuppressions(workspaceRootPath).map(entry => entry.emailHash),
  );
  const existing = new Set(
    listCommunityContacts(workspaceRootPath)
      .filter(contact => !contact.deletedAt)
      .map(contact => contact.emailHash),
  );

  const result: ImportCaptureResult = {
    imported: 0,
    duplicates: 0,
    skippedSuppressed: 0,
    invalid: 0,
    contacts: [],
    changes: [],
  };
  const seen = new Set<string>();

  for (const subscriber of subscribers) {
    const email = subscriber.email?.trim().toLowerCase();
    if (!email || !EMAIL.test(email)) {
      result.invalid += 1;
      continue;
    }
    const hash = communityEmailHash(email);

    // A fan who unsubscribed and signed up again still stays suppressed;
    // only an explicit resubscribe should undo that, never a form post.
    if (suppressed.has(hash)) {
      result.skippedSuppressed += 1;
      continue;
    }
    // The same address twice in one batch is one fan.
    if (seen.has(hash)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(hash);

    const alreadyKnown = existing.has(hash);
    const contact = upsertCommunityContact(workspaceRootPath, machineId, {
      email,
      name: subscriber.firstName,
      source: 'signup-form',
      segment: 'general',
      tags: tagsFor(subscriber),
      consentStatus: subscriber.ipHash ? 'opted-in' : 'unknown',
      consentEvidence: {
        source: 'website',
        capturedAt: subscriber.capturedAt,
        formId: subscriber.formId,
        ipHash: subscriber.ipHash,
      },
    });
    result.contacts.push(contact);

    if (alreadyKnown) result.duplicates += 1;
    else result.imported += 1;
  }

  if (result.imported > 0) result.changes.push(`Added ${result.imported} new ${result.imported === 1 ? 'fan' : 'fans'} from the site`);
  if (result.duplicates > 0) result.changes.push(`${result.duplicates} already on the list`);
  if (result.skippedSuppressed > 0) result.changes.push(`${result.skippedSuppressed} skipped (unsubscribed)`);
  if (result.invalid > 0) result.changes.push(`${result.invalid} skipped (not a valid address)`);

  return result;
}

/** Summary line for the Monday Brief and the receipt. */
export function describeCapture(result: ImportCaptureResult): string {
  if (result.imported === 0 && result.duplicates === 0) return 'No new signups from the site.';
  const parts = [`${result.imported} new ${result.imported === 1 ? 'fan' : 'fans'}`];
  if (result.duplicates > 0) parts.push(`${result.duplicates} already known`);
  if (result.skippedSuppressed > 0) parts.push(`${result.skippedSuppressed} suppressed`);
  return `${parts.join(', ')} from the site.`;
}
