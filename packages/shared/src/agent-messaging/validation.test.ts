import { describe, expect, test } from 'bun:test';
import { normalizeMessageAgentInput } from './validation.ts';

describe('agent messaging validation', () => {
  test('normalizes bounded delegation input', () => {
    const input = normalizeMessageAgentInput({
      agentSlug: 'code-reviewer',
      task: 'Review the diff.',
      sourceSlugs: ['exa', 'exa', 'github'],
      skillSlugs: ['fix'],
    }, { parentPermissionMode: 'ask' });

    expect(input.agentSlug).toBe('code-reviewer');
    expect(input.sourceSlugs).toEqual(['exa', 'github']);
    expect(input.skillSlugs).toEqual(['fix']);
    expect(input.permissionMode).toBe('ask');
    expect(input.timeoutSeconds).toBe(300);
    expect(input.maxTurns).toBe(1);
    expect(input.background).toBe(false);
  });

  test('normalizes background mode', () => {
    const input = normalizeMessageAgentInput({
      agentSlug: 'code-reviewer',
      task: 'Review the diff.',
      background: true,
    }, { parentPermissionMode: 'ask' });

    expect(input.background).toBe(true);
  });

  test('blocks permission escalation', () => {
    expect(() => normalizeMessageAgentInput({
      agentSlug: 'coder',
      task: 'Implement the fix.',
      permissionMode: 'allow-all',
    }, { parentPermissionMode: 'safe' })).toThrow('cannot escalate');
  });

  test('blocks recursive calls at max depth', () => {
    expect(() => normalizeMessageAgentInput({
      agentSlug: 'coder',
      task: 'Continue delegation.',
    }, { depth: 2, maxDepth: 2 })).toThrow('maximum delegation depth');
  });
});


describe('focused delegation validation', () => {
  test('normalizes the selected mode without changing authority', () => {
    const input = normalizeMessageAgentInput({ agentSlug: 'branding-agent', task: 'Build a world', taskModeId: ' artist-world ' }, { parentPermissionMode: 'safe' });
    expect(input.taskModeId).toBe('artist-world');
    expect(input.permissionMode).toBe('safe');
    expect(input.skillSlugs).toEqual([]);
  });
  test.each(['', 'FULL', '../artist-world'])('rejects invalid mode id %s', taskModeId => {
    expect(() => normalizeMessageAgentInput({ agentSlug: 'branding-agent', task: 'Build a world', taskModeId })).toThrow('taskModeId must');
  });
  test.each([{ skillSlugs: [] }, { skillSlugs: ['artist-narrative-universe'] }])('rejects raw skill overrides alongside a mode', ({ skillSlugs }) => {
    expect(() => normalizeMessageAgentInput({ agentSlug: 'branding-agent', task: 'Build a world', taskModeId: 'artist-world', skillSlugs: [...skillSlugs] })).toThrow('cannot be combined');
  });
});
