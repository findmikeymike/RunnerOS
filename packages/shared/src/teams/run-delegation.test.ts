import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendTeamDelegationReceipt,
  listTeamDelegationReceipts,
  updateTeamDelegationReceipt,
  writeTeamRun,
} from './run-storage.ts';
import {
  createDelegationReceipt,
  derivePermissionInheritance,
  succeedDelegationReceipt,
} from '../delegation/receipt.ts';
import type { TeamRunSnapshot } from './run-types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'team-dlg-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const RUN_ID = '66666666-6666-4666-8666-666666666666';

function sampleRun(): TeamRunSnapshot {
  return {
    id: RUN_ID,
    workspaceId: 'workspace-1',
    teamSlug: 'engineering-ship-team',
    state: 'running',
    userRequest: 'Ship it',
    teamSnapshot: {
      metadata: {
        name: 'Engineering Ship Team',
        description: 'Ships features',
        lead: 'system-architect',
        members: [{ slug: 'reviewer', role: 'Review' }],
        permissionMode: 'ask',
      },
      body: '# Team',
    },
    permissionMode: 'ask',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function receipt() {
  return createDelegationReceipt({
    workspaceId: 'workspace-1',
    targetAgentSlug: 'reviewer',
    task: 'Review the change',
    callerAgentSlug: 'system-architect',
    teamRunId: RUN_ID,
    teamTaskId: 'task_abc',
    policy: { permissionMode: 'ask', timeoutSeconds: 300, maxTurns: 20, maxDepth: 3, depth: 1 },
    permissionInheritance: derivePermissionInheritance('ask', 'ask'),
  });
}

describe('U2: team delegation receipt persistence', () => {
  test('append + list round-trips a receipt', () => {
    writeTeamRun(workspace, sampleRun());
    const r = receipt();
    appendTeamDelegationReceipt(workspace, RUN_ID, r);
    const all = listTeamDelegationReceipts(workspace, RUN_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(r.id);
    expect(all[0]!.targetAgentSlug).toBe('reviewer');
  });

  test('update replaces a receipt by id (running → succeeded)', () => {
    writeTeamRun(workspace, sampleRun());
    const r = receipt();
    appendTeamDelegationReceipt(workspace, RUN_ID, r);
    const done = succeedDelegationReceipt(r, { output: 'ok', toolUseCount: 2, toolNames: ['read', 'grep'] }, 'child-1');
    const updated = updateTeamDelegationReceipt(workspace, RUN_ID, done);
    expect(updated).not.toBeNull();
    const all = listTeamDelegationReceipts(workspace, RUN_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('succeeded');
    expect(all[0]!.childSessionId).toBe('child-1');
  });

  test('rejects a receipt whose teamRunId does not match', () => {
    writeTeamRun(workspace, sampleRun());
    const mismatched = { ...receipt(), teamRunId: '77777777-7777-4777-8777-777777777777' };
    expect(() => appendTeamDelegationReceipt(workspace, RUN_ID, mismatched)).toThrow(/does not match/);
  });

  test('update returns null for an unknown receipt id', () => {
    writeTeamRun(workspace, sampleRun());
    expect(updateTeamDelegationReceipt(workspace, RUN_ID, receipt())).toBeNull();
  });
});
