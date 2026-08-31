/**
 * Tiny echo ACP server used as a remote endpoint in client-bridge tests.
 * Acts as a Zed-like agent target. Speaks line-delimited JSON-RPC on stdio.
 */

import { RunnerOSACPAgent } from '../../server.ts';

const agent = new RunnerOSACPAgent({
  // ':memory:' is the default; explicit for clarity.
  dbPath: ':memory:',
  onPrompt: async ({ text, sendUpdate }) => {
    await sendUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `echo: ${text}` },
    });
    return { stopReason: 'end_turn' };
  },
});

void agent.start().then(() => {
  process.exit(0);
});
