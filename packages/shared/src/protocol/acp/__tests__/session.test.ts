/**
 * Tests for SessionManager: CRUD, fork, SQLite restore across reopen.
 * Ports the behaviour in Hermes hermes_acp/session.py (MIT).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager, translateAcpCwd } from '../session.ts';

function tmpDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'acp-session-'));
  const path = join(dir, 'state.db');
  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

describe('SessionManager', () => {
  test('createSession + getSession round-trip', () => {
    const mgr = new SessionManager(':memory:');
    const s = mgr.createSession('/tmp/proj');
    expect(s.id).toBeDefined();
    expect(mgr.getSession(s.id)).toEqual(s);
    mgr.close();
  });

  test('forkSession deep-copies history', () => {
    const mgr = new SessionManager(':memory:');
    const a = mgr.createSession('/tmp/proj');
    a.history.push({ role: 'user', content: 'hi' });
    mgr.saveSession(a);
    const b = mgr.forkSession(a.id)!;
    expect(b.id).not.toBe(a.id);
    expect(b.history).toEqual(a.history);
    // mutating fork doesn't affect source
    b.history.push({ role: 'assistant', content: 'forked' });
    mgr.saveSession(b);
    expect(mgr.getSession(a.id)!.history).toHaveLength(1);
    mgr.close();
  });

  test('removeSession clears both memory and disk', () => {
    const { path, cleanup } = tmpDb();
    try {
      const mgr = new SessionManager(path);
      const s = mgr.createSession('/tmp/proj');
      mgr.removeSession(s.id);
      expect(mgr.getSession(s.id)).toBeNull();
      mgr.close();

      // Reopen — still gone.
      const mgr2 = new SessionManager(path);
      expect(mgr2.getSession(s.id)).toBeNull();
      mgr2.close();
    } finally {
      cleanup();
    }
  });

  test('SQLite-backed restore: kill server mid-session, reopen, history intact', () => {
    const { path, cleanup } = tmpDb();
    try {
      // Server 1 — accept a prompt, save state, "crash".
      const mgr = new SessionManager(path);
      const s = mgr.createSession('/Users/me/proj');
      mgr.appendHistory(s.id, { role: 'user', content: 'task in flight' });
      mgr.appendHistory(s.id, { role: 'assistant', content: 'partial response' });
      const savedId = s.id;
      mgr.close();

      // Server 2 — fresh process, same DB.
      const mgr2 = new SessionManager(path);
      const restored = mgr2.getSession(savedId);
      expect(restored).not.toBeNull();
      expect(restored!.history).toEqual([
        { role: 'user', content: 'task in flight' },
        { role: 'assistant', content: 'partial response' },
      ]);
      expect(restored!.cwd).toBe('/Users/me/proj');
      mgr2.close();
    } finally {
      cleanup();
    }
  });
});

describe('translateAcpCwd (WSL)', () => {
  test('passes through POSIX paths unchanged', () => {
    expect(translateAcpCwd('/home/me/proj', { forceWsl: true })).toBe('/home/me/proj');
  });

  test('Windows drive path becomes /mnt/<drive>/...', () => {
    expect(translateAcpCwd('E:\\Projects\\X', { forceWsl: true })).toBe('/mnt/e/Projects/X');
    expect(translateAcpCwd('C:/Users/me', { forceWsl: true })).toBe('/mnt/c/Users/me');
  });

  test('no translation when not WSL', () => {
    expect(translateAcpCwd('E:\\Projects', { forceWsl: false })).toBe('E:\\Projects');
  });
});
