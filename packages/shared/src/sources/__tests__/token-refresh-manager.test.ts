/**
 * Unit tests for TokenRefreshManager and isOAuthSource helper.
 *
 * Tests the proactive token refresh functionality that includes both:
 * - MCP OAuth sources (Linear, Notion, etc.)
 * - API OAuth sources (Google, Slack, Microsoft)
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { isOAuthSource, hasRenewEndpoint, isRefreshableSource, type LoadedSource, type FolderSourceConfig } from '../types.ts';
import { TokenRefreshManager } from '../token-refresh-manager.ts';
import { isSourceUsable } from '../storage.ts';
import type { SourceCredentialManager } from '../credential-manager.ts';

// Mock storage module to prevent disk I/O
const mockMarkLoadedSourceAuthenticated = mock((source: LoadedSource) => {
  Object.assign(source.config, {
    isAuthenticated: true,
    connectionStatus: 'connected' as const,
    connectionError: undefined,
  });
  return true;
});
mock.module('../storage.ts', () => ({
  markLoadedSourceAuthenticated: mockMarkLoadedSourceAuthenticated,
}));

/**
 * Helper to create a mock LoadedSource for testing
 */
function createMockSource(overrides: Partial<FolderSourceConfig>): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'test-id',
    name: 'Test Source',
    slug: 'test-source',
    enabled: true,
    provider: 'test',
    type: 'api',
    isAuthenticated: true,
    ...overrides,
  };

  return {
    config,
    guide: null,
    folderPath: '/mock/path',
    workspaceRootPath: '/mock/workspace',
    workspaceId: 'mock-workspace',
  };
}

