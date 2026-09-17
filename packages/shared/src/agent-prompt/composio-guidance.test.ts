import { describe, expect, test } from 'bun:test';
import { buildComposioGuidance } from './composio-guidance.ts';
import { deriveSessionToolFilterOptions } from '../agent/session-tool-filter-options.ts';
import { composeAgentSystemPrompt } from './compose.ts';

describe('Composio runtime guidance', () => {
  test('composes current delivery guidance after an unchanged saved persona', () => {
    const persona = { slug: 'outreach-agent', metadata: {}, systemPrompt: 'My custom voice. Legacy Gmail delivery instructions.' };
    const result = composeAgentSystemPrompt(persona, [], [], [], [], { artistWorkspaceScope: 'hq' });
    expect(result.startsWith(persona.systemPrompt)).toBe(true);
    const guidance = buildComposioGuidance('outreach-agent', 'hq');
    if (guidance) expect(result.split(guidance)).toHaveLength(2);
    else expect(result).not.toContain('Gmail connection routing — current tool contract:');
  });
  test('matches actual role, product and workspace tool eligibility', () => {
    for (const variant of ['artist-os', 'runner']) {
      for (const scope of ['hq', 'campaign', 'lab', undefined]) {
        for (const slug of ['concierge', 'comms-agent', 'outreach-agent', 'community-agent', 'record-doctor', undefined]) {
          expect(Boolean(buildComposioGuidance(slug, scope, variant))).toBe(
            deriveSessionToolFilterOptions(slug, scope, variant).includeComposioTools,
          );
        }
      }
    }
  });
  test('resolves the saved-draft mismatch and preserves uncertainty and sender boundaries', () => {
    const prompt = buildComposioGuidance('outreach-agent', 'hq', 'artist-os');
    expect(prompt).toContain('NOT a saved draftId');
    expect(prompt).toContain('Do not send an existing or user-edited draft through this tool');
    expect(prompt).toContain('Never retry or switch providers automatically');
    expect(prompt).toContain('different sender');
    expect(prompt).toContain('Never silently omit requested attachments');
    expect(prompt).toContain('retain the existing native Gmail path');
  });
});
