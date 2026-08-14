import { describe, expect, test } from 'bun:test';
import { localizeBundledDocContent } from '../index.ts';

describe('product documentation paths', () => {
  const runnerDoc = [
    '~/.craft-agent/docs/browser-tools.md',
    '$HOME/.agents/skills/example/SKILL.md',
    '~/.workflows/example/WORKFLOW.md',
    'craftagents://settings',
    '~/.config/runneros/google-ads/credentials.json',
    '~/.config/printing-press-clis/profiles.json',
  ].join('\n');

  test('preserves Runner documentation exactly', () => {
    expect(localizeBundledDocContent(runnerDoc, 'runner')).toBe(runnerDoc);
  });

  test('routes every Artist OS documentation path inside its product boundary', () => {
    const artistDoc = localizeBundledDocContent(runnerDoc, 'artist-os');
    expect(artistDoc).not.toContain('~/.craft-agent');
    expect(artistDoc).not.toContain('$HOME/.agents');
    expect(artistDoc).not.toContain('~/.workflows');
    expect(artistDoc).not.toContain('craftagents://');
    expect(artistDoc).toContain('~/.artist-os/docs/browser-tools.md');
    expect(artistDoc).toContain('$HOME/.artist-os/libraries/agents/skills/example/SKILL.md');
    expect(artistDoc).toContain('~/.artist-os/libraries/workflows/example/WORKFLOW.md');
    expect(artistDoc).toContain('artistos://settings');
    expect(artistDoc).toContain('~/.artist-os/cache/integrations/google-ads/credentials.json');
    expect(artistDoc).toContain('~/.artist-os/integrations/social/profiles.json');
  });
});
