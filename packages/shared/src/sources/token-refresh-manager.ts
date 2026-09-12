/**
 * TokenRefreshManager - Handles OAuth token refresh with rate limiting.
 *
 * This class encapsulates token refresh logic following SOLID principles:
 * - Single Responsibility: Only handles token refresh orchestration
 * - Open/Closed: Delegates to SourceCredentialManager for actual refresh
 * - Dependency Inversion: Takes credential manager as dependency
 *
 * Rate limiting is instance-scoped, not module-level, making it:
 * - Testable (can create fresh instances)
 * - Session-isolated (each session can have its own manager)
 */

import { isRefreshableSource, hasRenewEndpoint, type LoadedSource } from './types.ts';
import type { SourceCredentialManager } from './credential-manager.ts';
import { createHash } from 'node:crypto';
import type { StoredCredential } from '../credentials/types.ts';
import { SourceAuthSupersededError } from './credential-manager.ts';

/** Default cooldown after failed refresh (5 minutes) */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export interface TokenRefreshResult {
  /** Whether the token was successfully refreshed */
  success: boolean;
  /** The fresh token if successful */
  token?: string;
  /** Error reason if failed */
  reason?: string;
  /** Whether this was skipped due to rate limiting */
  rateLimited?: boolean;
}

export interface RefreshManagerOptions {
  /** Cooldown period after failed refresh (default: 5 minutes) */
  cooldownMs?: number;
  /** Logger function for debug output */
  log?: (message: string) => void;
}

export class TokenRefreshManager {
  private failedAttempts = new Map<string, number>();
  private failedCredentials = new Map<string, string>();
  private cooldownMs: number;
  private log: (message: string) => void;
  private credManager: SourceCredentialManager;

  constructor(
    credManager: SourceCredentialManager,
    options: RefreshManagerOptions = {}
  ) {
    this.credManager = credManager;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.log = options.log ?? (() => {});
  }

  /**
   * Check if a source is in cooldown after a recent failed refresh.
   */
  isInCooldown(sourceSlug: string): boolean {
    const lastFailure = this.failedAttempts.get(sourceSlug);
    if (!lastFailure) return false;
    return Date.now() - lastFailure < this.cooldownMs;
  }

  /**
   * Record a failed refresh attempt for rate limiting.
   */
  private recordFailure(sourceSlug: string, identity: string): void {
    this.failedAttempts.set(sourceSlug, Date.now());
    this.failedCredentials.set(sourceSlug, identity);
  }

  /**
   * Clear the failure record when refresh succeeds.
   */
  private clearFailure(sourceSlug: string): void {
    this.failedAttempts.delete(sourceSlug);
    this.failedCredentials.delete(sourceSlug);
  }

  /**
   * Clear cooldown for a source (e.g. after successful re-authentication).
   */
  clearCooldown(sourceSlug: string): void {
    this.failedAttempts.delete(sourceSlug);
    this.failedCredentials.delete(sourceSlug);
  }

  /**
   * Reset all rate limiting state (useful for testing).
   */
  reset(): void {
    this.failedAttempts.clear();
    this.failedCredentials.clear();
  }

  private credentialIdentity(source: LoadedSource, credential: StoredCredential | null): string {
    return createHash('sha256').update(JSON.stringify({
      workspaceId: source.workspaceId, tier: source.tier, provider: source.config.provider,
      api: source.config.api, mcp: source.config.mcp, credential,
    })).digest('hex');
  }

  private async loadCurrentCredential(source: LoadedSource): Promise<StoredCredential | null> {
    const credential = await this.credManager.loadEffective(source);
    const failedIdentity = this.failedCredentials.get(source.config.slug);
    if (failedIdentity && failedIdentity !== this.credentialIdentity(source, credential)) {
      this.clearFailure(source.config.slug);
    }
    return credential;
  }

  /**
   * Check if a source needs token refresh.
   * Returns true if the token is expired or expiring soon (within 5 min).
   */
  async needsRefresh(source: LoadedSource): Promise<boolean> {
    const cred = await this.loadCurrentCredential(source);
    if (!cred) return false;
    // Renew-endpoint sources don't need a separate refreshToken —
    // they use the current access token for renewal.
    if (!cred.refreshToken && !hasRenewEndpoint(source)) return false;
    // If no expiresAt, we can't determine token lifetime — proactively refresh.
    // This handles credentials stored before expiresAt defaulting was added.
    // After refresh, the new credential will have expiresAt set, preventing refresh every turn.
    if (!cred.expiresAt) return true;
    return this.credManager.isExpired(cred) || this.credManager.needsRefresh(cred);
  }

