import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, loadSession } from '../storage';
import { pickSessionFields } from '../utils';

test('explicit fallback role survives session storage and persistent field selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-role-'));
  try {
    for (const modelFallbackRole of ['reasoning', 'fast'] as const) {
      const session = await createSession(root, { modelFallbackRole });
      expect(loadSession(root, session.id)?.modelFallbackRole).toBe(modelFallbackRole);
      expect(pickSessionFields(session).modelFallbackRole).toBe(modelFallbackRole);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
