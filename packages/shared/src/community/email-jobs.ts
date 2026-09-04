/**
 * Email job lifecycle (spec 38 Slice 2, spec 41 Slice C).
 *
 * A job is created as a draft, approved by the artist, then sent. Every
 * transition is here so no caller can invent one, and the guards encode the
 * rules that keep a send honest: the audience is frozen at draft, suppression
 * is re-checked at send, and an approval covers one job.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getRecordCollectionDir, readSharedRecordBaseline, writeSharedRecord } from '../records/index.ts';
import type { SharedEntityMeta } from '../records/types.ts';
import type { CommunityEmailJobRecord, EmailJobStatus } from './types.ts';
import { communityEmailHash, listCommunityContacts, listCommunitySuppressions } from './storage.ts';

const EMAIL_JOBS_COLLECTION = 'community/email-jobs';
const DELIVERIES_COLLECTION = 'community/deliveries';

/** One row per recipient per job. The proof a send actually happened. */
export interface CommunityDeliveryRecord extends SharedEntityMeta {
  jobId: string;
  contactId: string;
  emailHash: string;
  providerMessageId?: string;
  lastEvent?: 'sent' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed' | 'unknown';
  lastEventAt?: string;
  error?: string;
}

/** Statuses from which a job can still be edited or cancelled. */
const OPEN_STATUSES: ReadonlySet<EmailJobStatus> = new Set([
  'draft',
  'needs-provider',
  'needs-approval',
  'needs-owner-approval',
]);

export function isOpenJob(job: CommunityEmailJobRecord): boolean {
  return OPEN_STATUSES.has(job.status) && !job.deletedAt;
}

export type JobTransitionFailure =
  | 'not-found'
  | 'already-sent'
  | 'not-approved'
  | 'wrong-status'
  | 'empty-audience'
  | 'no-provider'
  | 'missing-content';

export interface JobTransitionError {
  ok: false;
  failure: JobTransitionFailure;
  message: string;
}

function fail(failure: JobTransitionFailure, message: string): JobTransitionError {
  return { ok: false, failure, message };
}

/**
 * Can this job be approved right now?
 *
 * Approval is the artist's one decision, so it is refused rather than
 * silently coerced when the job is not actually ready to go out.
 */
export function canApprove(job: CommunityEmailJobRecord): { ok: true } | JobTransitionError {
  if (job.deletedAt) return fail('not-found', 'That email was deleted.');
  if (job.status === 'sent' || job.status === 'sending') {
    return fail('already-sent', 'That email has already gone out.');
  }
  if (!OPEN_STATUSES.has(job.status)) {
    return fail('wrong-status', `An email in "${job.status}" cannot be approved.`);
  }
  if (!job.content.subject.trim() || !job.content.bodyMarkdown.trim()) {
    return fail('missing-content', 'Write the subject and body before approving.');
  }
  if (job.audience.estimatedRecipients === 0) {
    return fail('empty-audience', 'Nobody is in this audience yet.');
  }
  return { ok: true };
}

export interface SendAudienceMember {
  contactId: string;
  emailHash: string;
  email: string;
  firstName?: string;
}

export interface ResolvedAudience {
  members: SendAudienceMember[];
  /** Frozen members dropped because they unsubscribed after the draft. */
  droppedSinceFreeze: number;
}

/**
 * Rebuild the audience at send time from the hashes frozen at draft.
 *
 * The frozen list is what the artist approved, so nobody new is added here.
 * But anyone who unsubscribed in between is dropped: consent at send time is
 * what counts, not consent when the draft was written.
 */