  /**
   * Ensure a source has a fresh token, refreshing if needed.
   * This is the single entry point for token refresh (DRY principle).
   *
   * @param source - The source to refresh
   * @returns Result with success status, token, or error reason
   */
  async ensureFreshToken(source: LoadedSource): Promise<TokenRefreshResult> {
    const slug = source.config.slug;

    // Load credential and check if refresh needed
    const cred = await this.loadCurrentCredential(source);

    // Non-refreshable tokens (e.g. Slack) — return as-is.
    // Renew-endpoint sources are refreshable even without a separate refreshToken.
    if (cred?.value && !cred.refreshToken && !hasRenewEndpoint(source)) {
      this.clearFailure(slug);
      return { success: true, token: cred.value };
    }

    // If credential exists, has a known expiry, and isn't near expiry, return it as-is.
    // Missing expiresAt means we can't determine lifetime — fall through to refresh
    // so the new credential gets a proper expiresAt (matching needsRefresh() logic).
    if (cred?.value && cred.expiresAt && !this.credManager.isExpired(cred) && !this.credManager.needsRefresh(cred)) {
      this.clearFailure(slug);
      return {
        success: true,
        token: cred.value,
      };
    }

    // Check rate limiting
    if (this.isInCooldown(slug)) {
      this.log(`[TokenRefresh] Skipping ${slug} - in cooldown after recent failure`);
      return {
        success: false,
        rateLimited: true,
        reason: 'Rate limited after recent failure',
      };
    }

    // Need to refresh
    this.log(`[TokenRefresh] Refreshing token for ${slug}`);

    try {
      const token = await this.credManager.refresh(source);

      if (token) {
        this.log(`[TokenRefresh] Successfully refreshed token for ${slug}`);
        this.clearFailure(slug);

        // Credential manager commits authentication status under the same ownership fence.

        return { success: true, token };
      } else {
        const reason = 'Refresh returned null';
        this.log(`[TokenRefresh] ${reason} for ${slug}`);
        this.recordFailure(slug, this.credentialIdentity(source, cred));
        return { success: false, reason };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log(`[TokenRefresh] Failed for ${slug}: ${reason}`);
      if (err instanceof SourceAuthSupersededError) return { success: false, reason };
      this.recordFailure(slug, this.credentialIdentity(source, cred));
      return { success: false, reason };
    }
  }

  /**
   * Get all refreshable sources that need token refresh.
   * Includes MCP OAuth, API OAuth (Google, Slack, Microsoft), and renew-endpoint sources.
   * Filters out sources in cooldown.
   */
  async getSourcesNeedingRefresh(sources: LoadedSource[]): Promise<LoadedSource[]> {
    // Filter to sources that can auto-refresh (OAuth + renew-endpoint)
    const refreshableSources = sources.filter(isRefreshableSource);

    if (refreshableSources.length === 0) {
      return [];
    }

    // Check each source in parallel
    const results = await Promise.all(
      refreshableSources.map(async (source) => {
        const needsRefresh = await this.needsRefresh(source);
        if (this.isInCooldown(source.config.slug)) {
          this.log(`[TokenRefresh] Skipping ${source.config.slug} - in cooldown`);
          return { source, needsRefresh: false };
        }

        return { source, needsRefresh };
      })
    );

    return results
      .filter(({ needsRefresh }) => needsRefresh)
      .map(({ source }) => source);
  }

  /**
   * Refresh multiple sources in parallel.
   * Returns list of sources that were successfully refreshed and list of failures.
   */
  async refreshSources(sources: LoadedSource[]): Promise<{
    refreshed: LoadedSource[];
    failed: Array<{ source: LoadedSource; reason: string }>;
  }> {
    const results = await Promise.all(
      sources.map(async (source) => {
        const result = await this.ensureFreshToken(source);
        return { source, result };
      })
    );

    const refreshed: LoadedSource[] = [];
    const failed: Array<{ source: LoadedSource; reason: string }> = [];

    for (const { source, result } of results) {
      if (result.success) {
        refreshed.push(source);
      } else if (!result.rateLimited) {
        failed.push({ source, reason: result.reason || 'Unknown error' });
      }
    }

    return { refreshed, failed };
  }
}

/**
 * Create a token getter function for refreshable API sources (OAuth or renew-endpoint).
 * This wraps the refresh manager for use with the server builder.
 */
export function createTokenGetter(
  refreshManager: TokenRefreshManager,
  source: LoadedSource
): () => Promise<string> {
  return async () => {
    const result = await refreshManager.ensureFreshToken(source);
    if (result.success && result.token) {
      return result.token;
    }
    throw new Error(result.reason || `No token for ${source.config.slug}`);
  };
}