describe('isOAuthSource', () => {
  describe('MCP OAuth sources', () => {
    test('returns true for MCP source with oauth authType', () => {
      const source = createMockSource({
        type: 'mcp',
        provider: 'linear',
        mcp: {
          url: 'https://linear.mcp.example.com',
          authType: 'oauth',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(true);
    });

    test('returns false for MCP source with bearer authType', () => {
      const source = createMockSource({
        type: 'mcp',
        provider: 'custom',
        mcp: {
          url: 'https://custom.mcp.example.com',
          authType: 'bearer',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(false);
    });

    test('returns false for MCP source with none authType', () => {
      const source = createMockSource({
        type: 'mcp',
        provider: 'public',
        mcp: {
          url: 'https://public.mcp.example.com',
          authType: 'none',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(false);
    });

    test('returns false for stdio MCP source (no authType)', () => {
      const source = createMockSource({
        type: 'mcp',
        provider: 'local-tool',
        mcp: {
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(false);
    });
  });

  describe('API OAuth sources', () => {
    test('returns true for Google provider (Gmail)', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'google',
        api: {
          baseUrl: 'https://gmail.googleapis.com/gmail/v1',
          authType: 'bearer',
          googleService: 'gmail',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(true);
    });

    test('returns true for Slack provider', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'slack',
        api: {
          baseUrl: 'https://slack.com/api',
          authType: 'bearer',
          slackService: 'full',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(true);
    });

    test('returns true for Microsoft provider', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'microsoft',
        api: {
          baseUrl: 'https://graph.microsoft.com/v1.0',
          authType: 'bearer',
          microsoftService: 'outlook',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(true);
    });

    test('returns false for non-OAuth API provider', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'custom-api',
        api: {
          baseUrl: 'https://api.example.com',
          authType: 'bearer',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(false);
    });

    test('returns false for API source with header auth', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'custom-api',
        api: {
          baseUrl: 'https://api.example.com',
          authType: 'header',
          headerName: 'X-API-Key',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(false);
    });
  });

  describe('Authentication state', () => {
    test('returns true for unauthenticated MCP OAuth source (type check only)', () => {
      const source = createMockSource({
        type: 'mcp',
        provider: 'linear',
        mcp: {
          url: 'https://linear.mcp.example.com',
          authType: 'oauth',
        },
        isAuthenticated: false,
      });

      expect(isOAuthSource(source)).toBe(true);
    });

    test('returns true for unauthenticated Google source (type check only)', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'google',
        api: {
          baseUrl: 'https://gmail.googleapis.com/gmail/v1',
          authType: 'bearer',
        },
        isAuthenticated: false,
      });

      expect(isOAuthSource(source)).toBe(true);
    });

    test('returns true even if isAuthenticated is undefined (type check only)', () => {
      const source = createMockSource({
        type: 'api',
        provider: 'google',
        api: {
          baseUrl: 'https://gmail.googleapis.com/gmail/v1',
          authType: 'bearer',
        },
      });
      // Remove isAuthenticated to simulate undefined
      delete (source.config as Partial<FolderSourceConfig>).isAuthenticated;

      expect(isOAuthSource(source)).toBe(true);
    });
  });

  describe('Local sources', () => {
    test('returns false for local filesystem source', () => {
      const source = createMockSource({
        type: 'local',
        provider: 'filesystem',
        local: {
          path: '/Users/test/documents',
        },
        isAuthenticated: true,
      });

      expect(isOAuthSource(source)).toBe(false);
    });
  });
});

describe('OAuth source filtering', () => {
  test('filters mixed sources to only OAuth sources', () => {
    const sources: LoadedSource[] = [
      // MCP OAuth - should be included
      createMockSource({
        slug: 'linear',
        type: 'mcp',
        provider: 'linear',
        mcp: { url: 'https://linear.example.com', authType: 'oauth' },
        isAuthenticated: true,
      }),
      // Google API - should be included
      createMockSource({
        slug: 'gmail',
        type: 'api',
        provider: 'google',
        api: { baseUrl: 'https://gmail.googleapis.com', authType: 'bearer' },
        isAuthenticated: true,
      }),
      // Non-OAuth API - should NOT be included
      createMockSource({
        slug: 'custom-api',
        type: 'api',
        provider: 'custom',
        api: { baseUrl: 'https://api.custom.com', authType: 'bearer' },
        isAuthenticated: true,
      }),
      // MCP bearer - should NOT be included
      createMockSource({
        slug: 'mcp-bearer',
        type: 'mcp',
        provider: 'custom',
        mcp: { url: 'https://custom.mcp.com', authType: 'bearer' },
        isAuthenticated: true,
      }),
      // Slack - should be included
      createMockSource({
        slug: 'slack',
        type: 'api',
        provider: 'slack',
        api: { baseUrl: 'https://slack.com/api', authType: 'bearer' },
        isAuthenticated: true,
      }),
      // Unauthenticated Google - should be included (isOAuthSource is a type check)
      createMockSource({
        slug: 'google-calendar',
        type: 'api',
        provider: 'google',
        api: { baseUrl: 'https://calendar.googleapis.com', authType: 'bearer' },
        isAuthenticated: false,
      }),
    ];

    const oauthSources = sources.filter(isOAuthSource);

    expect(oauthSources.length).toBe(4);
    expect(oauthSources.map(s => s.config.slug)).toEqual(['linear', 'gmail', 'slack', 'google-calendar']);
  });
});

// --- TokenRefreshManager tests ---

function createMockCredManager(overrides: Partial<SourceCredentialManager> = {}): SourceCredentialManager {
  const manager = {
    load: mock(() => Promise.resolve(null)),
    refresh: mock(() => Promise.resolve(null)),
    isExpired: mock(() => true),
    needsRefresh: mock(() => true),
    markSourceNeedsReauth: mock(() => {}),
    ...overrides,
  } as unknown as SourceCredentialManager;
  manager.loadEffective = overrides.loadEffective ?? manager.load;
  return manager;
}

describe('TokenRefreshManager', () => {
  beforeEach(() => {
    mockMarkLoadedSourceAuthenticated.mockClear();
  });

  describe('needsRefresh', () => {
    test('returns false when credential has no refreshToken', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          expiresAt: Date.now() - 60_000, // expired
          // no refreshToken
        })),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        type: 'mcp',
        provider: 'linear',
        mcp: { url: 'https://linear.example.com', authType: 'oauth' },
        isAuthenticated: false,
      });

      expect(await manager.needsRefresh(source)).toBe(false);
    });

    test('returns true when credential has refreshToken and is expired', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          refreshToken: 'refresh-token-123',
          expiresAt: Date.now() - 60_000,
        })),
        isExpired: mock(() => true),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        type: 'api',
        provider: 'google',
        api: { baseUrl: 'https://gmail.googleapis.com', authType: 'bearer' },
        isAuthenticated: true,
      });

      expect(await manager.needsRefresh(source)).toBe(true);
    });
  });

  describe('getSourcesNeedingRefresh', () => {
    test('includes isAuthenticated: false source with refresh token', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          refreshToken: 'refresh-123',
          expiresAt: Date.now() - 60_000,
        })),
        isExpired: mock(() => true),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        slug: 'craft-mcp',
        type: 'mcp',
        provider: 'craft',
        mcp: { url: 'https://mcp.craft.do/my/mcp', authType: 'oauth' },
        isAuthenticated: false,
      });

      const result = await manager.getSourcesNeedingRefresh([source]);
      expect(result.length).toBe(1);
      expect(result[0]!.config.slug).toBe('craft-mcp');
    });

    test('excludes source without refresh token', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          expiresAt: Date.now() - 60_000,
          // no refreshToken
        })),
        isExpired: mock(() => true),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        slug: 'craft-mcp',
        type: 'mcp',
        provider: 'craft',
        mcp: { url: 'https://mcp.craft.do/my/mcp', authType: 'oauth' },
        isAuthenticated: false,
      });

      const result = await manager.getSourcesNeedingRefresh([source]);
      expect(result.length).toBe(0);
    });
  });

  describe('ensureFreshToken', () => {
    test('restores isAuthenticated on successful refresh', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          refreshToken: 'refresh-123',
          expiresAt: Date.now() - 60_000,
        })),
        isExpired: mock(() => true),
        refresh: mock(async (source: LoadedSource) => { mockMarkLoadedSourceAuthenticated(source); return 'new-fresh-token'; }),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        slug: 'craft-mcp',
        type: 'mcp',
        provider: 'craft',
        mcp: { url: 'https://mcp.craft.do/my/mcp', authType: 'oauth' },
        isAuthenticated: false,
        connectionStatus: 'needs_auth',
        connectionError: 'Token expired',
      });

      const result = await manager.ensureFreshToken(source);

      expect(result.success).toBe(true);
      expect(result.token).toBe('new-fresh-token');
      expect(isSourceUsable(source)).toBe(true);
      expect(source.config.connectionStatus).toBe('connected');
      expect(source.config.connectionError).toBeUndefined();
      expect(mockMarkLoadedSourceAuthenticated).toHaveBeenCalledWith(source);
    });

    test('does NOT restore auth on failed refresh', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          refreshToken: 'refresh-123',
          expiresAt: Date.now() - 60_000,
        })),
        isExpired: mock(() => true),
        refresh: mock(() => Promise.resolve(null)),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        slug: 'craft-mcp',
        type: 'mcp',
        provider: 'craft',
        mcp: { url: 'https://mcp.craft.do/my/mcp', authType: 'oauth' },
        isAuthenticated: false,
        connectionStatus: 'needs_auth',
      });

      const result = await manager.ensureFreshToken(source);

      expect(result.success).toBe(false);
      expect(isSourceUsable(source)).toBe(false);
      expect(mockMarkLoadedSourceAuthenticated).not.toHaveBeenCalled();
    });
  });

  describe('end-to-end', () => {
    test('expired source recovered without re-auth', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          refreshToken: 'refresh-123',
          expiresAt: Date.now() - 60_000,
        })),
        isExpired: mock(() => true),
        needsRefresh: mock(() => true),
        refresh: mock(async (source: LoadedSource) => { mockMarkLoadedSourceAuthenticated(source); return 'fresh-token'; }),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        slug: 'craft-mcp',
        type: 'mcp',
        provider: 'craft',
        mcp: { url: 'https://mcp.craft.do/my/mcp', authType: 'oauth' },
        isAuthenticated: false,
        connectionStatus: 'needs_auth',
        connectionError: 'Token expired',
      });

      // Step 1: getSourcesNeedingRefresh includes the expired source
      const needingRefresh = await manager.getSourcesNeedingRefresh([source]);
      expect(needingRefresh.length).toBe(1);

      // Step 2: refreshSources refreshes and restores auth state
      const { refreshed, failed } = await manager.refreshSources(needingRefresh);
      expect(refreshed.length).toBe(1);
      expect(failed.length).toBe(0);

      // Step 3: Verify auth state is restored
      expect(isSourceUsable(source)).toBe(true);
      expect(source.config.connectionStatus).toBe('connected');
      expect(source.config.connectionError).toBeUndefined();
      expect(mockMarkLoadedSourceAuthenticated).toHaveBeenCalledWith(source);
    });
  });

  describe('renew-endpoint sources', () => {
    test('needsRefresh returns true for renew-endpoint source without refreshToken', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          expiresAt: Date.now() - 60_000,
          // no refreshToken
        })),
        isExpired: mock(() => true),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        type: 'api',
        provider: 'custom-api',
        api: {
          baseUrl: 'https://api.example.com',
          authType: 'bearer',
          renewEndpoint: { path: '/auth/refresh', tokenField: 'token' },
        },
        isAuthenticated: true,
      });

      expect(await manager.needsRefresh(source)).toBe(true);
    });

    test('ensureFreshToken refreshes renew-endpoint source without refreshToken', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          expiresAt: Date.now() - 60_000,
          // no refreshToken
        })),
        isExpired: mock(() => true),
        needsRefresh: mock(() => true),
        refresh: mock(async (source: LoadedSource) => { mockMarkLoadedSourceAuthenticated(source); return 'new-fresh-token'; }),
      });

      const manager = new TokenRefreshManager(credManager);
      const source = createMockSource({
        type: 'api',
        provider: 'custom-api',
        api: {
          baseUrl: 'https://api.example.com',
          authType: 'bearer',
          renewEndpoint: { path: '/auth/refresh' },
        },
        isAuthenticated: true,
      });

      const result = await manager.ensureFreshToken(source);
      expect(result.success).toBe(true);
      expect(result.token).toBe('new-fresh-token');
      expect(credManager.refresh).toHaveBeenCalled();
    });

    test('getSourcesNeedingRefresh includes renew-endpoint sources', async () => {
      const credManager = createMockCredManager({
        load: mock(() => Promise.resolve({
          value: 'expired-token',
          expiresAt: Date.now() - 60_000,
        })),
        isExpired: mock(() => true),
      });

      const manager = new TokenRefreshManager(credManager);
      const renewSource = createMockSource({
        slug: 'custom-api',
        type: 'api',
        provider: 'custom',
        api: {
          baseUrl: 'https://api.example.com',
          authType: 'bearer',
          renewEndpoint: { path: '/auth/renew' },
        },
        isAuthenticated: true,
      });
      const plainBearerSource = createMockSource({
        slug: 'plain-api',
        type: 'api',
        provider: 'plain',
        api: { baseUrl: 'https://api.plain.com', authType: 'bearer' },
        isAuthenticated: true,
      });

      const result = await manager.getSourcesNeedingRefresh([renewSource, plainBearerSource]);
      expect(result.length).toBe(1);
      expect(result[0]!.config.slug).toBe('custom-api');
    });
  });
});

