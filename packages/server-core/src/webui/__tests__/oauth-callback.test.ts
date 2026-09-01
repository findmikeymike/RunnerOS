import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actualConfig from '@craft-agent/shared/config';
import * as actualWorkspaces from '@craft-agent/shared/workspaces';

const TEST_WORKSPACE = {
  id: 'workspace-1',
  name: 'OAuth Test Workspace',
  rootPath: join(tmpdir(), 'craft-webui-oauth-workspace'),
};

mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (workspaceId: string) => (
    workspaceId === TEST_WORKSPACE.id
      ? TEST_WORKSPACE
      : actualConfig.getWorkspaceByNameOrId(workspaceId)
  ),
}));

mock.module('@craft-agent/shared/workspaces', () => ({
  ...actualWorkspaces,
  assertTeamPermission: () => {},
}));

import { createWebuiHandler } from '../http-server';

const TEMP_DIRS: string[] = [];

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-oauth-test-'));
  TEMP_DIRS.push(dir);
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
  return dir;
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('WebUI /api/oauth/callback', () => {
  it('completes OAuth when the relay forwards the inner flow state', async () => {
    const flow = {
      flowId: 'flow-1',
      state: 'inner-state-123',
      codeVerifier: 'verifier',
      redirectUri: 'http://localhost:6477/callback',
      source: {} as any,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      provider: 'google',
      ownerClientId: 'client-1',
      workspaceId: 'workspace-1',
      sourceSlug: 'gmail',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const flows = new Map([[flow.state, flow]]);
    let exchangeCount = 0;

    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: 'test-secret',
      password: 'test-password',
      wsProtocol: 'wss',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    });

    handler.setOAuthCallbackDeps({
      flowStore: {
        getByState: (state: string) => flows.get(state) ?? null,
        remove: (state: string) => {
          flows.delete(state);
        },
      },
      credManager: {
        exchangeAndStore: async () => {
          exchangeCount += 1;
          return { success: true, email: 'gyula@craft.do' };
        },
      },
      sessionManager: {
        completeAuthRequest: async () => {},
      },
      pushSourcesChanged: () => {},
    });

    try {
      const response = await handler.fetch(
        new Request('http://127.0.0.1/api/oauth/callback?code=auth-code-123&state=inner-state-123'),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Authorization Successful');
      expect(flows.has('inner-state-123')).toBe(false);

      const replay = await handler.fetch(
        new Request('http://127.0.0.1/api/oauth/callback?code=auth-code-123&state=inner-state-123'),
      );
      expect(replay.status).toBe(200);
      expect(await replay.text()).toContain('Authorization Failed');
      expect(exchangeCount).toBe(1);
    } finally {
      handler.dispose();
    }
  });

  it('renders an OAuth failure page when the relay forwards provider errors', async () => {
    const flow = {
      state: 'inner-state-456',
    };
    const flows = new Map([[flow.state, flow]]);

    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: 'test-secret',
      password: 'test-password',
      wsProtocol: 'wss',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    });

    handler.setOAuthCallbackDeps({
      flowStore: {
        getByState: (state: string) => flows.get(state) ?? null,
        remove: (state: string) => {
          flows.delete(state);
        },
      },
      credManager: {
        exchangeAndStore: async () => ({ success: true }),
      },
      sessionManager: {
        completeAuthRequest: async () => {},
      },
      pushSourcesChanged: () => {},
    });

    try {
      const response = await handler.fetch(
        new Request('http://127.0.0.1/api/oauth/callback?error=access_denied&error_description=User%20denied&state=inner-state-456'),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Authorization Failed');
      expect(flows.has('inner-state-456')).toBe(false);
    } finally {
      handler.dispose();
    }
  });

  it('does not reflect provider error descriptions into executable HTML', async () => {
    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: 'test-secret',
      password: 'test-password',
      wsProtocol: 'wss',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    });

    handler.setOAuthCallbackDeps({
      flowStore: {
        getByState: () => null,
        remove: () => {},
      },
      credManager: {
        exchangeAndStore: async () => ({ success: true }),
      },
      sessionManager: {
        completeAuthRequest: async () => {},
      },
      pushSourcesChanged: () => {},
    });

    try {
      const payload = '<img src=x onerror=oauthAttack()>';
      const response = await handler.fetch(new Request(
        `http://127.0.0.1/api/oauth/callback?error=server_error&error_description=${encodeURIComponent(payload)}`,
      ));
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('Authorization failed.');
      expect(html).not.toContain(payload);
      expect(html).not.toContain('<img src=x');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    } finally {
      handler.dispose();
    }
  });
});
