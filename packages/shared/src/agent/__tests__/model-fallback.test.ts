import { describe, expect, test } from 'bun:test';
import { ERROR_CODES } from '../errors.ts';
import {
  classifyModelFallback,
  modelFallbackAttentionReason,
  ModelCooldownRegistry,
} from '../model-fallback.ts';

describe('model fallback failure policy', () => {
  test('classifies every ErrorCode exactly once', () => {
    expect(ERROR_CODES).toHaveLength(21);
    for (const code of ERROR_CODES) {
      expect(['fall-back', 'fall-back-and-flag', 'stop']).toContain(classifyModelFallback(code));
    }
  });

  test('stops deterministic request and MCP failures', () => {
    for (const code of [
      'invalid_request',
      'image_too_large',
      'response_too_large',
      'queued_message_replay_failed',
      'mcp_auth_required',
      'mcp_unreachable',
    ] as const) expect(classifyModelFallback(code)).toBe('stop');
  });

  test('allows unknown errors to consume only one fallback entry', () => {
    expect(classifyModelFallback('unknown_error')).toBe('fall-back');
    expect(classifyModelFallback('unknown_error', { unknownFallbackAlreadyUsed: true })).toBe('stop');
  });

  test('flags authentication and billing failures without cooling them down', () => {
    expect(modelFallbackAttentionReason('invalid_api_key')).toBe('connection-auth-failed');
    expect(modelFallbackAttentionReason('expired_oauth_token')).toBe('connection-auth-failed');
    expect(modelFallbackAttentionReason('billing_error')).toBe('connection-billing-failed');

    const registry = new ModelCooldownRegistry(() => 1_000);
    expect(registry.markFailure({ connectionSlug: 'a', model: 'm', reason: 'invalid_api_key' })).toBeUndefined();
    expect(registry.isCoolingDown('a', 'm')).toBeFalse();
  });
});

describe('model fallback cooldown registry', () => {
  test('uses five minutes by default and expires in memory', () => {
    let now = 1_000;
    const registry = new ModelCooldownRegistry(() => now);
    const entry = registry.markFailure({ connectionSlug: 'a', model: 'm', reason: 'service_error' });
    expect(Date.parse(entry!.until) - now).toBe(5 * 60 * 1000);
    expect(registry.isCoolingDown('a', 'm')).toBeTrue();
    now += 5 * 60 * 1000;
    expect(registry.isCoolingDown('a', 'm')).toBeFalse();
  });

  test('honors Retry-After while clamping it to fifteen minutes', () => {
    const registry = new ModelCooldownRegistry(() => 5_000);
    const short = registry.markFailure({
      connectionSlug: 'a',
      model: 'short',
      reason: 'rate_limited',
      retryAfterMs: 12_000,
    });
    const long = registry.markFailure({
      connectionSlug: 'a',
      model: 'long',
      reason: 'rate_limited',
      retryAfterMs: 60 * 60 * 1000,
    });
    expect(Date.parse(short!.until) - 5_000).toBe(12_000);
    expect(Date.parse(long!.until) - 5_000).toBe(15 * 60 * 1000);
  });

  test('honors Retry-After zero as immediately available', () => {
    const registry = new ModelCooldownRegistry(() => 5_000);
    registry.markFailure({
      connectionSlug: 'a',
      model: 'ready',
      reason: 'rate_limited',
      retryAfterMs: 0,
    });
    expect(registry.isCoolingDown('a', 'ready')).toBeFalse();
  });

  test('manual clear overrides a live cooldown', () => {
    const registry = new ModelCooldownRegistry(() => 1_000);
    registry.markFailure({ connectionSlug: 'a', model: 'm', reason: 'provider_error' });
    registry.clear('a', 'm');
    expect(registry.isCoolingDown('a', 'm')).toBeFalse();
  });

  test('vision incompatibility does not cool a model for later text work', () => {
    const registry = new ModelCooldownRegistry(() => 1_000);
    expect(registry.markFailure({
      connectionSlug: 'text-model',
      model: 'model-a',
      reason: 'unsupported_input',
    })).toBeUndefined();
    expect(registry.isCoolingDown('text-model', 'model-a')).toBeFalse();
  });
});
