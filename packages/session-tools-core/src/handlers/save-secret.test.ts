import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSaveSecret } from './save-secret.ts';

function createCtx(saveSecret?: SessionToolContext['saveSecret']): SessionToolContext {
  return {
    sessionId: 's1',
    workspacePath: '/tmp/workspace',
    get sourcesPath() {
      return '/tmp/workspace/sources';
    },
    get skillsPath() {
      return '/tmp/workspace/skills';
    },
    plansFolderPath: '/tmp/workspace/plans',
    callbacks: {
      onPlanSubmitted() {},
      onAuthRequest() {},
    },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    ...(saveSecret ? { saveSecret } : {}),
  };
}

describe('save_secret handler', () => {
  test('requires explicit confirmation before saving', async () => {
    const result = await handleSaveSecret(createCtx(async () => ({ ok: true })), {
      target: 'env',
      name: 'YOUTUBE_API_KEY',
      value: 'abc123',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('confirmed must be true');
  });

  test('saves normalized env secrets through context callback', async () => {
    let saved: unknown;
    const result = await handleSaveSecret(createCtx(async (input) => {
      saved = input;
      return { ok: true, target: input.target, name: input.name };
    }), {
      target: 'env',
      name: 'youtube_api_key',
      value: 'abc123',
      confirmed: true,
    });

    expect(result.isError).toBe(false);
    expect(saved).toEqual({
      target: 'env',
      name: 'YOUTUBE_API_KEY',
      value: 'abc123',
      confirmed: true,
    });
  });

  test('blocks password-like env secret names', async () => {
    const result = await handleSaveSecret(createCtx(async () => ({ ok: true })), {
      target: 'env',
      name: 'SPOTIFY_PASSWORD',
      value: 'abc123',
      confirmed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Do not save passwords');
  });

  test('requires sourceSlug for source targets', async () => {
    const result = await handleSaveSecret(createCtx(async () => ({ ok: true })), {
      target: 'source',
      value: 'abc123',
      confirmed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('sourceSlug is required');
  });
});
