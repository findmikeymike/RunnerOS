import { describe, expect, test } from 'bun:test';
import { getSessionToolTrustPolicy, SESSION_TOOL_NAMES, validateTrustedWorkerToolNames } from '@craft-agent/session-tools-core';
import { STARTER_AGENTS } from '../../agent-definitions/starter-templates.ts';
import { runPreToolUseChecks, type PermissionManagerLike } from '../core/pre-tool-use.ts';
import { setPermissionMode } from '../mode-manager.ts';

const permissionManager: PermissionManagerLike = {
  isCommandWhitelisted: () => false,
  isDangerousCommand: () => false,
  getBaseCommand: command => command,
  extractDomainFromNetworkCommand: () => null,
  isDomainWhitelisted: () => false,
};
function check(name: string, mode: 'safe' | 'ask' | 'allow-all', declarations: string[] = [name]) {
  const sessionId = `worker-trust-${mode}`;
  setPermissionMode(sessionId, mode);
  return runPreToolUseChecks({
    toolName: `mcp__session__${name}`, input: {}, sessionId,
    permissionMode: mode, workspaceRootPath: '/tmp/worker-tool-trust', workspaceId: 'fixture',
    activeSourceSlugs: [], allSourceSlugs: [], hasSourceActivation: false,
    trustedWorkerTools: declarations, permissionManager,
  });
}

describe('declared worker trust is effective', () => {
  test('every bundled declaration names a registered and trust-eligible tool', () => {
    for (const agent of STARTER_AGENTS) {
      expect(validateTrustedWorkerToolNames(agent.metadata.trustedWorkerTools ?? [])).toEqual([]);
      for (const name of agent.metadata.trustedWorkerTools ?? []) expect(SESSION_TOOL_NAMES.has(name)).toBe(true);
    }
  });
  test('every declared bundled action skips generic safe/ask prompts', () => {
    const names = new Set(STARTER_AGENTS.flatMap(agent => agent.metadata.trustedWorkerTools ?? []));
    for (const name of names) {
      for (const mode of ['safe', 'ask'] as const) expect({ name, mode, result: check(name, mode).type }).toEqual({ name, mode, result: 'allow' });
    }
  });
  test('song writes, artwork, and internal replies only gain the declared exemption', () => {
    for (const name of ['create_lab_song', 'save_lab_lyrics', 'artwork_compose', 'send_agent_message']) {
      expect(check(name, 'safe', []).type).toBe('block');
      expect(check(name, 'ask', []).type).toBe('prompt');
      expect(check(name, 'safe', [`mcp__session__${name}`]).type).toBe('allow');
      expect(check(name, 'ask').type).toBe('allow');
    }
  });
  test('existing Release Kit exact approval survives declarations in ask and allow-all', () => {
    for (const name of ['promote_to_release_kit', 'remove_from_release_kit', 'set_release_kit_primary']) {
      for (const mode of ['ask', 'allow-all'] as const) {
        const result = check(name, mode);
        expect(result.type).toBe('prompt');
        if (result.type === 'prompt') expect(result.description).toContain('Approve exact Release Kit action');
      }
      expect(check(name, 'safe').type).toBe('block');
    }
  });
  test('approval actions do not become auto-approved by metadata', () => {
    for (const name of ['approve_deep_research_plan', 'media_provider_request', 'promote_output_to_final']) {
      expect(check(name, 'safe').type).toBe('block');
      expect(check(name, 'ask').type).toBe('prompt');
      expect(validateTrustedWorkerToolNames([name])).toEqual([{ name, reason: 'explicit-approval' }]);
    }
  });
  test('name validation is case-sensitive, prefix-aware and independent of visibility filters', () => {
    expect(validateTrustedWorkerToolNames(['SubmitPlan', 'mcp__session__SubmitPlan', 'schedule_work', 'save_lab_lyrics'])).toEqual([]);
    expect(validateTrustedWorkerToolNames(['submit_plan', 'save_lab_lyric'])).toEqual([
      { name: 'submit_plan', reason: 'unknown-tool' }, { name: 'save_lab_lyric', reason: 'unknown-tool' },
    ]);
    expect(getSessionToolTrustPolicy('mcp__external__create_output')).toBeUndefined();
  });
});
