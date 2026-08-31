/**
 * Bridge: spawn-session-tool → remote ACP endpoint.
 *
 * Tiny adapter used both by `spawn-session-tool` (when `acpEndpoint` is set)
 * and by the `acp-spawn` automations handler. Opens a stdio JSON-RPC ACP
 * client, sends a single prompt, collects the streamed updates, returns
 * the final result.
 *
 * Ported from Hermes hermes_acp/ (MIT). See THIRD_PARTY_NOTICES.md.
 */

import { ACPClient } from './client.ts';
import type { SessionUpdate } from './types.ts';

export interface DelegateToAcpInput {
  endpoint: string;
  prompt: string;
  cwd: string;
  /** Max wall-clock time to wait on the remote agent. Default 5 minutes. */
  timeoutMs?: number;
}

export interface DelegateToAcpResult {
  sessionId: string;
  stopReason: string;
  updates: SessionUpdate[];
}

export async function delegateToAcpEndpoint(
  input: DelegateToAcpInput,
): Promise<DelegateToAcpResult> {
  const updates: SessionUpdate[] = [];
  const client = new ACPClient({
    onSessionUpdate: (_sid, update) => {
      updates.push(update);
    },
  });

  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ACP endpoint timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([client.open(input.endpoint), timeoutPromise]);
    const sessionId = await Promise.race([client.createSession(input.cwd), timeoutPromise]);
    const { stopReason } = await Promise.race([
      client.prompt(sessionId, input.prompt),
      timeoutPromise,
    ]);
    return { sessionId, stopReason, updates };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}
