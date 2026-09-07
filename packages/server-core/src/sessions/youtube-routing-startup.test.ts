import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matter } from '../../../shared/src/config/frontmatter';
import { STARTER_AGENTS } from '@craft-agent/shared/agent-definitions';
import { ensureBuiltInAgentMetadataSlugs, ensureRequiredAgents, loadGlobalAgent, replaceBuiltInAgentPromptText, writeGlobalAgent } from '@craft-agent/shared/agent-definitions';
import { signalTrackPromptPrefix, youtubeProviderPromptPrefix } from '../../../shared/src/agent-definitions/signal-track-prompts';
import { migrateYouTubeRouting } from '../../../shared/src/agent-definitions/youtube-routing-migration';

test('actual startup YouTube block upgrades both oldest known prompts on the first pass after normalization', () => {
  const source = readFileSync(new URL('./SessionManager.ts', import.meta.url), 'utf-8');
  const start = source.indexOf('const youtubeResearchAgent = STARTER_AGENTS.find');
  const end = source.indexOf('const rawVideoEditorDirectionSkillUpdated', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  expect(block.indexOf('migrateYouTubeRouting()')).toBeGreaterThan(block.indexOf('const youtubeIntelligencePreferredTranscriptUpdated'));
  // Execute only this synchronous migration block with isolated storage. No
  // SessionManager initialization, workspace reads, provider work, or app launch.
  const run = new Function('STARTER_AGENTS', 'ensureBuiltInAgentMetadataSlugs', 'replaceBuiltInAgentPromptText', 'migrateYouTubeRouting', 'sessionLog',
    block.replace("const { migrateYouTubeRouting } = await import('@craft-agent/shared/agent-definitions')", ''));
  const oldParagraphs: Array<{ slug: string; oldText: string; newText: string }> = [];
  run(STARTER_AGENTS, () => ({ updated: false }), (slug: string, oldText: string, newText: string) => {
    oldParagraphs.push({ slug, oldText, newText }); return { updated: false };
  }, () => ({ updatedAgents: [], updatedSkills: [] }), { info: () => {} });
  const root = mkdtempSync(join(tmpdir(), 'youtube-startup-migration-'));
  const options = { globalAgentsDir: join(root, 'agents'), globalSkillsDir: join(root, 'skills') };
  const agents = STARTER_AGENTS.filter(agent => ['youtube-research-agent', 'youtube-intelligence-agent'].includes(agent.slug));
  try {
    for (const agent of agents) {
      let oldest = agent.systemPrompt.slice(signalTrackPromptPrefix(agent.slug).length + youtubeProviderPromptPrefix(agent.slug).length);
      for (const paragraph of oldParagraphs.filter(item => item.slug === agent.slug).reverse()) {
        expect(oldest).toContain(paragraph.newText);
        oldest = oldest.replace(paragraph.newText, paragraph.oldText);
      }
      writeGlobalAgent({ ...agent, systemPrompt: oldest }, options);
    }
    // The early required-agent pass cannot yet recognize these older bodies.
    ensureRequiredAgents(agents, options);
    for (const agent of agents) expect(loadGlobalAgent(agent.slug, options)!.systemPrompt).not.toBe(agent.systemPrompt);
    const boot = () => run(STARTER_AGENTS,
      (slug: string, required: Parameters<typeof ensureBuiltInAgentMetadataSlugs>[1]) => ensureBuiltInAgentMetadataSlugs(slug, required, options),
      (slug: string, oldText: string, newText: string) => replaceBuiltInAgentPromptText(slug, oldText, newText, options),
      () => migrateYouTubeRouting(options), { info: () => {} });
    boot();
    for (const agent of agents) expect(loadGlobalAgent(agent.slug, options)!.systemPrompt).toBe(agent.systemPrompt);
    boot();
    for (const agent of agents) expect(loadGlobalAgent(agent.slug, options)!.systemPrompt).toBe(agent.systemPrompt);
    for (const customSuffix of ['\nMy exact custom routing note.', '\n']) {
      const bodies = new Map<string, string>();
      for (const agent of agents) {
        const previous = agent.systemPrompt.replace(youtubeProviderPromptPrefix(agent.slug), '');
        writeGlobalAgent({ ...agent, metadata: { ...agent.metadata, skills: [], optionalSources: [] }, systemPrompt: previous }, options);
        const file = join(options.globalAgentsDir, agent.slug, 'AGENT.md');
        writeFileSync(file, readFileSync(file, 'utf-8') + customSuffix);
        bodies.set(agent.slug, matter(readFileSync(file, 'utf-8')).content);
      }
      ensureRequiredAgents(agents, options);
      boot();
      for (const agent of agents) {
        const file = join(options.globalAgentsDir, agent.slug, 'AGENT.md');
        expect(matter(readFileSync(file, 'utf-8')).content).toBe(bodies.get(agent.slug)!);
        expect(loadGlobalAgent(agent.slug, options)!.metadata.skills).toContain('monid');
        expect(loadGlobalAgent(agent.slug, options)!.systemPrompt).not.toContain(youtubeProviderPromptPrefix(agent.slug).trim());
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
