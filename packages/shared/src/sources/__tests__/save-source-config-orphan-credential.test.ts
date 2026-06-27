import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadSourceConfig, saveSourceConfig } from '../storage.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';

type DeleteCall = { type: string; workspaceId: string; sourceId: string };

let workspaceRoot: string;
let deleteCalls: DeleteCall[] = [];
let deleteShouldThrow = false;
let deleteReturnValue = true;
let deleteSpy: { mockRestore: () => void } | null = null;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'save-source-config-orphan-'));
  deleteCalls = [];
  deleteShouldThrow = false;
  deleteReturnValue = true;

  deleteSpy = spyOn(SourceCredentialManager.prototype, 'delete').mockImplementation(async (source: LoadedSource) => {
    const credentialId = new SourceCredentialManager().getCredentialId(source);
    deleteCalls.push({
      type: credentialId.type,
      workspaceId: credentialId.workspaceId!,
      sourceId: credentialId.sourceId!,
    });
    if (deleteShouldThrow) throw new Error('credential store unavailable');
    return deleteReturnValue;
  });
});

afterEach(() => {
  deleteSpy?.mockRestore();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function apiConfig(overrides: Partial<FolderSourceConfig['api']> = {}): FolderSourceConfig {
  return {
    id: 'picnic_abcd',
    name: 'Picnic',
    slug: 'picnic',
    enabled: true,
    provider: 'custom',
    type: 'api',
    api: {
      baseUrl: 'https://example.com',
      authType: 'none',
      ...overrides,
    },
  };
}

function loadedApiSource(config: FolderSourceConfig): LoadedSource {
  return {
    config,
    guide: null,
    folderPath: join(workspaceRoot, 'sources', config.slug),
    workspaceRootPath: workspaceRoot,
    workspaceId: basename(workspaceRoot),
  };
}

describe('saveSourceConfig orphan credential cleanup', () => {
  test('deletes source_apikey when API authType is none', async () => {
    saveSourceConfig(workspaceRoot, apiConfig({
      authType: 'none',
      defaultHeaders: { Cookie: '_oauth2_proxy=foo' },
    }));
    await Promise.resolve();

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.type).toBe('source_apikey');
    expect(deleteCalls[0]!.sourceId).toBe('picnic');
  });

  test('does not delete credentials for authenticated API modes', () => {
    saveSourceConfig(workspaceRoot, apiConfig({ authType: 'header', headerName: 'Cookie' }));
    saveSourceConfig(workspaceRoot, apiConfig({ authType: 'bearer' }));

    expect(deleteCalls).toHaveLength(0);
  });

  test('does not delete credentials for no-auth MCP sources', () => {
    const config: FolderSourceConfig = {
      id: 'mcp_abcd',
      name: 'Some MCP',
      slug: 'some-mcp',
      enabled: true,
      provider: 'custom',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    };

    saveSourceConfig(workspaceRoot, config);

    expect(deleteCalls).toHaveLength(0);
  });

  test('credential delete failure does not block config write', async () => {
    deleteShouldThrow = true;

    expect(() => saveSourceConfig(workspaceRoot, apiConfig({ authType: 'none' }))).not.toThrow();
    await Promise.resolve();

    const loaded = loadSourceConfig(workspaceRoot, 'picnic');
    expect(loaded?.api?.authType).toBe('none');
    expect(existsSync(join(workspaceRoot, 'sources', 'picnic', 'config.json'))).toBe(true);
  });

  test('authType none sources do not resolve source_apikey during load', async () => {
    const manager = new SourceCredentialManager();
    const idSpy = spyOn(manager, 'getCredentialId');

    const credential = await manager.load(loadedApiSource(apiConfig({ authType: 'none' })));

    expect(credential).toBeNull();
    expect(idSpy).not.toHaveBeenCalled();
    idSpy.mockRestore();
  });
});