export function resolveSendAudience(
  workspaceRootPath: string,
  job: CommunityEmailJobRecord,
): ResolvedAudience {
  const frozen = new Set(job.audience.frozenMemberHashes ?? []);
  const suppressed = new Set(listCommunitySuppressions(workspaceRootPath).map(entry => entry.emailHash));

  const members: SendAudienceMember[] = [];
  let droppedSinceFreeze = 0;

  for (const contact of listCommunityContacts(workspaceRootPath)) {
    if (contact.deletedAt || !frozen.has(contact.emailHash)) continue;
    if (suppressed.has(contact.emailHash) || contact.consentStatus === 'unsubscribed' || contact.consentStatus === 'bounced') {
      droppedSinceFreeze += 1;
      continue;
    }
    if (!contact.email) {
      droppedSinceFreeze += 1;
      continue;
    }
    members.push({
      contactId: contact.id,
      emailHash: contact.emailHash,
      email: contact.email,
      firstName: contact.name?.split(/\s+/)[0],
    });
  }

  return { members, droppedSinceFreeze };
}

function writeJob(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  patch: Partial<CommunityEmailJobRecord>,
  now?: string,
): CommunityEmailJobRecord {
  // Updating an existing record requires its current baseline; without one
  // every write is reported as a conflict against itself.
  const baseline = readSharedRecordBaseline(workspaceRootPath, EMAIL_JOBS_COLLECTION, job.id);
  const current = readEmailJob(workspaceRootPath, job.id);
  if (!current || current.revision !== job.revision || current.lastWriteSha256 !== job.lastWriteSha256) {
    throw new Error('This email changed. Refresh it before trying again.');
  }
  const result = writeSharedRecord(workspaceRootPath, EMAIL_JOBS_COLLECTION, job.id, {
    ...stripMeta(job),
    ...patch,
  }, { machineId, now, baseline: baseline ?? undefined });
  if (result.status === 'conflict') {
    throw new Error(`Community email job conflict: ${result.conflict.conflictId}`);
  }
  return result.entity as CommunityEmailJobRecord;
}

/** Shared-record metadata is owned by the writer, never by a patch. */
function stripMeta(job: CommunityEmailJobRecord): Record<string, unknown> {
  const {
    id: _id,
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    revision: _revision,
    createdByMachineId: _createdBy,
    updatedByMachineId: _updatedBy,
    lastWriteSha256: _sha,
    headOpId: _head,
    ...rest
  } = job;
  return rest as Record<string, unknown>;
}

export function approveEmailJob(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  options: { now?: string } = {},
): CommunityEmailJobRecord | JobTransitionError {
  if (job.status === 'failed') {
    const deliveries = listDeliveries(workspaceRootPath, job.id);
    if (job.deletedAt || job.send?.uncertainCount || !deliveries.length || deliveries.some(row => row.lastEvent === 'unknown')) {
      return fail('wrong-status', 'Delivery is uncertain. Check Resend before sending again.');
    }
    if (!deliveries.some(row => row.lastEvent === 'failed')) return fail('already-sent', 'No confirmed failed recipients to retry.');
    return writeJob(workspaceRootPath, machineId, job, {
      status: 'approved',
      approval: { approvedByMachineId: machineId, approvedAt: options.now ?? new Date().toISOString() },
    }, options.now);
  }
  // A previous preflight failure has not transmitted anything.
  if (job.status === 'approved' && !job.deletedAt) return job;
  const check = canApprove(job);
  if (!check.ok) return check;
  const at = options.now ?? new Date().toISOString();
  return writeJob(workspaceRootPath, machineId, job, {
    status: 'approved',
    approval: { approvedByMachineId: machineId, approvedAt: at },
  }, at);
}

/**
 * Edit a draft before it is approved.
 *
 * Changing the audience refreezes it, because the frozen list is what an
 * approval will later bind to; leaving a stale list attached to new copy
 * would send the right words to the wrong people.
 */
export function updateEmailJobDraft(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  patch: { subject?: string; bodyMarkdown?: string; title?: string },
  options: { now?: string } = {},
): CommunityEmailJobRecord | JobTransitionError {
  if (!isOpenJob(job)) {
    return fail('wrong-status', `An email in "${job.status}" can no longer be edited.`);
  }
  return writeJob(workspaceRootPath, machineId, job, {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    content: {
      ...job.content,
      ...(patch.subject !== undefined ? { subject: patch.subject.trim() } : {}),
      ...(patch.bodyMarkdown !== undefined ? { bodyMarkdown: patch.bodyMarkdown } : {}),
    },
  }, options.now);
}

