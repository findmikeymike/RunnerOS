export interface StoredPiOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export type PiTransportCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number };

const NATIVE_OAUTH_PROVIDERS = new Set(['openai-codex', 'github-copilot']);

/** Preserve native OAuth for subscription-backed providers understood by Pi. */
export function toPiTransportCredential(
  provider: string,
  credential: StoredPiOAuthCredential,
): PiTransportCredential {
  if (NATIVE_OAUTH_PROVIDERS.has(provider)) {
    return {
      type: 'oauth',
      access: credential.accessToken,
      refresh: credential.refreshToken ?? '',
      expires: credential.expiresAt ?? 0,
    };
  }

  return { type: 'api_key', key: credential.accessToken };
}