describe('hasRenewEndpoint', () => {
  test('returns true for API source with renewEndpoint', () => {
    const source = createMockSource({
      type: 'api',
      api: {
        baseUrl: 'https://api.example.com',
        authType: 'bearer',
        renewEndpoint: { path: '/auth/refresh' },
      },
    });
    expect(hasRenewEndpoint(source)).toBe(true);
  });

  test('returns false for API source without renewEndpoint', () => {
    const source = createMockSource({
      type: 'api',
      api: { baseUrl: 'https://api.example.com', authType: 'bearer' },
    });
    expect(hasRenewEndpoint(source)).toBe(false);
  });

  test('returns false for MCP source', () => {
    const source = createMockSource({
      type: 'mcp',
      mcp: { url: 'https://mcp.example.com', authType: 'oauth' },
    });
    expect(hasRenewEndpoint(source)).toBe(false);
  });
});

describe('isRefreshableSource', () => {
  test('returns true for OAuth source', () => {
    const source = createMockSource({
      type: 'mcp',
      provider: 'linear',
      mcp: { url: 'https://linear.example.com', authType: 'oauth' },
    });
    expect(isRefreshableSource(source)).toBe(true);
  });

  test('returns true for renew-endpoint source', () => {
    const source = createMockSource({
      type: 'api',
      provider: 'custom',
      api: {
        baseUrl: 'https://api.example.com',
        authType: 'bearer',
        renewEndpoint: { path: '/auth/refresh' },
      },
    });
    expect(isRefreshableSource(source)).toBe(true);
  });

  test('returns false for plain bearer source', () => {
    const source = createMockSource({
      type: 'api',
      provider: 'custom',
      api: { baseUrl: 'https://api.example.com', authType: 'bearer' },
    });
    expect(isRefreshableSource(source)).toBe(false);
  });
});

