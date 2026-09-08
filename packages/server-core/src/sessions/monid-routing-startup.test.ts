import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import previousAgents from '../../../shared/src/agent-definitions/__fixtures__/monid-routing-v1/agents.json';
import { migrateMonidRouting } from '../../../shared/src/agent-definitions/monid-routing-migration';
import { STARTER_AGENTS } from '../../../shared/src/agent-definitions/starter-templates';
import { ensureRequiredAgents, loadGlobalAgent, writeGlobalAgent, type CreateAgentInput } from '../../../shared/src/agent-definitions/storage';

test('actual early startup migration upgrades stock routing before normalizers without restoring removed skills', () => {
  const source = readFileSync(new URL('./SessionManager.ts', import.meta.url), 'utf8');
  const start = source.indexOf("const { migrateMonidRouting } = await import('@craft-agent/shared/agent-definitions')");
  const end = source.indexOf('const releaseManagerAgentDir', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  expect(start).toBeLessThan(source.indexOf('const { seeded } = seedGlobalLibraryIfEmpty(STARTER_AGENTS)'));
  const block = source.slice(start, end).replace("const { migrateMonidRouting } = await import('@craft-agent/shared/agent-definitions')", '');
  const run = new Function('migrateMonidRouting', 'sessionLog', block);
  const root = mkdtempSync(join(tmpdir(), 'monid-startup-'));
  const options = { globalAgentsDir: join(root, 'agents'), globalSkillsDir: join(root, 'skills') };
  try {
    for (const prior of previousAgents as CreateAgentInput[]) writeGlobalAgent(prior, options);
    run(() => migrateMonidRouting(options), { info: () => {} });
    ensureRequiredAgents(STARTER_AGENTS, options);
    migrateMonidRouting(options);
    for (const prior of previousAgents) {
      const current = STARTER_AGENTS.find(agent => agent.slug === prior.slug)!;
      expect(loadGlobalAgent(prior.slug, options)!.metadata.skills).toEqual(current.metadata.skills);
      expect(loadGlobalAgent(prior.slug, options)!.metadata.sources).toEqual(current.metadata.sources);
      expect(loadGlobalAgent(prior.slug, options)!.systemPrompt).toBe(current.systemPrompt);
    }
    const anything = previousAgents.find(agent => agent.slug === 'anything-agent') as CreateAgentInput;
    writeGlobalAgent({ ...anything, metadata: { ...anything.metadata, skills: [] } }, options);
    run(() => migrateMonidRouting(options), { info: () => {} });
    ensureRequiredAgents(STARTER_AGENTS, options);
    migrateMonidRouting(options);
    expect(loadGlobalAgent(anything.slug, options)!.metadata.skills ?? []).toEqual([]);
    // The old unconditional restorers defeated even a safe migration.
    expect(source).not.toContain('ensureBuiltInAgentSkillsForSlug(ANYTHING_AGENT_SLUG, anythingAgentSkillSlugs)');
    expect(source).not.toContain("ensureBuiltInAgentMetadataSlugs('youtube-research-agent'");
    expect(source).not.toContain("ensureBuiltInAgentMetadataSlugs('youtube-intelligence-agent'");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
