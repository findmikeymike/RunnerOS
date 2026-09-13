import { describe, expect, test } from 'bun:test';
import { hasDeepResearchDiscoveryCapability, inferDeepResearchSourceCapabilities, isCertifiedPublicWebResearchSource } from './source-profile.ts';
import type { LoadedSource } from '../sources/types.ts';

function source(overrides: Partial<LoadedSource['config']>, guide: LoadedSource['guide'] = null): LoadedSource {
  return {
    config: {
      id: overrides.slug ?? 'test',
      name: overrides.name ?? 'Test Source',
      slug: overrides.slug ?? 'test',
      enabled: true,
      provider: overrides.provider ?? 'test',
      type: overrides.type ?? 'mcp',
      tagline: overrides.tagline,
      mcp: overrides.mcp,
      api: overrides.api,
      local: overrides.local,
    },
    guide,
    folderPath: '/tmp/source',
    workspaceRootPath: '/tmp/workspace',
    workspaceId: 'workspace-1',
  };
}

describe('deep research source profiling', () => {
  test('certifies only exact official HTTPS public-web endpoints', () => {
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'exa', provider: 'exa', type: 'api', api: { baseUrl: 'https://api.exa.ai/', authType: 'header' },
    }))).toBe(true);
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'spoofed', provider: 'exa', type: 'api', api: { baseUrl: 'http://127.0.0.1:8787/', authType: 'none' },
    }))).toBe(false);
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'lookalike', provider: 'exa', type: 'api', api: { baseUrl: 'https://api.exa.ai.attacker.example/', authType: 'none' },
    }))).toBe(false);
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'wrong-port', provider: 'exa', type: 'api', api: { baseUrl: 'https://api.exa.ai:8443/', authType: 'none' },
    }))).toBe(false);
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'wrong-path', provider: 'exa', type: 'api', api: { baseUrl: 'https://api.exa.ai/unreviewed', authType: 'none' },
    }))).toBe(false);
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'query-endpoint', provider: 'exa', type: 'api', api: { baseUrl: 'https://api.exa.ai/?target=internal', authType: 'none' },
    }))).toBe(false);
    expect(isCertifiedPublicWebResearchSource(source({
      slug: 'local-exa', provider: 'exa', type: 'mcp', mcp: { transport: 'stdio', command: 'exa-mcp' },
    }))).toBe(false);
  });

  test('classifies Exa as MCP search', () => {
    const capabilities = inferDeepResearchSourceCapabilities(source({
      name: 'Exa',
      slug: 'exa',
      provider: 'exa',
      type: 'mcp',
      tagline: 'Search and fetch current web content through Exa MCP',
    }));
    expect(capabilities).toContain('mcp');
    expect(capabilities).toContain('search');
    expect(hasDeepResearchDiscoveryCapability(source({ slug: 'exa', provider: 'exa', type: 'mcp' }))).toBe(true);
  });

  test('classifies browser automation guidance as browser-capable', () => {
    const capabilities = inferDeepResearchSourceCapabilities(source(
      { name: 'NotebookLM', slug: 'notebooklm', provider: 'notebooklm', type: 'mcp' },
      { raw: '', guidelines: 'Uses local Chrome/browser automation to access NotebookLM.' },
    ));
    expect(capabilities).toContain('browser');
    expect(capabilities).toContain('knowledge');
  });

  test('does not mark ordinary local tools as discovery-capable', () => {
    expect(hasDeepResearchDiscoveryCapability(source({
      name: '3D Cell Forge',
      slug: '3d-cell-forge',
      provider: 'local-cli',
      type: 'local',
      tagline: 'Generate local 3D cell assets',
    }))).toBe(false);
  });
});
