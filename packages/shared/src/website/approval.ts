/**
 * Approval tiers for site changes (spec 41).
 *
 * Two human decisions exist in the whole loop: publishing a public site
 * change, and sending a fan email. Everything else runs free. Trusted mode
 * retires the first one for content-only changes after the system has earned
 * it, and any rollback takes it back.
 *
 * Pure module: takes a manifest, returns a manifest or a decision. No I/O.
 */

import type { ApprovalTier } from './receipts.ts';
import type { ChangeClass, WebsiteManifest } from './types.ts';

/** Consecutive clean publishes before trusted mode is offered. */
export const TRUSTED_ELIGIBILITY_THRESHOLD = 5;

export interface ApprovalDecision {
  tier: ApprovalTier;
  /** True when a human must press Approve before this change can publish. */
  requiresApproval: boolean;
  reason: string;
}

/**
 * What does publishing this change class require right now?
 *
 * Design changes are never trusted, so a template or theme edit always stops
 * for a human even when the artist has granted trusted mode for content.
 */
export function resolveApprovalTier(
  manifest: WebsiteManifest,
  changeClass: ChangeClass,
): ApprovalDecision {
  if (changeClass === 'design') {
    return {
      tier: 'one-click',
      requiresApproval: true,
      reason: 'Design changes always need your approval.',
    };
  }
  if (manifest.publishPolicy.contentOnly === 'auto' && manifest.publishPolicy.trustedGrantedAt) {
    return {
      tier: 'trusted',
      requiresApproval: false,
      reason: 'Trusted mode is on for content-only changes.',
    };
  }
  return {
    tier: 'one-click',
    requiresApproval: true,
    reason: 'Content changes need one approval before they go live.',
  };
}

/** Trusted mode can be offered, but only the artist may turn it on. */
export function isTrustedModeEligible(manifest: WebsiteManifest): boolean {
  return Boolean(manifest.publishPolicy.trustedEligibleAt)
    && !manifest.publishPolicy.trustedGrantedAt;
}

/**
 * Count an approved publish that was not rolled back. At the threshold the
 * manifest becomes eligible, which surfaces the offer on the Website page.
 * Reaching eligibility never enables trusted mode on its own.
 */
export function recordCleanPublish(
  manifest: WebsiteManifest,
  options: { now?: string } = {},
): WebsiteManifest {
  const streak = (manifest.publishPolicy.cleanPublishStreak ?? 0) + 1;
  const eligible = streak >= TRUSTED_ELIGIBILITY_THRESHOLD;
  return {
    ...manifest,
    publishPolicy: {
      ...manifest.publishPolicy,
      cleanPublishStreak: streak,
      ...(eligible && !manifest.publishPolicy.trustedEligibleAt
        ? { trustedEligibleAt: options.now ?? new Date().toISOString() }
        : {}),
    },
  };
}

/**
 * A rollback is the signal that the loop published something the artist did
 * not want. Trusted mode goes off, the streak resets, and eligibility has to
 * be earned again from zero.
 */
export function revokeTrustedMode(
  manifest: WebsiteManifest,
  options: { now?: string } = {},
): WebsiteManifest {
  const at = options.now ?? new Date().toISOString();
  return {
    ...manifest,
    publishPolicy: {
      ...manifest.publishPolicy,
      contentOnly: 'needs-you',
      cleanPublishStreak: 0,
      trustedEligibleAt: undefined,
      trustedGrantedAt: undefined,
      trustedRevokedAt: at,
    },
  };
}

/** Only the Website page toggle calls this. Agents never can (spec 41). */
export function grantTrustedMode(
  manifest: WebsiteManifest,
  options: { now?: string } = {},
): WebsiteManifest {
  if (!isTrustedModeEligible(manifest)) {
    throw new Error(
      `Trusted mode needs ${TRUSTED_ELIGIBILITY_THRESHOLD} approved publishes with no rollback first.`,
    );
  }
  const at = options.now ?? new Date().toISOString();
  return {
    ...manifest,
    publishPolicy: {
      ...manifest.publishPolicy,
      contentOnly: 'auto',
      trustedGrantedAt: at,
      trustedRevokedAt: undefined,
    },
  };
}

export function disableTrustedMode(manifest: WebsiteManifest): WebsiteManifest {
  return {
    ...manifest,
    publishPolicy: {
      ...manifest.publishPolicy,
      contentOnly: 'needs-you',
      trustedGrantedAt: undefined,
    },
  };
}

export type ApprovalBindingFailure = 'no-approval' | 'hash-changed' | 'expired';

export interface ApprovalBinding {
  boundTo: string;
  approvedAt: string;
  expiresAt?: string;
}

/**
 * An approval covers one exact build hash. If the site was rebuilt between
 * the artist reading the card and pressing Publish, what they saw is not what
 * would ship, so the binding fails and the card says so.
 */
export function checkApprovalBinding(
  binding: ApprovalBinding | undefined,
  currentTarget: string,
  options: { now?: string } = {},
): { ok: true } | { ok: false; failure: ApprovalBindingFailure; message: string } {
  if (!binding) {
    return { ok: false, failure: 'no-approval', message: 'This change has not been approved yet.' };
  }
  if (binding.boundTo !== currentTarget) {
    return {
      ok: false,
      failure: 'hash-changed',
      message: 'The site changed after you approved it. Review the new preview and approve again.',
    };
  }
  const now = options.now ?? new Date().toISOString();
  if (binding.expiresAt && binding.expiresAt <= now) {
    return { ok: false, failure: 'expired', message: 'That approval expired. Review the preview and approve again.' };
  }
  return { ok: true };
}
