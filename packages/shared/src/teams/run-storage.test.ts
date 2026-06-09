import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTeamTask,
  getTeamRunFile,
  isValidTeamRunId,
  listTeamRuns,
  readTeamRunDetail,
  sendTeamMessage,
  updateTeamTask,
  writeTeamRun,
} from './run-storage.ts';
import type { TeamRunSnapshot } from './run-types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'team-runs-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function sampleRun(overrides?: Partial<TeamRunSnapshot>): TeamRunSnapshot {
  return {
    id: RUN_ID,
    workspaceId: 'workspace-1',
    teamSlug: 'engineering-ship-team',
    state: 'created',
    userRequest: 'Ship the feature',
    teamSnapshot: {
      metadata: {
        name: 'Engineering Ship Team',
        description: 'Ships features',
        lead: 'system-architect',
        members: [
          { slug: 'coder', role: 'Implementation' },
          { slug: 'reviewer', role: 'Review' },
        ],
        permissionMode: 'ask',
      },
      body: '# Team',
    },
    permissionMode: 'ask',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('team run storage', () => {
  test('validates run ids', () => {
    expect(isValidTeamRunId(RUN_ID)).toBe(true);
    expect(isValidTeamRunId('../bad')).toBe(false);
  });

  test('writes, reads, and lists run snapshots', () => {
    writeTeamRun(workspace, sampleRun());

    expect(existsSync(getTeamRunFile(workspace, RUN_ID))).toBe(true);
    const runs = listTeamRuns(workspace);
    expect(runs.map((run) => run.id)).toEqual([RUN_ID]);
    expect(runs[0]!.teamSlug).toBe('engineering-ship-team');
  });

  test('creates tasks, updates derived run state, and persists messages/events', () => {
    writeTeamRun(workspace, sampleRun());

    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Implement storage',
      description: 'Add run persistence',
      ownerAgentSlug: 'coder',
      priority: 'high',
    });
    expect(task.status).toBe('todo');

    const message = sendTeamMessage(workspace, RUN_ID, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'coder',
      taskId: task.id,
      kind: 'assignment',
      body: 'Please implement this.',
    });
    expect(message.kind).toBe('assignment');

    const done = updateTeamTask(workspace, RUN_ID, task.id, {
      status: 'done',
      output: 'Implemented.',
    });
    expect(done.status).toBe('done');

    const detail = readTeamRunDetail(workspace, RUN_ID);
    expect(detail?.state).toBe('done');
    expect(detail?.tasks).toHaveLength(1);
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'task.created',
      'message.sent',
      'task.updated',
    ]);
  });

  test('skips malformed jsonl records while preserving valid records', () => {
    writeTeamRun(workspace, sampleRun());
    createTeamTask(workspace, RUN_ID, {
      title: 'Valid task',
      description: '',
      ownerAgentSlug: 'coder',
    });
    writeFileSync(join(workspace, '.runneros', 'teams', 'runs', RUN_ID, 'tasks.jsonl'), '{"bad": true}\n', { flag: 'a' });

    expect(readTeamRunDetail(workspace, RUN_ID)?.tasks).toHaveLength(1);
  });
});
