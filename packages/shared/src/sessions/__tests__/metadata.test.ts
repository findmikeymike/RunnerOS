import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { StoredSession } from '../types.ts'
import { getSessionFilePath, loadSession, saveSession, updateSessionMetadata } from '../storage.ts'

function makeTmpDir(): string {
  const dir = join(tmpdir(), `session-metadata-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
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
  } as StoredSession
}

describe('session metadata persistence', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = makeTmpDir()
    await saveSession(makeStoredSession(workspaceRoot))
  })

  afterEach(() => {
    if (existsSync(workspaceRoot)) {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('can clear a persisted session model override', async () => {
    await updateSessionMetadata(workspaceRoot, 'session-1', { model: undefined })

    expect(loadSession(workspaceRoot, 'session-1')?.model).toBeUndefined()
  })

  it('round-trips chat-native Goal state through the session header', async () => {
    const goal = {
      schemaVersion: 1 as const,
      id: 'goal-1',
      objective: 'Finish the release plan',
      status: 'active' as const,
      revision: 1,
      round: 1,
      maxRounds: 6,
      createdAt: 1000,
      updatedAt: 1000,
    }

    await updateSessionMetadata(workspaceRoot, 'session-1', { chatGoal: goal })

    expect(loadSession(workspaceRoot, 'session-1')?.chatGoal).toEqual(goal)
  })

  it('drops malformed persisted Goal state on load', () => {
    const sessionFile = getSessionFilePath(workspaceRoot, 'session-1')
    const lines = readFileSync(sessionFile, 'utf8').trimEnd().split('\n')
    const header = JSON.parse(lines[0]!)
    header.chatGoal = { schemaVersion: 1, id: 'goal-1', objective: '', status: 'active' }
    lines[0] = JSON.stringify(header)
    writeFileSync(sessionFile, `${lines.join('\n')}\n`)

    expect(loadSession(workspaceRoot, 'session-1')?.chatGoal).toBeUndefined()
  })
})
