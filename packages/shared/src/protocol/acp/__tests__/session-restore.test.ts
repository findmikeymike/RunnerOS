/**
 * In-flight session survives server restart via SQLite.
 *
 * Ported from Hermes hermes_acp/tests/test_session_restore.py (MIT).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { RunnerOSACPAgent } from '../server.ts';

function startServer(dbPath: string) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const agent = new RunnerOSACPAgent({ dbPath, stdin, stdout });
  void agent.start();
  let nextId = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const rl = createInterface({ input: stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as Record<string, unknown>;
    if ('result' in msg || 'error' in msg) {
      const w = pending.get(msg.id as number);
      if (w) {
        pending.delete(msg.id as number);
        w(msg);
      }
    }
  });
  const send = (method: string, params: unknown): Promise<unknown> => {
    nextId += 1;
    const id = nextId;
    const p = new Promise<unknown>((res) => pending.set(id, res));
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  };
  const stop = () => {
    agent.stop();
    stdin.end();
    rl.close();
  };
  return { agent, send, stop };
}

describe('ACP session restore across server restart', () => {
  test('client can resume session after server "crash"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-restart-'));
    const dbPath = join(dir, 'state.db');
    try {
      // -------- Server 1 --------
      const s1 = startServer(dbPath);
      await s1.send('initialize', {});
      const newResp = (await s1.send('session/new', { cwd: '/Users/me/proj' })) as {
        result: { sessionId: string };
      };
      const sessionId = newResp.result.sessionId;
      await s1.send('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'first turn before crash' }],
      });
      // simulate crash — full teardown
      s1.stop();
      // Give the OS a moment to close the file descriptor.
      await new Promise((r) => setTimeout(r, 50));

      // -------- Server 2 --------
      const s2 = startServer(dbPath);
      await s2.send('initialize', {});
      // session/load should succeed for the persisted id
      const loadResp = (await s2.send('session/load', { sessionId })) as {
        result?: { sessionId: string };
        error?: unknown;
      };
      expect(loadResp.error).toBeUndefined();
      expect(loadResp.result?.sessionId).toBe(sessionId);

      // History should include the first-turn user message we sent before crash.
      const state = s2.agent.sessions.getSession(sessionId);
      expect(state).not.toBeNull();
      expect(state!.history.length).toBeGreaterThan(0);
      expect(state!.history[0]).toMatchObject({
        role: 'user',
        content: 'first turn before crash',
      });
      s2.stop();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
