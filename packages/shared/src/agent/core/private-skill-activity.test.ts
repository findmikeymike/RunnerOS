import { RUNTIME_IDENTITY } from '../../config/runtime-identity.ts';
import { describe, expect, test } from 'bun:test';
import { sanitizePrivateSkillHookInput, sanitizePrivateSkillActivityInput, sanitizePrivateSkillResultPaths } from './private-skill-activity.ts';
import { pickSessionFields } from '../../sessions/utils.ts';
import { getSessionToolDefs } from '../../../../session-tools-core/src/tool-defs.ts';

describe.skipIf(RUNTIME_IDENTITY.variant !== 'artist-os')('private skill boundaries', () => {
  test('automation hooks receive status instead of private loader bodies or errors', () => {
    const input = { tool_name: 'mcp__session__use_skill', tool_input: { slug: 'monid' }, tool_response: '<private-built-in-guidance>private secret</private-built-in-guidance>' };
    const result = sanitizePrivateSkillHookInput(input);
    expect(JSON.stringify(result)).not.toContain('private secret');
    expect(result.tool_input).toEqual({ slug: 'monid' });
    expect(input.tool_response).toContain('private secret');
    expect(sanitizePrivateSkillHookInput({ tool_name: 'read_skill_reference', error: 'private recipe' }).error).not.toContain('private recipe');
    const userWork = { tool_name: 'mcp__session__get_skill_personal_instructions', tool_response: 'my own words' };
    expect(sanitizePrivateSkillHookInput(userWork)).toBe(userWork);
  });
  test('helper activity does not publish private paths while normal outputs stay intact', () => {
    const input = { command: 'python3 /tmp/session/.skill-runtime/files/skill/revision/scripts/run.py --output /tmp/video.mp4' };
    expect(JSON.stringify(sanitizePrivateSkillActivityInput(input))).not.toContain('.skill-runtime');
    expect(sanitizePrivateSkillResultPaths('Created /tmp/video.mp4 from /tmp/session/.skill-runtime/files/skill/ref.py')).toBe('Created /tmp/video.mp4 from [private skill file]');
    const ordinary = { file_path: '/tmp/my-own-draft.md' }; expect(sanitizePrivateSkillActivityInput(ordinary)).toBe(ordinary);
  });
  test('personal preferences retain ordinary mutation approval classification on both registries', () => {
    const definitions = getSessionToolDefs({ includeManagedSkillTools: true });
    for (const name of ['use_skill', 'read_skill_reference', 'get_skill_personal_instructions']) {
      const tool = definitions.find(item => item.name === name);
      expect(tool?.executionMode).toBe('registry'); expect(tool?.safeMode).toBe('allow'); expect(tool?.readOnly).toBe(true);
    }
    for (const name of ['save_skill_personal_instructions', 'delete_skill_personal_instructions']) {
      const tool = definitions.find(item => item.name === name);
      expect(tool?.executionMode).toBe('registry'); expect(tool?.safeMode).toBe('block'); expect(tool?.readOnly).toBe(false);
    }
  });
  test('run and historical identity markers survive the shared session persistence projection', () => {
    expect(pickSessionFields({ id: 'session', managedSkillRunId: 'original-input', legacySkillReferences: ['monid'], transientSecret: 'private' }))
      .toEqual({ id: 'session', managedSkillRunId: 'original-input', legacySkillReferences: ['monid'] });
  });
});
