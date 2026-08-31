/**
 * End-to-end ACP client/server test using a tiny TS test harness that
 * acts as a Zed-like ACP client. Validates that `delegateToAcpEndpoint`
 * routes through the ACP wire format.
 *
 * Test harness: TypeScript (this file). Spawns a subprocess that loads
 * `fixtures/echo-acp-agent.ts` as the remote ACP server.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { delegateToAcpEndpoint } from '../spawn-bridge.ts';
import { ACPClient } from '../client.ts';

const FIXTURE = join(__dirname, 'fixtures', 'echo-acp-agent.ts');

describe('delegateToAcpEndpoint (stdio)', () => {
  test('fixture exists', () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  test('opens, prompts, returns updates and stopReason', async () => {
    const endpoint = `stdio:bun ${FIXTURE}`;
    const result = await delegateToAcpEndpoint({
      endpoint,
      prompt: 'hello remote',
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    expect(result.sessionId).toMatch(/^acp-/);
    expect(result.stopReason).toBe('end_turn');
    // The echo fixture sends one agent_message_chunk update.
    const messages = result.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk');
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('ACPClient.open() spawn-failure handling', () => {
  test('rejects within seconds (not minutes) when endpoint binary is missing', async () => {
    const client = new ACPClient({
      // Suppress noisy stderr forwarding during the test.
      onRemoteLog: () => {},
      earlyConnectivityWindowMs: 500,
    });
    const start = Date.now();
    let err: unknown;
    try {
      await client.open('stdio:/nonexistent/path/to/acp-binary-xyz');
    } catch (e) {
      err = e;
    } finally {
      await client.close().catch(() => undefined);
    }
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    // Should mention ENOENT (or at least a spawn-failure flavor), NOT the
    // generic 5-min timeout from the outer caller.
    expect(/ENOENT|spawn|closed unexpectedly|EACCES/i.test(msg)).toBe(true);
    // Must reject in under 5s — the regression we're guarding against is a
    // 5-minute hang via the upstream delegate timeout.
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);
});
