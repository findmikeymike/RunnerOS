/**
 * Change Receipts — the shared audit contract from spec 41.
 *
 * Every publish, rollback, domain cutover, email send, and subscriber import
 * writes one. The artist reads them on the Website and Community pages; the
 * weekly routine reads the last few to decide what is already handled.
 *
 * Receipts never contain subscriber email addresses, only counts and hashes.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getRecordCollectionDir, writeSharedRecord } from '../records/index.ts';
import type { SharedEntityMeta } from '../records/types.ts';

export const WEBSITE_RECEIPTS_COLLECTION = 'receipts/website';
export const COMMUNITY_RECEIPTS_COLLECTION = 'receipts/community';

export type ChangeReceiptKind =
  | 'site-publish'
  | 'site-rollback'
  | 'domain-cutover'
  | 'email-send'
  | 'subscriber-import';

/**
 * `free` ran with no human in the loop and no approval was required.
 * `one-click` means the artist pressed Approve on a bound target.
 * `trusted` means the artist had previously granted standing approval for
 * this exact change class, and the receipt is the disclosure.
 */
export type ApprovalTier = 'free' | 'one-click' | 'trusted';

export interface ChangeReceiptApproval {
  tier: ApprovalTier;
  approvedAt?: string;
  approvedBy?: 'user';
  /** Build hash or job id the approval was bound to. Empty for `free`. */
  boundTo: string;
}

export interface ChangeReceiptOrigin {
  kind: 'user' | 'agent' | 'automation';
  sessionId?: string;
  automationId?: string;
  agentSlug?: string;
}

export interface ChangeReceiptRecord extends SharedEntityMeta {
  kind: ChangeReceiptKind;
  at: string;
  origin: ChangeReceiptOrigin;
  approval: ChangeReceiptApproval;
  /** One line of plain language. Shown on the card without opening anything. */
  summary: string;
  /** The signals that triggered this change. */
  why: string[];
  /** What actually changed, one line each. */
  changes: string[];
  before?: { deployId?: string; url?: string; dns?: string[]; text?: string };
  after?: { deployId?: string; url?: string; buildHash?: string; jobId?: string; sentCount?: number };
  preview?: { outputId: string };
  rollback?: { kind: 'deploy' | 'dns-steps' | 'none'; target?: string; steps?: string[] };
  audit?: { score: number; warnings: number };
  counts?: {
    imported?: number;
    skippedSuppressed?: number;
    duplicates?: number;
    recipients?: number;
  };
}

export interface WriteChangeReceiptInput {
  kind: ChangeReceiptKind;
  origin: ChangeReceiptOrigin;
  approval: ChangeReceiptApproval;
  summary: string;
  why?: string[];
  changes?: string[];
  before?: ChangeReceiptRecord['before'];
  after?: ChangeReceiptRecord['after'];
  preview?: ChangeReceiptRecord['preview'];
  rollback?: ChangeReceiptRecord['rollback'];
  audit?: ChangeReceiptRecord['audit'];
  counts?: ChangeReceiptRecord['counts'];
}

function collectionFor(kind: ChangeReceiptKind): string {
  return kind === 'email-send' || kind === 'subscriber-import'
    ? COMMUNITY_RECEIPTS_COLLECTION
    : WEBSITE_RECEIPTS_COLLECTION;
}

function nowIso(): string {
  return new Date().toISOString();
}

const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Receipts are read by humans and synced across a team. An address that slips
 * into a summary or change line would leak a fan's identity into a file that
 * is not the contact record, so scrub at the boundary rather than trusting
 * every caller.
 */
function scrub(value: string): string {
  return value.replace(EMAIL_LIKE, '[email]');
}

function scrubAll(values: string[] | undefined): string[] {
  return (values ?? []).map(scrub);
}

export function writeChangeReceipt(
  workspaceRootPath: string,
  machineId: string,
  input: WriteChangeReceiptInput,
  options: { id?: string; now?: string } = {},
): ChangeReceiptRecord {
  const at = options.now ?? nowIso();
  const id = options.id ?? `receipt-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const result = writeSharedRecord(workspaceRootPath, collectionFor(input.kind), id, {
    kind: input.kind,
    at,
    origin: input.origin,
    approval: input.approval,
    summary: scrub(input.summary),
    why: scrubAll(input.why),
    changes: scrubAll(input.changes),
    ...(input.before ? { before: input.before } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(input.preview ? { preview: input.preview } : {}),
    ...(input.rollback ? { rollback: input.rollback } : {}),
    ...(input.audit ? { audit: input.audit } : {}),
    ...(input.counts ? { counts: input.counts } : {}),
  }, { machineId, now: at });

  if (result.status === 'conflict') {
    throw new Error(`Change receipt conflict: ${result.conflict.conflictId}`);
  }
  return result.entity as ChangeReceiptRecord;
}

function readReceipts(workspaceRootPath: string, collection: string): ChangeReceiptRecord[] {
  const dir = getRecordCollectionDir(workspaceRootPath, collection);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as ChangeReceiptRecord;
        return parsed?.id && !parsed.deletedAt ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

/** Newest first. */
export function listChangeReceipts(
  workspaceRootPath: string,
  options: { kinds?: ChangeReceiptKind[]; limit?: number; since?: string } = {},
): ChangeReceiptRecord[] {
  const wantWebsite = !options.kinds || options.kinds.some(kind => collectionFor(kind) === WEBSITE_RECEIPTS_COLLECTION);
  const wantCommunity = !options.kinds || options.kinds.some(kind => collectionFor(kind) === COMMUNITY_RECEIPTS_COLLECTION);

  const all = [
    ...(wantWebsite ? readReceipts(workspaceRootPath, WEBSITE_RECEIPTS_COLLECTION) : []),
    ...(wantCommunity ? readReceipts(workspaceRootPath, COMMUNITY_RECEIPTS_COLLECTION) : []),
  ]
    .filter(receipt => !options.kinds || options.kinds.includes(receipt.kind))
    .filter(receipt => !options.since || receipt.at > options.since)
    .sort((a, b) => b.at.localeCompare(a.at));

  return options.limit ? all.slice(0, options.limit) : all;
}

export function latestChangeReceipt(
  workspaceRootPath: string,
  kind: ChangeReceiptKind,
): ChangeReceiptRecord | undefined {
  return listChangeReceipts(workspaceRootPath, { kinds: [kind], limit: 1 })[0];
}
