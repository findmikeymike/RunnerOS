import { describe, expect, it } from 'bun:test';
import { createSessionTaskList, delegateSessionTask, startSessionTask } from '@craft-agent/shared/sessions';
import type { AgentMessageReceipt, AgentMessageStatus } from '@craft-agent/shared/agent-messaging';
import { reconcileSessionTaskListAfterRestart, relocateImportedSessionTaskList } from './SessionManager.ts';

const NOW = '2026-08-30T12:00:00.000Z';

function receipt(status: AgentMessageStatus, overrides: Partial<AgentMessageReceipt> = {}): AgentMessageReceipt {
  return {
    schemaVersion: 1,
    id: 'receipt-1',
    workspaceId: 'workspace-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    targetAgentSlug: 'researcher',
    task: 'Research the release',
    status,
    policy: {
      permissionMode: 'ask',
      timeoutSeconds: 60,
      maxTurns: 3,
      maxDepth: 2,
      depth: 1,
    },
    constraints: { sourceSlugs: [], skillSlugs: [] },
    createdAt: NOW,
    updatedAt: NOW,
    result: status === 'succeeded' ? { summary: 'Research complete.', toolUseCount: 1, toolNames: ['search'] } : undefined,
    error: status === 'failed' ? { code: 'child-failed', message: 'Research failed.' } : undefined,
    ...overrides,
  };
}

function delegatedList() {
  const list = createSessionTaskList([
    { content: 'Research the release' },
  ], 'native-tool', { id: 'tasks_1', taskIds: ['task_1'], now: NOW });
  return delegateSessionTask(list, 'task_1', {
    receiptId: 'receipt-1',
    childSessionId: 'child-1',
    targetAgentSlug: 'researcher',
    dispatchedAt: NOW,
  }, NOW);
}

describe('session task restart reconciliation', () => {
  it('settles a terminal receipt immediately after restart', () => {
    const recovered = reconcileSessionTaskListAfterRestart(delegatedList(), {
      parentSessionId: 'parent-1',
      childSessionExists: () => true,
      readReceipt: () => receipt('succeeded'),
      now: NOW,
    });

    expect(recovered.items[0]?.status).toBe('completed');
    expect(recovered.items[0]?.delegation?.outcome).toBe('succeeded');
    expect(recovered.items[0]?.delegation?.summary).toBe('Research complete.');
  });

  it('keeps a running claim only while its child session still exists', () => {
    const running = reconcileSessionTaskListAfterRestart(delegatedList(), {
      parentSessionId: 'parent-1',
      childSessionExists: () => true,
      readReceipt: () => receipt('running'),
      now: NOW,
    });
    const orphaned = reconcileSessionTaskListAfterRestart(delegatedList(), {
      parentSessionId: 'parent-1',
      childSessionExists: () => false,
      readReceipt: () => receipt('running'),
      now: NOW,
    });

    expect(running.items[0]?.status).toBe('delegated');
    expect(orphaned.items[0]?.status).toBe('pending');
    expect(orphaned.items[0]?.delegation?.outcome).toBe('failed');
    expect(orphaned.items[0]?.delegation?.settlementKind).toBe('orphaned');
    expect(orphaned.items[0]?.delegation?.summary).toContain('Orphaned delegation');
  });

  it('surfaces receipt read failures instead of fabricating an orphan', () => {
    expect(() => reconcileSessionTaskListAfterRestart(delegatedList(), {
      parentSessionId: 'parent-1',
      childSessionExists: () => true,
      readReceipt: () => { throw new Error('receipt disk unavailable'); },
      now: NOW,
    })).toThrow('receipt disk unavailable');
  });

  it('demotes interrupted local work even when no delegation exists', () => {
    const active = startSessionTask(createSessionTaskList([
      { content: 'Draft the release plan' },
    ], 'native-tool', { id: 'tasks_1', taskIds: ['task_1'], now: NOW }), 'task_1', NOW);
    const recovered = reconcileSessionTaskListAfterRestart(active, {
      parentSessionId: 'parent-1',
      childSessionExists: () => false,
      readReceipt: () => null,
      now: NOW,
    });

    expect(recovered.items[0]?.status).toBe('pending');
  });

  it('applies the exact relocation policy used by remote and bundle imports', () => {
    const source = delegatedList();
    const transferred = relocateImportedSessionTaskList(source, 'transfer');
    const forked = relocateImportedSessionTaskList(source, 'fork');

    expect(transferred?.id).toBe(source.id);
    expect(transferred?.items[0]?.status).toBe('pending');
    expect(transferred?.items[0]?.delegation).toBeUndefined();
    expect(forked?.id).not.toBe(source.id);
    expect(forked?.items[0]?.status).toBe('pending');
    expect(forked?.items[0]?.delegation).toBeUndefined();
    expect(() => relocateImportedSessionTaskList({ schemaVersion: 99 }, 'transfer')).toThrow('Invalid task list');
  });
});