describe('effective credential refresh and repaired connections', () => {
  const globalSource = () => ({ ...createMockSource({
    slug: 'shared-api', type: 'api', provider: 'custom',
    api: { baseUrl: 'https://fixture.invalid', authType: 'bearer', renewEndpoint: { path: '/renew' } },
  }), tier: 'global' as const });

  test('startup refresh detects an inherited expired global credential', async () => {
    const credentials = createMockCredManager({
      load: mock(async () => null),
      loadEffective: mock(async () => ({ value: 'inherited', expiresAt: 1 })),
    });
    const manager = new TokenRefreshManager(credentials);
    expect(await manager.needsRefresh(globalSource())).toBe(true);
  });

  test('valid inherited global token is used without another refresh', async () => {
    const refresh = mock(async () => null);
    const credentials = createMockCredManager({
      load: mock(async () => null),
      loadEffective: mock(async () => ({ value: 'inherited', expiresAt: Date.now() + 3_600_000 })),
      isExpired: mock(() => false), needsRefresh: mock(() => false), refresh,
    });
    expect(await new TokenRefreshManager(credentials).ensureFreshToken(globalSource())).toMatchObject({ success: true, token: 'inherited' });
    expect(refresh).not.toHaveBeenCalled();
  });

  for (const fresh of [true, false]) {
    test(`a repaired effective credential bypasses the old failure cooldown (fresh=${fresh})`, async () => {
      let current = { value: 'old', expiresAt: 1 };
      let fail = true;
      const refresh = mock(async () => fail ? null : 'newly-refreshed');
      const credentials = createMockCredManager({
        load: mock(async () => current), loadEffective: mock(async () => current), refresh,
        isExpired: mock(() => current.expiresAt < Date.now()),
        needsRefresh: mock(() => current.expiresAt < Date.now() + 300_000),
      });
      const manager = new TokenRefreshManager(credentials), source = globalSource();
      expect((await manager.ensureFreshToken(source)).success).toBe(false);
      expect(manager.isInCooldown(source.config.slug)).toBe(true);
      current = { value: 'replacement', expiresAt: fresh ? Date.now() + 3_600_000 : 1 };
      fail = false;
      if (!fresh) expect(await manager.getSourcesNeedingRefresh([source])).toEqual([source]);
      expect(await manager.ensureFreshToken(source)).toMatchObject({ success: true, token: fresh ? 'replacement' : 'newly-refreshed' });
      expect(manager.isInCooldown(source.config.slug)).toBe(false);
    });
  }
});

