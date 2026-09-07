import { describe, expect, test } from 'bun:test';
import {
  buildInworldBasicAuthorization,
  resolveInworldApiKey,
  resolveInworldVoiceId,
} from './inworld.ts';

describe('Inworld credential compatibility', () => {
  test('prefers the canonical saved API key and voice ID', async () => {
    const stored = new Map([
      ['INWORLD_API_KEY', 'canonical-key'],
      ['INWORLD_RUNTIME_KEY', 'legacy-key'],
      ['INWORLD_VOICE_ID', 'Dennis'],
      ['SQUAD_INWORLD_TTS_VOICE_ID', 'Ashley'],
    ]);
    const load = async (name: string) => stored.get(name) ?? null;

    expect(await resolveInworldApiKey(load, {})).toBe('canonical-key');
    expect(await resolveInworldVoiceId(load, {})).toBe('Dennis');
  });

  test('keeps legacy saved and environment aliases working', async () => {
    const none = async () => null;
    expect(await resolveInworldApiKey(none, { INWORLD_TTS_API_KEY: 'old-key' })).toBe('old-key');
    expect(await resolveInworldVoiceId(none, { SQUAD_INWORLD_TTS_VOICE_ID: 'Ashley' })).toBe('Ashley');
  });

  test('normalizes Base64, full Basic headers, and raw key-secret pairs', () => {
    expect(buildInworldBasicAuthorization('already-base64')).toBe('Basic already-base64');
    expect(buildInworldBasicAuthorization('Basic already-base64')).toBe('Basic already-base64');
    expect(buildInworldBasicAuthorization('key:secret')).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
  });
});
