import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { OAUTH_RELAY_CALLBACK_URL, isOAuthRelayState } from '../../auth/oauth-relay.ts';
import {
  findReusableGoogleOAuthClientConfig,
  resolveGoogleOAuthClientConfig,
  SourceCredentialManager,
} from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

function createApiSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'gmail-test',
      name: 'Gmail Test',
      type: 'api',
      provider: 'google',
      enabled: true,
      api: {
        baseUrl: 'https://gmail.googleapis.com/',
        authType: 'bearer',
        googleService: 'gmail',
        googleOAuthClientId: 'test-client-id',
        googleOAuthClientSecret: 'test-client-secret',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/gmail-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

function createMcpSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-id',
      slug: 'mcp-test',
      name: 'MCP Test',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/mcp-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
  };
}

describe('SourceCredentialManager.prepareOAuth relay wrapping', () => {
  const credManager = new SourceCredentialManager();
  let originalClientSecret: string | undefined;
  // Without restoring this, every later test file in the process inherits a
  // stub that 404s every request it does not recognise.
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    originalClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secure-test-client-secret';
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(Response.json({
          authorization_endpoint: 'https://example.com/oauth/authorize',
          token_endpoint: 'https://example.com/oauth/token',
        }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalClientSecret === undefined) {
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalClientSecret;
    }
  });

  it('uses the provided WebUI redirect URI when no Runner relay is configured', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'https://runner.example/api/oauth/callback',
    });

    expect(OAUTH_RELAY_CALLBACK_URL).toBe('');
    expect(result.redirectUri).toBe('https://runner.example/api/oauth/callback');
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://runner.example/api/oauth/callback');

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(isOAuthRelayState(state!)).toBe(false);
  });

  it('uses the provided desktop callback URL when no Runner relay is configured', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), {
      callbackUrl: 'http://localhost:6477/callback',
    });

    expect(OAUTH_RELAY_CALLBACK_URL).toBe('');
    expect(result.redirectUri).toBe('http://localhost:6477/callback');
    expect(result.state).toBeTruthy();

    const authUrl = new URL(result.authUrl);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:6477/callback');

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(isOAuthRelayState(state!)).toBe(false);
  });

  it('passes the provided redirect URI into MCP prepare-time metadata flow when no Runner relay is configured', async () => {
    const result = await credManager.prepareOAuth(createMcpSource(), {
      callbackUrl: 'https://runner.example/api/oauth/callback',
    });

    expect(OAUTH_RELAY_CALLBACK_URL).toBe('');
    expect(result.redirectUri).toBe('https://runner.example/api/oauth/callback');

    const authUrl = new URL(result.authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://example.com/oauth/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://runner.example/api/oauth/callback');

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(isOAuthRelayState(state!)).toBe(false);
  });
});

describe('Google OAuth client configuration', () => {
  it('uses OAuth client credentials saved through secure Settings', async () => {
    const requested: string[] = [];
    const result = await resolveGoogleOAuthClientConfig(
      createApiSource({
        api: {
          baseUrl: 'https://gmail.googleapis.com/',
          authType: 'oauth',
          googleService: 'gmail',
        },
      }),
      async (name) => {
        requested.push(name);
        return name === 'GOOGLE_OAUTH_CLIENT_ID' ? 'settings-client-id' : 'settings-client-secret';
      },
      join(tmpdir(), `missing-google-oauth-config-${Date.now()}`),
    );

    expect(result).toEqual({
      clientId: 'settings-client-id',
      clientSecret: 'settings-client-secret',
    });
    expect(requested).toEqual(['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']);
  });

  it('never reads the Google client secret from plaintext source config', async () => {
    const requested: string[] = [];
    const result = await resolveGoogleOAuthClientConfig(
      createApiSource({
        api: {
          baseUrl: 'https://gmail.googleapis.com/',
          authType: 'oauth',
          googleService: 'gmail',
          googleOAuthClientId: 'public-client-id',
          googleOAuthClientSecret: 'plaintext-secret-that-must-be-ignored',
        },
      }),
      async (name) => {
        requested.push(name);
        return name === 'GOOGLE_OAUTH_CLIENT_SECRET' ? 'secure-client-secret' : null;
      },
      join(tmpdir(), `missing-google-oauth-config-${Date.now()}`),
    );

    expect(result).toEqual({
      clientId: 'public-client-id',
      clientSecret: 'secure-client-secret',
    });
    expect(requested).toEqual(['GOOGLE_OAUTH_CLIENT_SECRET']);
  });

  it('reuses only the non-secret client ID from another workspace source', () => {
    const configDir = join(tmpdir(), `runneros-google-oauth-config-${Date.now()}`);
    const sourceDir = join(configDir, 'workspaces', 'campaign-a', 'sources', 'google-calendar');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      provider: 'google',
      api: {
        baseUrl: 'https://www.googleapis.com/calendar/v3',
        googleService: 'calendar',
        googleOAuthClientId: 'shared-client-id',
        googleOAuthClientSecret: 'shared-client-secret',
      },
    }));

    try {
      const result = findReusableGoogleOAuthClientConfig(createApiSource({
        slug: 'google-calendar',
        api: {
          baseUrl: 'https://www.googleapis.com/calendar/v3',
          authType: 'oauth',
          googleService: 'calendar',
        },
      }), configDir);

      expect(result).toEqual({
        clientId: 'shared-client-id',
      });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