export function markJobSending(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  options: { now?: string } = {},
): CommunityEmailJobRecord | JobTransitionError {
  if (job.status !== 'approved' && job.status !== 'queued') {
    return fail('not-approved', 'That email has not been approved yet.');
  }
  const at = options.now ?? new Date().toISOString();
  return writeJob(workspaceRootPath, machineId, job, {
    status: 'sending',
    send: { ...job.send, startedAt: at },
  }, at);
}

export function markJobSent(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  counts: { sentCount: number; failedCount: number; uncertainCount?: number; providerCampaignId?: string },
  options: { now?: string } = {},
): CommunityEmailJobRecord {
  const at = options.now ?? new Date().toISOString();
  return writeJob(workspaceRootPath, machineId, job, {
    status: counts.failedCount > 0 ? 'failed' : 'sent',
    transport: counts.providerCampaignId
      ? { ...job.transport, providerCampaignId: counts.providerCampaignId }
      : job.transport,
    send: { ...job.send, completedAt: at, sentCount: counts.sentCount, failedCount: counts.failedCount, uncertainCount: counts.uncertainCount ?? 0 },
  }, at);
}

export function markJobFailed(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  options: { now?: string } = {},
): CommunityEmailJobRecord {
  const at = options.now ?? new Date().toISOString();
  return writeJob(workspaceRootPath, machineId, job, {
    status: 'failed',
    send: { ...job.send, completedAt: at, uncertainCount: 1 },
  }, at);
}

export function cancelEmailJob(
  workspaceRootPath: string,
  machineId: string,
  job: CommunityEmailJobRecord,
  options: { now?: string } = {},
): CommunityEmailJobRecord | JobTransitionError {
  if (job.status === 'sent' || job.status === 'sending') {
    return fail('already-sent', 'That email has already gone out.');
  }
  return writeJob(workspaceRootPath, machineId, job, { status: 'cancelled' }, options.now);
}

export function readEmailJob(
  workspaceRootPath: string,
  jobId: string,
): CommunityEmailJobRecord | undefined {
  const dir = getRecordCollectionDir(workspaceRootPath, EMAIL_JOBS_COLLECTION);
  const file = join(dir, `${jobId}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as CommunityEmailJobRecord;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

export function writeDeliveries(
  workspaceRootPath: string,
  machineId: string,
  jobId: string,
  rows: Array<{ contactId: string; emailHash: string; providerMessageId?: string; error?: string; uncertain?: boolean }>,
  options: { now?: string } = {},
): number {
  const at = options.now ?? new Date().toISOString();
  let written = 0;
  for (const row of rows) {
    const id = `delivery-${communityEmailHash(`${jobId}:${row.emailHash}`)}`;
    const baseline = readSharedRecordBaseline(workspaceRootPath, DELIVERIES_COLLECTION, id);
    const result = writeSharedRecord(workspaceRootPath, DELIVERIES_COLLECTION, id, {
      jobId,
      contactId: row.contactId,
      emailHash: row.emailHash,
      providerMessageId: row.providerMessageId,
      lastEvent: row.uncertain ? 'unknown' : row.error ? 'failed' : 'sent',
      lastEventAt: at,
      error: row.error,
    }, { machineId, now: at, baseline: baseline ?? undefined });
    if (result.status === 'conflict') throw new Error('Could not save email delivery evidence. Check Resend before retrying.');
    written += 1;
  }
  return written;
}

export function listDeliveries(
  workspaceRootPath: string,
  jobId?: string,
): CommunityDeliveryRecord[] {
  const dir = getRecordCollectionDir(workspaceRootPath, DELIVERIES_COLLECTION);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as CommunityDeliveryRecord;
        if (!parsed?.id || parsed.deletedAt) return [];
        return !jobId || parsed.jobId === jobId ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

/** Hash helper re-exported so callers do not reach into storage for it. */
export { communityEmailHash };
