import { describe, expect, it } from 'bun:test';
import matter from 'gray-matter';
import { BUNDLED_STARTER_SKILLS } from '../bundled.generated.ts';
import { STARTER_SKILLS } from '../starter-templates.ts';

describe('Trade God starter skills', () => {
  it('keeps the reusable system skills without Artist OS media skills', () => {
    expect(STARTER_SKILLS.map(skill => skill.slug)).toEqual([
      'agent-creator',
      'automation-creator',
      'workflow-creator',
      'source-recipe',
      'runneros-self-edit',
    ]);
  });

  it('has unique kebab-case slugs and valid markdown', () => {
    const slugs = STARTER_SKILLS.map(skill => skill.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const skill of STARTER_SKILLS) {
      expect(skill.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      const skillMd = skill.files.find(file => file.path === 'SKILL.md');
      expect(skillMd).toBeDefined();
      const parsed = matter(skillMd!.content);
      expect(parsed.data.name).toBeTruthy();
      expect(parsed.data.description).toBeTruthy();
      expect(parsed.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('ships the focused trading product skills', () => {
    expect(BUNDLED_STARTER_SKILLS.map(skill => skill.slug)).toEqual([
      'incident-recovery',
      'order-flow-specialist',
      'trade-desk-operator',
    ]);

    for (const skill of BUNDLED_STARTER_SKILLS) {
      const skillMd = skill.files.find(file => file.path === 'SKILL.md');
      expect(skillMd).toBeDefined();
      const parsed = matter(skillMd!.content);
      expect(parsed.data.name).toBeTruthy();
      expect(parsed.data.description).toBeTruthy();
      expect(parsed.content.trim().length).toBeGreaterThan(0);
    }
  });
});
