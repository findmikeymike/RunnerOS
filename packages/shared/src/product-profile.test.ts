import { describe, expect, test } from 'bun:test';
import { STARTER_AGENTS } from './agent-definitions/index.ts';
import { BUNDLED_STARTER_SKILLS } from './skills/bundled.generated.ts';
import { GLOBAL_AGENT_SKILLS_DIR } from './skills/storage.ts';
import { GLOBAL_AGENTS_DIR } from './agent-definitions/storage.ts';
import { CONFIG_DIR } from './config/paths.ts';
import { join } from 'node:path';
import {
  TRADE_GOD_BUNDLED_SKILL_SLUGS,
  TRADE_GOD_STARTER_AGENT_SLUGS,
} from './product-profile.ts';

describe('Trade God product catalog', () => {
  test('keeps only the focused agent catalog at runtime', () => {
    const selected = STARTER_AGENTS.filter(agent =>
      (TRADE_GOD_STARTER_AGENT_SLUGS as readonly string[]).includes(agent.slug)
    );

    expect(selected.map(agent => agent.slug)).toEqual([...TRADE_GOD_STARTER_AGENT_SLUGS]);
    expect(selected.some(agent => /artist|music|spotify|lyric|radio/i.test(agent.slug))).toBe(false);
    expect(selected.some(agent => agent.slug === 'researcher')).toBe(true);
  });

  test('ships only Trade God bundled skills', () => {
    expect(BUNDLED_STARTER_SKILLS.map(skill => skill.slug)).toEqual([
      ...TRADE_GOD_BUNDLED_SKILL_SLUGS,
    ]);
    expect(BUNDLED_STARTER_SKILLS.some(skill =>
      /artist|music|spotify|lyric|radio/i.test(skill.slug)
    )).toBe(false);
  });

  test('keeps agent and skill libraries inside the Trade God config root', () => {
    expect(GLOBAL_AGENTS_DIR).toBe(join(CONFIG_DIR, 'agents'));
    expect(GLOBAL_AGENT_SKILLS_DIR).toBe(join(CONFIG_DIR, 'skills'));
  });
});
