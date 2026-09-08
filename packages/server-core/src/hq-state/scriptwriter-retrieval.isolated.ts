import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'scriptwriter-retrieval-'));
const previousVariant = process.env.CRAFT_PRODUCT_VARIANT;
process.env.CRAFT_PRODUCT_VARIANT = 'artist-os';
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = join(root, 'config');
let context: typeof import('@craft-agent/shared/workspace-context');
let tools: typeof import('./manager-tools');
let rpc: typeof import('../handlers/rpc/workspace-context');
let hqId: string, campaignId: string;
const hq = join(root, 'hq'), campaign = join(root, 'campaign');
beforeAll(async () => {
  const config = await import('@craft-agent/shared/config');
  context = await import('@craft-agent/shared/workspace-context');
  tools = await import('./manager-tools');
  rpc = await import('../handlers/rpc/workspace-context');
  config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null });
  mkdirSync(hq); mkdirSync(campaign);
  hqId = config.addWorkspace({ name: 'Artist HQ', rootPath: hq, artistWorkspaceScope: 'hq' }).id;
  campaignId = config.addWorkspace({ name: 'Release', rootPath: campaign, artistWorkspaceScope: 'campaign' }).id;
});
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
  if (previousVariant === undefined) delete process.env.CRAFT_PRODUCT_VARIANT;
  else process.env.CRAFT_PRODUCT_VARIANT = previousVariant;
  rmSync(root, { recursive: true, force: true });
});
function write(path: string, slug: string, body: string, enabled = true) {
  context.upsertContextDoc(path, { slug, body, metadata: { name: slug, enabled, routing: { mode: 'broadcast' } } });
}
test('on-demand tools retrieve latest HQ world with provenance, never stale campaign copy', () => {
  write(hq, 'artist-branding', 'approved first world'); write(campaign, 'artist-branding', 'old world');
  const result = tools.getAuthorizedWorkspaceContext(campaign, 'scriptwriter', { slug: 'artist-branding' });
  expect(result).toMatchObject({ ok: true, document: { body: 'approved first world', workspaceRootPath: hq } });
  write(hq, 'artist-branding', 'approved revised world');
  expect(tools.getAuthorizedWorkspaceContext(campaign, 'scriptwriter', { slug: 'artist-branding' }))
    .toMatchObject({ document: { body: 'approved revised world' } });
  expect(tools.listAuthorizedWorkspaceContext(campaign, 'scriptwriter', { query: 'artist-branding' }))
    .toMatchObject({ documents: [{ slug: 'artist-branding', workspaceRootPath: hq }] });
  write(hq, 'artist-branding', 'disabled secret', false);
  expect(tools.getAuthorizedWorkspaceContext(campaign, 'scriptwriter', { slug: 'artist-branding' }).ok).toBe(false);
});
test('actual focus RPC includes HQ identity for each Scriptwriter mode', async () => {
  write(hq, 'artist-branding', 'shared approved world'); write(campaign, 'mission-brief', 'release details');
  const { STARTER_AGENTS, writeGlobalAgent } = await import('@craft-agent/shared/agent-definitions');
  const agent = STARTER_AGENTS.find(a => a.slug === 'scriptwriter')!;
  expect(agent).toBeDefined();
  // Register the real definition so the handler validates the selected focus.
  writeGlobalAgent(agent);
  const handlers = new Map<string, (...args: any[]) => any>();
  rpc.registerWorkspaceContextHandlers({ handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as any, {} as any);
  const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');
  const launch = handlers.get(RPC_CHANNELS.workspaceContext.LIST_FOR_AGENT)!;
  for (const mode of agent.metadata.taskModes!) {
    const docs = await launch({}, campaignId, 'scriptwriter', mode.id);
    expect(docs.find((doc: any) => doc.slug === 'artist-branding')).toMatchObject({ body: 'shared approved world', workspaceRootPath: hq });
  }
});
