import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { handleMediaProviderRequest } from './media-provider-request.ts';

let root: string;
let originalFetch: typeof globalThis.fetch;
let originalFalKey: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'media-provider-request-'));
  originalFetch = globalThis.fetch;
  originalFalKey = process.env.FAL_API_KEY;
  delete process.env.FAL_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalFalKey === undefined) delete process.env.FAL_API_KEY;
  else process.env.FAL_API_KEY = originalFalKey;
  rmSync(root, { recursive: true, force: true });
});

function makeCtx(): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath: root,
    workingDirectory: root,
    get sourcesPath() {
      return join(root, 'sources');
    },
    get skillsPath() {
      return join(root, 'skills');
    },
    plansFolderPath: join(root, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: existsSync,
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
  } as SessionToolContext;
}

describe('media_provider_request', () => {
  test('reports missing provider key before making a request', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof globalThis.fetch;

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'fal-ai/flux/dev',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Missing Fal key');
    expect(called).toBe(false);
  });

  test('calls provider with saved key and downloads returned media URLs', async () => {
    process.env.FAL_API_KEY = 'fal-test-key';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('cdn.example.com')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example.com/result.png' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'fal-ai/flux/dev',
      body: { prompt: 'album cover' },
      outputDir: '.artifacts/generated',
      fileNamePrefix: 'cover',
    });

    expect(result.isError).toBe(false);
    expect(calls[0]!.url).toBe('https://queue.fal.run/fal-ai/flux/dev');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Key fal-test-key');
    expect(calls[1]!.url).toBe('https://cdn.example.com/result.png');
    const structured = result.structuredContent as { downloaded: Array<{ path: string }> };
    expect(structured.downloaded.length).toBe(1);
    expect(structured.downloaded[0]!.path).toContain('.artifacts/generated/cover-01.png');
    expect(existsSync(structured.downloaded[0]!.path)).toBe(true);
  });

  test('rejects full URLs outside the selected provider host', async () => {
    process.env.FAL_API_KEY = 'fal-test-key';

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'https://evilfal.ai/run',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Invalid provider path or URL');
  });

  test('refuses to download media from private hosts', async () => {
    process.env.FAL_API_KEY = 'fal-test-key';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('queue.fal.run')) {
        return new Response(JSON.stringify({ images: [{ url: 'http://127.0.0.1/result.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as unknown as typeof globalThis.fetch;

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'fal-ai/flux/dev',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Refusing to download media from local or private network hosts');
  });

  test('refuses oversized media downloads from content-length', async () => {
    process.env.FAL_API_KEY = 'fal-test-key';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('queue.fal.run')) {
        return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example.com/result.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(60 * 1024 * 1024),
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'fal-ai/flux/dev',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Media download is too large');
  });

  test('refuses unsupported download content types', async () => {
    process.env.FAL_API_KEY = 'fal-test-key';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('queue.fal.run')) {
        return new Response(JSON.stringify({ output: 'https://cdn.example.com/download' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as typeof globalThis.fetch;

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'fal-ai/flux/dev',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Refusing to download unsupported media type');
  });

  test('refuses to download too many returned media URLs at once', async () => {
    process.env.FAL_API_KEY = 'fal-test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({
      images: Array.from({ length: 9 }, (_, index) => ({ url: `https://cdn.example.com/result-${index}.png` })),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch;

    const result = await handleMediaProviderRequest(makeCtx(), {
      provider: 'fal',
      path: 'fal-ai/flux/dev',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('too many media URLs');
  });
});
