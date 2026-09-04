import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TRUSTED_ELIGIBILITY_THRESHOLD,
  checkApprovalBinding,
  defaultWebsiteManifest,
  disableTrustedMode,
  grantTrustedMode,
  isTrustedModeEligible,
  latestChangeReceipt,
  listChangeReceipts,
  recordCleanPublish,
  resolveApprovalTier,
  revokeTrustedMode,
  writeChangeReceipt,
} from './index.ts';
import type { WebsiteManifest } from './index.ts';

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'website-approval-'));
}

function earnEligibility(manifest: WebsiteManifest): WebsiteManifest {
  let next = manifest;
  for (let i = 0; i < TRUSTED_ELIGIBILITY_THRESHOLD; i += 1) {
    next = recordCleanPublish(next, { now: `2026-09-0${i + 1}T00:00:00.000Z` });
  }
  return next;
}

describe('approval tiers', () => {
  test('content changes need one click until trusted mode is granted', () => {
    const manifest = defaultWebsiteManifest();
    const decision = resolveApprovalTier(manifest, 'content-only');
    expect(decision.tier).toBe('one-click');
    expect(decision.requiresApproval).toBe(true);
  });

  test('design changes are never trusted, even with trusted mode on', () => {
    const trusted = grantTrustedMode(earnEligibility(defaultWebsiteManifest()));
    expect(resolveApprovalTier(trusted, 'content-only').tier).toBe('trusted');

    const design = resolveApprovalTier(trusted, 'design');
    expect(design.tier).toBe('one-click');
    expect(design.requiresApproval).toBe(true);
  });

  test('trusted mode is offered only after the threshold and never enables itself', () => {
    let manifest = defaultWebsiteManifest();
    for (let i = 0; i < TRUSTED_ELIGIBILITY_THRESHOLD - 1; i += 1) {
      manifest = recordCleanPublish(manifest);
      expect(isTrustedModeEligible(manifest)).toBe(false);
    }
    manifest = recordCleanPublish(manifest);
    expect(isTrustedModeEligible(manifest)).toBe(true);
    // Eligibility alone must not change the publish tier.
    expect(resolveApprovalTier(manifest, 'content-only').tier).toBe('one-click');
  });

  test('granting trusted mode before eligibility throws', () => {
    expect(() => grantTrustedMode(defaultWebsiteManifest())).toThrow(/approved publishes/);
  });

  test('a rollback revokes trusted mode and resets the streak to zero', () => {
    const trusted = grantTrustedMode(earnEligibility(defaultWebsiteManifest()));
    const revoked = revokeTrustedMode(trusted, { now: '2026-09-10T00:00:00.000Z' });

    expect(revoked.publishPolicy.contentOnly).toBe('needs-you');
    expect(revoked.publishPolicy.trustedGrantedAt).toBeUndefined();
    expect(revoked.publishPolicy.trustedEligibleAt).toBeUndefined();
    expect(revoked.publishPolicy.cleanPublishStreak).toBe(0);
    expect(revoked.publishPolicy.trustedRevokedAt).toBe('2026-09-10T00:00:00.000Z');
    expect(resolveApprovalTier(revoked, 'content-only').tier).toBe('one-click');
    expect(isTrustedModeEligible(revoked)).toBe(false);
  });

  test('the artist can turn trusted mode off without losing eligibility', () => {
    const trusted = grantTrustedMode(earnEligibility(defaultWebsiteManifest()));
    const off = disableTrustedMode(trusted);
    expect(resolveApprovalTier(off, 'content-only').tier).toBe('one-click');
    expect(isTrustedModeEligible(off)).toBe(true);
  });
});

describe('approval binding', () => {
  test('a rebuild between approval and publish invalidates the approval', () => {
    const binding = { boundTo: 'hash-a', approvedAt: '2026-09-01T00:00:00.000Z' };
    expect(checkApprovalBinding(binding, 'hash-a').ok).toBe(true);

    const stale = checkApprovalBinding(binding, 'hash-b');
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.failure).toBe('hash-changed');
  });

  test('missing and expired approvals are distinguished', () => {
    const missing = checkApprovalBinding(undefined, 'hash-a');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.failure).toBe('no-approval');

    const expired = checkApprovalBinding(
      { boundTo: 'hash-a', approvedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z' },
      'hash-a',
      { now: '2026-09-03T00:00:00.000Z' },
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.failure).toBe('expired');
  });
});

describe('change receipts', () => {
  test('site and community receipts are stored apart and read back newest first', () => {
    const root = workspace();
    try {
      writeChangeReceipt(root, 'machine-1', {
        kind: 'site-publish',
        origin: { kind: 'automation', automationId: 'weekly' },
        approval: { tier: 'one-click', approvedAt: '2026-09-01T00:00:00.000Z', approvedBy: 'user', boundTo: 'hash-a' },
        summary: 'Added the Denver show',
        after: { buildHash: 'hash-a', deployId: 'deploy-1', url: 'https://example.com' },
      }, { now: '2026-09-01T00:00:00.000Z' });

      writeChangeReceipt(root, 'machine-1', {
        kind: 'email-send',
        origin: { kind: 'user' },
        approval: { tier: 'one-click', approvedBy: 'user', boundTo: 'job-1' },
        summary: 'Sent "Two Colorado nights"',
        counts: { recipients: 61 },
      }, { now: '2026-09-02T00:00:00.000Z' });

      const all = listChangeReceipts(root);
      expect(all).toHaveLength(2);
      expect(all[0]!.kind).toBe('email-send');

      expect(listChangeReceipts(root, { kinds: ['site-publish'] })).toHaveLength(1);
      expect(latestChangeReceipt(root, 'email-send')?.counts?.recipients).toBe(61);
      expect(listChangeReceipts(root, { since: '2026-09-01T12:00:00.000Z' })).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fan addresses never reach a receipt', () => {
    const root = workspace();
    try {
      const receipt = writeChangeReceipt(root, 'machine-1', {
        kind: 'subscriber-import',
        origin: { kind: 'automation', automationId: 'drain' },
        approval: { tier: 'free', boundTo: '' },
        summary: 'Imported fan@example.com from the site',
        changes: ['added fan@example.com to general'],
        counts: { imported: 1, duplicates: 0, skippedSuppressed: 0 },
      });

      expect(receipt.summary).toBe('Imported [email] from the site');
      expect(receipt.changes[0]).toBe('added [email] to general');
      expect(JSON.stringify(receipt)).not.toContain('fan@example.com');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a free-tier receipt records that no approval was required', () => {
    const root = workspace();
    try {
      const receipt = writeChangeReceipt(root, 'machine-1', {
        kind: 'site-publish',
        origin: { kind: 'automation', automationId: 'weekly' },
        approval: { tier: 'trusted', boundTo: 'hash-c' },
        summary: 'Published automatically',
        rollback: { kind: 'deploy', target: 'deploy-2' },
      });
      expect(receipt.approval.tier).toBe('trusted');
      expect(receipt.approval.approvedBy).toBeUndefined();
      expect(receipt.rollback?.target).toBe('deploy-2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
