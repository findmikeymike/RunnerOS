import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARTER_AGENTS } from './starter-templates.ts';
import { deleteGlobalAgent, ensureRequiredAgents, loadGlobalAgent, writeGlobalAgent } from './storage.ts';
import { signalTrackPromptPrefix, youtubeProviderPromptPrefix } from './signal-track-prompts.ts';
import { SIGNAL_BRIEFING_INSTRUCTIONS } from '../shared-intel/briefing.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function options() {
  const root = mkdtempSync(join(tmpdir(), 'signals-track-prompts-'));
  roots.push(root);
  return { globalAgentsDir: root };
}

describe('Signals v2 prompt compatibility', () => {
  for (const slug of ['youtube-intelligence-agent', 'signal-analyst-agent']) {
    test(`${slug}: upgrades exact shipped prompt and preserves metadata`, () => {
      const agent = STARTER_AGENTS.find(item => item.slug === slug)!;
      const opts = options();
      const previous = agent.systemPrompt.slice(signalTrackPromptPrefix(slug).length + youtubeProviderPromptPrefix(slug).length);
      writeGlobalAgent({ ...agent, metadata: { ...agent.metadata, name: 'My name' }, systemPrompt: previous }, opts);
      ensureRequiredAgents([agent], opts);
      expect(loadGlobalAgent(slug, opts)?.systemPrompt).toBe(agent.systemPrompt);
      expect(loadGlobalAgent(slug, opts)?.metadata.name).toBe('My name');
      ensureRequiredAgents([agent], opts);
      expect(loadGlobalAgent(slug, opts)?.systemPrompt).toBe(agent.systemPrompt);
    });
    test(`${slug}: preserves custom edits and deletion`, () => {
      const agent = STARTER_AGENTS.find(item => item.slug === slug)!;
      const opts = options();
      const custom = `${agent.systemPrompt.slice(signalTrackPromptPrefix(slug).length)}\nArtist customization.`;
      writeGlobalAgent({ ...agent, systemPrompt: custom }, opts);
      ensureRequiredAgents([agent], opts);
      expect(loadGlobalAgent(slug, opts)?.systemPrompt).toBe(custom);
      deleteGlobalAgent(slug, [], opts);
      ensureRequiredAgents([agent], opts);
      expect(loadGlobalAgent(slug, opts)).toBeNull();
    });
  }
  test('can upgrade analyst predating briefing without changing legacy contract', () => {
    const agent = STARTER_AGENTS.find(item => item.slug === 'signal-analyst-agent')!;
    const opts = options();
    const suffix = `\n\n${SIGNAL_BRIEFING_INSTRUCTIONS}`;
    const old = agent.systemPrompt.slice(signalTrackPromptPrefix(agent.slug).length, -suffix.length);
    writeGlobalAgent({ ...agent, systemPrompt: old }, opts);
    ensureRequiredAgents([agent], opts);
    expect(loadGlobalAgent(agent.slug, opts)?.systemPrompt).toBe(agent.systemPrompt);
    expect(agent.systemPrompt.endsWith(suffix)).toBe(true);
    expect(agent.systemPrompt).toContain('For all other tasks, retain the existing legacy behavior');
  });
  test('does not alter unrelated worker prompts', () => {
    expect(signalTrackPromptPrefix('content-director')).toBe('');
    expect(youtubeProviderPromptPrefix('content-director')).toBe('');
  });
  for (const slug of ['youtube-research-agent', 'youtube-intelligence-agent']) test(`${slug}: exact pre-Monid routing updates without replacing customization or activation`, () => {
    const agent = STARTER_AGENTS.find(item => item.slug === slug)!;
    const opts = options();
    const previous = agent.systemPrompt.replace(youtubeProviderPromptPrefix(slug), '');
    writeGlobalAgent({ ...agent, systemPrompt: previous }, opts);
    ensureRequiredAgents([agent], opts);
    expect(loadGlobalAgent(slug, opts)?.systemPrompt).toBe(agent.systemPrompt);
    expect(agent.metadata.optionalSources).toEqual(['youtube-research', 'monid', 'zero']);
    expect(agent.metadata.skills).toContain('monid');
    expect(youtubeProviderPromptPrefix(slug)).toContain('then Monid.');
    expect(youtubeProviderPromptPrefix(slug)).toContain('confirmed Monid capability absence');
    writeGlobalAgent({ ...agent, systemPrompt: `${previous}\nMy custom routing.` }, opts);
    ensureRequiredAgents([agent], opts);
    expect(loadGlobalAgent(slug, opts)?.systemPrompt).toBe(`${previous}\nMy custom routing.`);
  });
});