test('unchanged failing credential retains cooldown without another refresh', async () => {
  const source = createMockSource({ slug: 'unchanged', type: 'api', provider: 'google', api: { baseUrl: 'https://fixture.invalid', authType: 'bearer' } });
  const refresh = mock(async () => null);
  const credentials = createMockCredManager({ loadEffective: mock(async () => ({ value: 'expired', refreshToken: 'refresh', expiresAt: 1 })), refresh });
  const manager = new TokenRefreshManager(credentials);
  expect((await manager.ensureFreshToken(source)).success).toBe(false);
  expect(await manager.ensureFreshToken(source)).toMatchObject({ success: false, rateLimited: true });
  expect(await manager.getSourcesNeedingRefresh([source])).toEqual([]);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('suppressed effective credential cannot return a plain-load token', async () => {
  const source = { ...createMockSource({ slug: 'suppressed', type: 'api', provider: 'google', api: { baseUrl: 'https://fixture.invalid', authType: 'bearer' } }), tier: 'global' as const };
  const credentials = createMockCredManager({
    load: mock(async () => ({ value: 'not-effective', expiresAt: Date.now() + 3_600_000 })),
    loadEffective: mock(async () => null), refresh: mock(async () => null),
    isExpired: mock(() => false), needsRefresh: mock(() => false),
  });
  expect((await new TokenRefreshManager(credentials).ensureFreshToken(source)).success).toBe(false);
});
