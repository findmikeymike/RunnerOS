import { describe, expect, test } from 'bun:test';
import {
  clampPermissionMode,
  createDelegationReceipt,
  derivePermissionInheritance,
  failDelegationReceipt,
  isDelegationReceipt,
  isPermissionEscalation,
  succeedDelegationReceipt,
  toDelegationResult,
} from './receipt.ts';
import type { CreateDelegationReceiptInput } from './types.ts';

function baseInput(overrides?: Partial<CreateDelegationReceiptInput>): CreateDelegationReceiptInput {
  return {
    workspaceId: 'ws-1',
    targetAgentSlug: 'reviewer',
    task: 'Review the change',
    callerAgentSlug: 'system-architect',
    teamRunId: '66666666-6666-4666-8666-666666666666',
    teamTaskId: 'task_abc',
    policy: { permissionMode: 'ask', timeoutSeconds: 300, maxTurns: 20, maxDepth: 3, depth: 1 },
    permissionInheritance: derivePermissionInheritance('ask', 'ask'),
    ...overrides,
  };
}

describe('permission inheritance (canonical rule: child ≤ parent)', () => {
  test('escalation is detected and clamped', () => {
    expect(isPermissionEscalation('safe', 'allow-all')).toBe(true);
    expect(isPermissionEscalation('ask', 'allow-all')).toBe(true);
    expect(isPermissionEscalation('allow-all', 'safe')).toBe(false);
    expect(clampPermissionMode('safe', 'allow-all')).toBe('safe');
    expect(clampPermissionMode('ask', 'safe')).toBe('safe'); // child may be MORE restrictive
    expect(clampPermissionMode('allow-all', 'ask')).toBe('ask');
  });

  test('derivePermissionInheritance records the clamp', () => {
    const escalated = derivePermissionInheritance('safe', 'allow-all');
    expect(escalated).toEqual({ parentMode: 'safe', requestedMode: 'allow-all', effectiveMode: 'safe', clamped: true });
    const ok = derivePermissionInheritance('allow-all', 'ask');
    expect(ok.clamped).toBe(false);
    expect(ok.effectiveMode).toBe('ask');
  });
});

describe('delegation receipt lifecycle', () => {
  test('createDelegationReceipt produces a valid running receipt', () => {
    const r = createDelegationReceipt(baseInput());
    expect(isDelegationReceipt(r)).toBe(true);
    expect(r.schemaVersion).toBe(1);
    expect(r.status).toBe('running');
    expect(r.id.startsWith('dlg_')).toBe(true);
    expect(r.constraints.sourceSlugs).toEqual([]);
    expect(r.completedAt).toBeUndefined();
  });

  test('succeed transitions to terminal success with result + childSessionId', () => {
    const r = createDelegationReceipt(baseInput());
    const done = succeedDelegationReceipt(
      r,
      { output: { verdict: 'pass' }, summary: 'ok', toolUseCount: 3, toolNames: ['read', 'grep'] },
      'child-session-1',
    );
    expect(done.status).toBe('succeeded');
    expect(done.childSessionId).toBe('child-session-1');
    expect(done.result?.toolUseCount).toBe(3);
    expect(done.completedAt).toBeDefined();
  });

  test('fail transitions to terminal failure with error', () => {
    const r = createDelegationReceipt(baseInput());
    const failed = failDelegationReceipt(r, 'timed-out', { code: 'timeout', message: 'exceeded 300s' });
    expect(failed.status).toBe('timed-out');
    expect(failed.error?.code).toBe('timeout');
  });

  test('toDelegationResult mirrors the message_agent result shape', () => {
    const r = createDelegationReceipt(baseInput());
    const done = succeedDelegationReceipt(r, { output: 42, toolUseCount: 1, toolNames: ['bash'] }, 'c1');
    const result = toDelegationResult(done);
    expect(result.ok).toBe(true);
    expect(result.agentSlug).toBe('reviewer');
    expect(result.receiptId).toBe(done.id);
    expect(result.childSessionId).toBe('c1');
    expect(result.output).toBe(42);
    expect(result.toolNames).toEqual(['bash']);
    expect(typeof result.durationMs).toBe('number');
  });

  test('isDelegationReceipt rejects malformed shapes', () => {
    expect(isDelegationReceipt(null)).toBe(false);
    expect(isDelegationReceipt({ schemaVersion: 2 })).toBe(false);
    expect(isDelegationReceipt({ ...createDelegationReceipt(baseInput()), status: 'bogus' })).toBe(false);
  });
});
