import { describe, expect, test } from 'bun:test';
import { handleCreateSkill, handleGetCustomSkill, handleUpdateSkill } from './custom-skills';
import { getSessionToolDefs, CreateSkillSchema, UpdateSkillSchema } from '../tool-defs';
import type { SessionToolContext } from '../context';

describe('custom skill tools', () => {
  test('uses standard mutation permissions and existing role filtering', () => {
    const tools = getSessionToolDefs();
    expect(tools.find(tool => tool.name === 'get_custom_skill')?.safeMode).toBe('allow');
    for (const name of ['create_skill', 'update_skill']) {
      expect(tools.find(tool => tool.name === name)?.safeMode).toBe('block');
      expect(getSessionToolDefs({ excludeDefinitionAuthoring: true }).some(tool => tool.name === name)).toBe(false);
    }
    expect(UpdateSkillSchema.safeParse({ slug: 'custom', content: 'new' }).success).toBe(false);
    expect(CreateSkillSchema.safeParse({ slug: '../escape', content: 'x' }).success).toBe(false);
    expect(UpdateSkillSchema.safeParse({ slug: 'custom', content: 'x', arbitraryFiles: [] }).success).toBe(false);
  });
  test('forwards exact approved input and returns canonical workspace skill link', async () => {
    const input = { slug: 'custom-review', content: 'instructions', scope: 'global' as const };
    const ctx = { workspaceId: 'canonical-workspace', createSkill: async (value: unknown) => {
      expect(value).toEqual(input); return { ok: true, slug: input.slug, revision: 'revision' };
    } } as SessionToolContext;
    const result = await handleCreateSkill(ctx, input);
    expect(JSON.stringify(result)).toContain('workspace/canonical-workspace/skills/skill/custom-review');
    expect(JSON.stringify(result)).toContain('revision');
  });
  test('returns actionable missing callback and host validation failures', async () => {
    expect((await handleGetCustomSkill({} as SessionToolContext, { slug: 'custom' })).isError).toBe(true);
    const result = await handleUpdateSkill({ updateSkill: async () => { throw new Error('Custom skill changed. Read it again.'); } } as unknown as SessionToolContext, { slug: 'custom', content: 'new', expectedRevision: '0'.repeat(64) });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('changed');
  });
  test('does not claim success when save succeeded but activation failed', async () => {
    const result = await handleCreateSkill({ createSkill: async () => ({ ok: false, saved: true, error: 'Saved custom skill, but workspace activation failed: denied' }) } as unknown as SessionToolContext, { slug: 'custom', content: 'new' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Saved custom skill');
  });
});
