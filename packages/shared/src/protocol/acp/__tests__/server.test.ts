/**
 * End-to-end test of the stdio ACP server using a pair of in-memory
 * PassThrough streams as the JSON-RPC transport. The test harness acts
 * as a Zed-like ACP client.
 *
 * Ported in spirit from the Hermes acp_adapter test suite (MIT).
 */

import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { RunnerOSACPAgent } from '../server.ts';
import type {
  InitializeResult,
  JsonRpcRequest,
  PermissionResponse,
  SessionNewResult,
  SessionUpdate,
} from '../types.ts';

interface Harness {
  agent: RunnerOSACPAgent;
  serverIn: PassThrough; // client → server
  serverOut: PassThrough; // server → client
  send: (req: Partial<JsonRpcRequest> & { method: string }) => number;
  nextResponse: (id: number) => Promise<unknown>;
  updates: SessionUpdate[];
  permissionRequests: Array<{ id: number; params: unknown }>;
  /** Reply to a server-initiated permission request. */
  replyPermission: (id: number, resp: PermissionResponse) => void;
  stop: () => void;
}

function buildHarness(opts?: ConstructorParameters<typeof RunnerOSACPAgent>[0]): Harness {
  const serverIn = new PassThrough();
  const serverOut = new PassThrough();
  const agent = new RunnerOSACPAgent({
    ...opts,
    stdin: serverIn,
    stdout: serverOut,
  });
  void agent.start();

  let reqId = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const updates: SessionUpdate[] = [];
  const permissionRequests: Array<{ id: number; params: unknown }> = [];

  const rl = createInterface({ input: serverOut });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as Record<string, unknown>;
    if ('result' in msg || 'error' in msg) {
      const waiter = pending.get(msg.id as number);
      if (waiter) {
        pending.delete(msg.id as number);
        waiter(msg);
      }
    } else if ('method' in msg) {
      if (msg.method === 'session/update') {
        const p = msg.params as { update: SessionUpdate };
        updates.push(p.update);
      } else if (msg.method === 'session/request_permission') {
        permissionRequests.push({ id: msg.id as number, params: msg.params });
      }
    }
  });

  return {
    agent,
    serverIn,
    serverOut,
    send(req) {
      reqId += 1;
      const id = reqId;
      const frame = JSON.stringify({ jsonrpc: '2.0', id, ...req });
      serverIn.write(frame + '\n');
      return id;
    },
    nextResponse(id) {
      return new Promise((res) => pending.set(id, res));
    },
    updates,
    permissionRequests,
    replyPermission(id, resp) {
      serverIn.write(JSON.stringify({ jsonrpc: '2.0', id, result: resp }) + '\n');
    },
    stop() {
      agent.stop();
      serverIn.end();
      rl.close();
    },
  };
}

describe('ACP server: stdio JSON-RPC lifecycle', () => {
  test('initialize advertises auth methods', async () => {
    const h = buildHarness({
      authMethods: [
        { id: 'env', name: 'Env credentials' },
        { id: 'oauth', name: 'OAuth' },
      ],
    });
    try {
      const id = h.send({ method: 'initialize', params: {} });
      const resp = (await h.nextResponse(id)) as { result: InitializeResult };
      expect(resp.result.protocolVersion).toBe(1);
      expect(resp.result.authMethods).toHaveLength(2);
      expect(resp.result.agentCapabilities.loadSession).toBe(true);
    } finally {
      h.stop();
    }
  });

  test('session/new returns a sessionId', async () => {
    const h = buildHarness();
    try {
      const id = h.send({ method: 'session/new', params: { cwd: '/tmp' } });
      const resp = (await h.nextResponse(id)) as { result: SessionNewResult };
      expect(resp.result.sessionId).toMatch(/^acp-/);
    } finally {
      h.stop();
    }
  });

  test('session/prompt streams tool-call updates and finishes', async () => {
    const h = buildHarness({
      onPrompt: async ({ sendUpdate }) => {
        await sendUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-1',
          title: 'read: /etc/hosts',
          kind: 'read',
          status: 'in_progress',
          content: [],
        });
        await sendUpdate({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-1',
          status: 'completed',
          content: [{ type: 'text', text: 'ok' }],
        });
        return { stopReason: 'end_turn' };
      },
    });
    try {
      const newId = h.send({ method: 'session/new', params: { cwd: '/tmp' } });
      const newResp = (await h.nextResponse(newId)) as { result: SessionNewResult };
      const promptId = h.send({
        method: 'session/prompt',
        params: {
          sessionId: newResp.result.sessionId,
          prompt: [{ type: 'text', text: 'do the thing' }],
        },
      });
      const promptResp = (await h.nextResponse(promptId)) as {
        result: { stopReason: string };
      };
      expect(promptResp.result.stopReason).toBe('end_turn');
      expect(h.updates.length).toBeGreaterThanOrEqual(2);
      const start = h.updates[0] as { sessionUpdate: string; kind?: string };
      expect(start.sessionUpdate).toBe('tool_call');
      expect(start.kind).toBe('read');
    } finally {
      h.stop();
    }
  });

  test('server delivers permission requests and accepts client reply', async () => {
    const h = buildHarness({
      onPrompt: async ({ requestPermission, sendUpdate }) => {
        const resp = await requestPermission({
          sessionId: 'ignored-uses-real',
          toolCall: {
            sessionUpdate: 'tool_call',
            toolCallId: 'perm-1',
            title: 'rm -rf /',
            kind: 'execute',
            status: 'pending',
            content: [],
          },
          options: [
            { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
            { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
          ],
        });
        await sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `decision: ${resp?.outcome.outcome ?? 'null'}` },
        });
        return { stopReason: 'end_turn' };
      },
    });
    try {
      const newId = h.send({ method: 'session/new', params: { cwd: '/tmp' } });
      const newResp = (await h.nextResponse(newId)) as { result: SessionNewResult };
      const promptId = h.send({
        method: 'session/prompt',
        params: {
          sessionId: newResp.result.sessionId,
          prompt: [{ type: 'text', text: 'dangerous' }],
        },
      });

      // Wait for the server to send a permission request.
      const waitForPerm = async (): Promise<{ id: number; params: unknown }> => {
        for (let i = 0; i < 200; i++) {
          const first = h.permissionRequests[0];
          if (first) return first;
          await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error('permission request not delivered');
      };
      const perm = await waitForPerm();
      h.replyPermission(perm.id, { outcome: { outcome: 'selected', optionId: 'allow_once' } });

      const final = (await h.nextResponse(promptId)) as { result: { stopReason: string } };
      expect(final.result.stopReason).toBe('end_turn');
      const messages = h.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk');
      expect(messages.length).toBeGreaterThan(0);
    } finally {
      h.stop();
    }
  });
});
