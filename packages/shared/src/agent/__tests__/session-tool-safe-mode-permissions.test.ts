/**
 * Regression tests for metadata-driven session tool safe-mode classification.
 */
import { describe, it, expect } from 'bun:test';
import { setPermissionMode, shouldAllowToolInMode } from '../../agent/mode-manager.ts';
import { runPreToolUseChecks, type PermissionManagerLike } from '../core/pre-tool-use.ts';

const permissionManager: PermissionManagerLike = {
  isCommandWhitelisted: () => false,
  isDangerousCommand: () => false,
  getBaseCommand: (command) => command.split(/\s+/)[0] ?? command,
  extractDomainFromNetworkCommand: () => null,
  isDomainWhitelisted: () => false,
};

describe('session tool safe-mode classification', () => {
  it('allows read-only session tools in safe mode', () => {
    const allowedTools = [
      'mcp__session__send_developer_feedback',
      'mcp__session__call_llm',
      'mcp__session__browser_tool',
      'mcp__session__script_sandbox',
    ] as const;

    for (const toolName of allowedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks mutating/auth session tools in safe mode', () => {
    const blockedTools = [
      'mcp__session__source_oauth_trigger',
      'mcp__session__source_credential_prompt',
      'mcp__session__spawn_session',
      'mcp__session__update_user_preferences',
    ] as const;

    for (const toolName of blockedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('Session configuration changes are blocked in');
      }
    }
  });

  it('allows trusted worker session tools in safe mode without broadening global safe mode', () => {
    const globallyBlocked = shouldAllowToolInMode('mcp__session__start_deep_research', {}, 'safe');
    expect(globallyBlocked.allowed).toBe(false);
    setPermissionMode('trusted-industry-hunter', 'safe');

    const trusted = runPreToolUseChecks({
      toolName: 'mcp__session__start_deep_research',
      input: { topic: 'Find relevant A&Rs', planPolicy: 'auto' },
      sessionId: 'trusted-industry-hunter',
      permissionMode: 'safe',
      workspaceRootPath: '/tmp/ws',
      workspaceId: 'ws',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      trustedWorkerTools: ['start_deep_research', 'create_output'],
      permissionManager,
    });
    expect(trusted.type).toBe('allow');

    const untrustedSend = runPreToolUseChecks({
      toolName: 'mcp__session__send_agent_message',
      input: { sessionId: 'target', message: 'Go do this.' },
      sessionId: 'trusted-industry-hunter',
      permissionMode: 'safe',
      workspaceRootPath: '/tmp/ws',
      workspaceId: 'ws',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      trustedWorkerTools: ['start_deep_research', 'create_output'],
      permissionManager,
    });
    expect(untrustedSend.type).toBe('block');

    const explicitlyTrustedSend = runPreToolUseChecks({
      toolName: 'mcp__session__send_agent_message',
      input: { sessionId: 'target', message: 'Go do this.' },
      sessionId: 'trusted-industry-hunter',
      permissionMode: 'safe',
      workspaceRootPath: '/tmp/ws',
      workspaceId: 'ws',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      trustedWorkerTools: ['send_agent_message'],
      permissionManager,
    });
    expect(explicitlyTrustedSend.type).toBe('block');

    const explicitlyTrustedApproval = runPreToolUseChecks({
      toolName: 'mcp__session__approve_deep_research_plan',
      input: { runId: 'run_123' },
      sessionId: 'trusted-industry-hunter',
      permissionMode: 'safe',
      workspaceRootPath: '/tmp/ws',
      workspaceId: 'ws',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      trustedWorkerTools: ['approve_deep_research_plan'],
      permissionManager,
    });
    expect(explicitlyTrustedApproval.type).toBe('block');
  });
});
