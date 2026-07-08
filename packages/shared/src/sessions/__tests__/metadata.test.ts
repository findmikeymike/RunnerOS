import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredSession } from '../types.ts';
import { loadSession, saveSession, updateSessionMetadata } from '../storage.ts';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `session-metadata-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeStoredSession(workspaceRootPath: string): StoredSession {
  return {
    id: 'session-1',
    workspaceRootPath,
    createdAt: 1000,
    lastUsedAt: 1000,
    model: 'pi/deepseek/deepseek-v4-pro',
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  } as StoredSession;
}

describe('session metadata persistence', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = makeTmpDir();
    await saveSession(makeStoredSession(workspaceRoot));
  });

  afterEach(() => {
    if (existsSync(workspaceRoot)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('can clear a persisted session model override', async () => {
    await updateSessionMetadata(workspaceRoot, 'session-1', { model: undefined });

    expect(loadSession(workspaceRoot, 'session-1')?.model).toBeUndefined();
  });
});
