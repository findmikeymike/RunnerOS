/**
 * Verifies the spawn-session-tool acpEndpoint branch:
 *   - acpEndpoint set → delegates to remote (uses fixture echo agent)
 *   - acpEndpoint absent → unchanged local behaviour (calls getSpawnSessionFn)
 *
 * The `createSpawnSessionTool` returned object is the Anthropic SDK
 * tool shape; we exercise its handler indirectly via its `execute`
 * method.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSpawnSessionTool } from '../../../agent/spawn-session-tool.ts';

const FIXTURE = join(__dirname, 'fixtures', 'echo-acp-agent.ts');

// The SDK `tool()` helper returns an object shaped like
// `{ name, description, inputSchema, execute }`. We call `execute` directly
// in unit tests to bypass the agent loop.
interface InvokeResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

async function invoke(tool: unknown, args: Record<string, unknown>): Promise<InvokeResult> {
  const rec = tool as { handler?: unknown; execute?: unknown };
  const handler = rec.handler ?? rec.execute;
  if (typeof handler !== 'function') {
    throw new Error('createSpawnSessionTool: no callable handler');
  }
  const out = await (handler as (a: unknown) => Promise<unknown>)(args);
  return out as InvokeResult;
}

describe('spawn-session-tool acpEndpoint branch', () => {
  test('with acpEndpoint set, delegates to remote ACP agent', async () => {
    const tool = createSpawnSessionTool({
      sessionId: 'test-session',
      getSpawnSessionFn: () => {
        throw new Error('local spawn should NOT be called when acpEndpoint is set');
      },
      acpEndpoint: `stdio:bun ${FIXTURE}`,
    });
    const result = await invoke(tool, {
      prompt: 'route me through ACP',
      workingDirectory: process.cwd(),
    });
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (!first) throw new Error('expected content block');
    const payload = JSON.parse(first.text);
    expect(payload.stopReason).toBe('end_turn');
    expect(payload.sessionId).toMatch(/^acp-/);
  }, 15_000);

  test('without acpEndpoint, uses local spawn (regression check)', async () => {
    let localCalled = false;
    const tool = createSpawnSessionTool({
      sessionId: 'test-session',
      getSpawnSessionFn: () =>
        (async (_args: Record<string, unknown>) => {
          localCalled = true;
          return {
            sessionId: 'local-1',
            name: 'local-1',
            status: 'created',
          } as unknown;
        }) as never,
    });
    const result = await invoke(tool, { prompt: 'hi' });
    expect(result.isError).toBeFalsy();
    expect(localCalled).toBe(true);
  });
});
