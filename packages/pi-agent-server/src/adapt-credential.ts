/**
 * Adapts our wire credentials to the shapes the Pi SDK credential resolver accepts.
 *
 * Pi SDK 0.81 and later resolve stored credentials strictly by type: a stored
 * credential owns its provider, ambient and environment resolution is consulted
 * only when nothing is stored, and a credential type with no matching provider
 * auth handler resolves to undefined. Two of our wire shapes fall through that:
 *
 * - ChatGPT Plus and Pro (`openai-codex`) is OAuth-only in the SDK catalog, but
 *   we perform the OAuth exchange in the main process and ship the bearer access
 *   token as an `api_key`. Unadapted, every prompt fails with "No API key found
 *   for openai-codex".
 * - Bedrock `iam` credentials match no SDK credential type, and storing one
 *   shadows the ambient AWS environment variables we inject at spawn. Unadapted,
 *   the provider reports itself unconfigured and prompts fail the same way.
 *
 * Ported from craft-agents-oss v0.12.1 and v0.13.0. We were storing both shapes
 * verbatim, which was correct against older Pi SDKs and stopped being correct at
 * 0.81; we run 0.84, so both paths were affected.
 */

import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { Credential as PiSdkCredential } from '@earendil-works/pi-ai';

/** Credential union used in init and token_update messages from the main process. */
export type PiCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: 'iam'; accessKeyId: string; secretAccessKey: string; region?: string; sessionToken?: string };

let oauthOnlyProviderIdsCache: Set<string> | null = null;

/** Provider IDs whose SDK catalog entry declares `auth.oauth` but no `auth.apiKey`. */
function oauthOnlyProviderIds(): Set<string> {
  if (!oauthOnlyProviderIdsCache) {
    oauthOnlyProviderIdsCache = new Set(
      builtinProviders()
        .filter((p) => p.auth.oauth && !p.auth.apiKey)
        .map((p) => p.id),
    );
  }
  return oauthOnlyProviderIdsCache;
}

/**
 * Returns the credential to store for the provider, or null when nothing should
 * be stored and the provider must resolve ambiently.
 *
 * - A bearer token shipped as `api_key` for an OAuth-only provider is rewrapped
 *   as an oauth credential so the SDK's typed resolver accepts it. The far-future
 *   expiry keeps the SDK's own refresh path unreachable by design: the main
 *   process owns token refresh and re-injects fresh tokens via token_update.
 * - `iam` credentials are never stored. The SDK has no handler for the shape, and
 *   storing one blocks ambient resolution, while the AWS environment variables
 *   carrying the same keypair are already injected at subprocess spawn.
 *
 * Everything else passes through unchanged.
 */
export function adaptCredentialForPiSdk(provider: string, credential: PiCredential): PiSdkCredential | null {
  if (credential.type === 'api_key' && oauthOnlyProviderIds().has(provider)) {
    return { type: 'oauth', access: credential.key, refresh: '', expires: Number.MAX_SAFE_INTEGER };
  }
  if (credential.type === 'iam') {
    return null;
  }
  return credential as unknown as PiSdkCredential;
}
