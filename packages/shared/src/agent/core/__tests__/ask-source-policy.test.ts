import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldPromptInAskMode, type PermissionManagerLike } from '../pre-tool-use';
import { permissionsConfigCache, getWorkspacePermissionsPath, getSourcePermissionsPath } from '../../permissions-config';
import { shouldAllowToolInMode } from '../../mode-manager';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const manager: PermissionManagerLike = { isCommandWhitelisted: () => false, isDangerousCommand: () => false,
  getBaseCommand: value => value, extractDomainFromNetworkCommand: () => null, isDomainWhitelisted: () => false };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ask-source-policy-'));
  cleanups.push(() => { permissionsConfigCache.invalidateWorkspace(root); permissionsConfigCache.invalidateSource(root, 'catalog'); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(join(root, 'sources/catalog'), { recursive: true });
  return root;
}

test('Ask mode honors an existing workspace MCP read allowance without another approval', () => {
  const root = fixture(), tool = 'mcp__catalog__inspect_catalog_snapshot';
  writeFileSync(getWorkspacePermissionsPath(root), JSON.stringify({ allowedMcpPatterns: [`^${tool}$`] }));
  const context = { workspaceRootPath: root, activeSourceSlugs: ['catalog'] };
  expect(shouldPromptInAskMode(tool, {}, manager, context)).toBeNull();
  expect(shouldAllowToolInMode(tool, {}, 'safe', { permissionsContext: context }).allowed).toBe(true);
  expect(shouldPromptInAskMode('mcp__catalog__erase_catalog', {}, manager, context)?.promptType).toBe('mcp_mutation');
});

test('Ask mode honors a selected source search allowance without allowing other endpoints', () => {
  const root = fixture(), tool = 'mcp__catalog__api_catalog';
  writeFileSync(getSourcePermissionsPath(root, 'catalog'), JSON.stringify({ allowedApiEndpoints: [{ method: 'POST', path: '^/search$' }] }));
  const context = { workspaceRootPath: root, activeSourceSlugs: ['catalog'] };
  expect(shouldPromptInAskMode(tool, { method: 'POST', path: '/search' }, manager, context)).toBeNull();
  expect(shouldPromptInAskMode(tool, { method: 'POST', path: '/delete' }, manager, context)?.promptType).toBe('mcp_mutation');
  expect(shouldPromptInAskMode(tool, { method: 'POST', path: '/search' }, manager, { ...context, activeSourceSlugs: [] })?.promptType).toBe('mcp_mutation');
});

test('Ask mode scopes source MCP rules and preserves action anchors and alternatives', () => {
  const root = fixture();
  writeFileSync(getSourcePermissionsPath(root, 'catalog'), JSON.stringify({
    allowedMcpPatterns: ['^inspect_snapshot$|^inspect_metadata$', 'list'],
  }));
  const context = { workspaceRootPath: root, activeSourceSlugs: ['catalog'] };
  for (const action of ['inspect_snapshot', 'inspect_metadata', 'list_entries']) {
    expect(shouldPromptInAskMode(`mcp__catalog__${action}`, {}, manager, context)).toBeNull();
    expect(shouldPromptInAskMode(`mcp__other__${action}`, {}, manager, context)?.promptType).toBe('mcp_mutation');
    expect(shouldAllowToolInMode(`mcp__catalog__${action}`, {}, 'safe', { permissionsContext: context }).allowed).toBe(true);
    expect(shouldAllowToolInMode(`mcp__other__${action}`, {}, 'safe', { permissionsContext: context }).allowed).toBe(false);
  }
  for (const tool of ['mcp__catalog__erase_snapshot', 'mcp__catalog__purge_listings',
    'mcp__catalog__erase_inspect_snapshot', 'mcp__other_mcp__catalog__inspect_snapshot']) {
    expect(shouldPromptInAskMode(tool, {}, manager, context)?.promptType).toBe('mcp_mutation');
  }
  expect(shouldPromptInAskMode('mcp__catalog__inspect_snapshot', {}, manager,
    { ...context, activeSourceSlugs: [] })?.promptType).toBe('mcp_mutation');
});
