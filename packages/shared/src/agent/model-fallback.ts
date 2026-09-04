import type { ErrorCode } from './errors.ts';

export type ModelFallbackFailureCode = ErrorCode | 'timeout' | 'unsupported_input';
export type ModelFallbackDecision = 'fall-back' | 'fall-back-and-flag' | 'stop';

const FALLBACK_DECISIONS = {
  invalid_api_key: 'fall-back-and-flag',
  invalid_credentials: 'fall-back-and-flag',
  response_too_large: 'stop',
  expired_oauth_token: 'fall-back-and-flag',
  token_expired: 'fall-back-and-flag',
  rate_limited: 'fall-back',
  service_error: 'fall-back',
  service_unavailable: 'fall-back',
  network_error: 'fall-back',
  proxy_error: 'fall-back',
  mcp_auth_required: 'stop',
  mcp_unreachable: 'stop',
  billing_error: 'fall-back-and-flag',
  model_no_tool_support: 'fall-back',
  invalid_model: 'fall-back',
  data_policy_error: 'fall-back',
  invalid_request: 'stop',
  image_too_large: 'stop',
  provider_error: 'fall-back',
  queued_message_replay_failed: 'stop',
  unknown_error: 'fall-back',
} as const satisfies Record<ErrorCode, ModelFallbackDecision>;

export function classifyModelFallback(
  code: ModelFallbackFailureCode,
  options: { unknownFallbackAlreadyUsed?: boolean } = {},
): ModelFallbackDecision {
  if (code === 'timeout' || code === 'unsupported_input') return 'fall-back';
  if (code === 'unknown_error' && options.unknownFallbackAlreadyUsed) return 'stop';
  return FALLBACK_DECISIONS[code];
}

export function modelFallbackAttentionReason(
  code: ModelFallbackFailureCode,
): 'connection-auth-failed' | 'connection-billing-failed' | undefined {
  if (
    code === 'invalid_api_key'
    || code === 'invalid_credentials'
    || code === 'expired_oauth_token'
    || code === 'token_expired'
  ) return 'connection-auth-failed';
  if (code === 'billing_error') return 'connection-billing-failed';
  return undefined;
}

export interface ModelCooldown {
  connectionSlug: string;
  model: string;
  until: string;
  reason: ModelFallbackFailureCode;
  observedAt: string;
}

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

function cooldownKey(connectionSlug: string, model: string): string {
  return `${connectionSlug}\u0000${model}`;
}

export class ModelCooldownRegistry {
  private readonly entries = new Map<string, ModelCooldown>();

  constructor(private readonly now: () => number = Date.now) {}

  markFailure(input: {
    connectionSlug: string;
    model: string;
    reason: ModelFallbackFailureCode;
    retryAfterMs?: number;
  }): ModelCooldown | undefined {
    // Input compatibility is not provider health; text work may still succeed.
    if (input.reason === 'unsupported_input') return undefined;
    const decision = classifyModelFallback(input.reason);
    if (decision !== 'fall-back') return undefined;

    const observedAtMs = this.now();
    const requestedMs = input.reason === 'rate_limited' && Number.isFinite(input.retryAfterMs)
      ? Math.max(0, input.retryAfterMs ?? 0)
      : DEFAULT_COOLDOWN_MS;
    const durationMs = input.reason === 'rate_limited'
      ? Math.min(requestedMs, MAX_RATE_LIMIT_COOLDOWN_MS)
      : DEFAULT_COOLDOWN_MS;
    const entry: ModelCooldown = {
      connectionSlug: input.connectionSlug,
      model: input.model,
      until: new Date(observedAtMs + durationMs).toISOString(),
      reason: input.reason,
      observedAt: new Date(observedAtMs).toISOString(),
    };
    this.entries.set(cooldownKey(input.connectionSlug, input.model), entry);
    return entry;
  }

  get(connectionSlug: string, model: string): ModelCooldown | undefined {
    const key = cooldownKey(connectionSlug, model);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.parse(entry.until) <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  isCoolingDown(connectionSlug: string, model: string): boolean {
    return this.get(connectionSlug, model) !== undefined;
  }

  clear(connectionSlug: string, model: string): void {
    this.entries.delete(cooldownKey(connectionSlug, model));
  }

  clearAll(): void {
    this.entries.clear();
  }
}

/** Process-local by design. Cooldowns never persist into user config. */
export const modelCooldownRegistry = new ModelCooldownRegistry();
