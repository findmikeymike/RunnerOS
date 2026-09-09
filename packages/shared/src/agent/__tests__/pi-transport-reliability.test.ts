import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';

function agent(): any {
  return new PiAgent({ provider: 'pi', workspace: { id: 'transport-test', name: 'Test', rootPath: tmpdir() }, isHeadless: true } as any);
}

describe('Pi transport reliability', () => {
  it('finishes a real subprocess ready/auto-compaction handshake before concurrent callers proceed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-handshake-'));
    const server = join(dir, 'server.js');
    writeFileSync(server, `
      const readline = require('node:readline');
      const lines = readline.createInterface({ input: process.stdin });
      lines.on('line', line => {
        const msg = JSON.parse(line);
        if (msg.type === 'init') console.log(JSON.stringify({ type: 'ready' }));
        if (msg.type === 'set_auto_compaction') console.log(JSON.stringify({ type: 'set_auto_compaction_result', id: msg.id, enabled: msg.enabled }));
        if (msg.type === 'shutdown') process.exit(0);
      });
    `);
    const a = agent();
    a.config.runtime = { paths: { piServer: server, node: process.execPath } };
    a.resolvedCwd = () => dir;
    a.getPiAuth = async () => ({ provider: 'openai', type: 'api_key', key: 'test' });
    const sent: string[] = [];
    const send = a.send.bind(a);
    a.send = (msg: any) => { sent.push(msg.type); send(msg); };
    const previousTimeout = (PiAgent as any).SUBPROCESS_STARTUP_TIMEOUT_MS;
    (PiAgent as any).SUBPROCESS_STARTUP_TIMEOUT_MS = 2000;
    try {
      await Promise.all([a.ensureSubprocess(), a.ensureSubprocess()]);
      expect(sent.filter(type => type === 'init')).toHaveLength(1);
      expect(sent.filter(type => type === 'set_auto_compaction')).toHaveLength(1);
      expect(sent).toContain('register_tools');
      expect(a.pendingAutoCompactionToggles.size).toBe(0);
    } finally {
      a.destroy();
      (PiAgent as any).SUBPROCESS_STARTUP_TIMEOUT_MS = previousTimeout;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const willRetry of [true, false]) {
    it(`keeps recovery streaming until settled (agent_end willRetry=${willRetry})`, async () => {
      const a = agent();
      const events: any[] = [];
      const draining = (async () => { for await (const e of a.eventQueue.drain()) events.push(e); })();
      a.handleSubprocessEvent({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: willRetry ? '503 Service unavailable' : 'Context length exceeded' } });
      a.handleSubprocessEvent({ type: 'agent_end', messages: [], willRetry });
      await Promise.resolve();
      const endedEarly = a.eventQueue.isComplete;
      a.handleSubprocessEvent({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Recovered answer' }] } });
      a.handleSubprocessEvent({ type: 'agent_settled' });
      // Cleanup also bounds the regression on the old implementation.
      a.eventQueue.complete();
      await draining;
      a.destroy();
      expect(endedEarly).toBe(false);
      expect(events.filter(e => e.type === 'complete')).toHaveLength(1);
      expect(events.some(e => e.type === 'text_complete' && e.text === 'Recovered answer')).toBe(true);
      expect(events.some(e => e.type === 'typed_error' || e.type === 'error')).toBe(false);
    });
  }

  it('isolates a failed LLM query from a healthy query and title generation', () => {
    const a = agent();
    const rejected: string[] = [];
    for (const id of ['bad', 'healthy']) a.pendingLlmQueries.set(id, { resolve() {}, reject() { rejected.push(id); } });
    a.pendingMiniCompletions.set('title', { resolve() {}, reject() { rejected.push('title'); } });
    a.handleLine(JSON.stringify({ type: 'error', code: 'llm_query_error', id: 'bad', message: 'Unknown model' }));
    expect(rejected).toEqual(['bad']);
    expect(a.pendingLlmQueries.has('healthy')).toBe(true);
    expect(a.pendingMiniCompletions.has('title')).toBe(true);
    a.destroy();
  });

  for (const mode of ['exit', 'timeout', 'stop', 'spawn-error'] as const) {
    it(`rejects startup on ${mode}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pi-startup-'));
      const server = join(dir, 'server.js');
      writeFileSync(server, mode === 'exit' ? 'process.exit(7)' : 'setInterval(() => {}, 1000)');
      const a = agent();
      a.config.runtime = { paths: { piServer: server, node: mode === 'spawn-error' ? join(dir, 'missing-runtime') : process.execPath } };
      a.resolvedCwd = () => dir;
      a.getPiAuth = async () => ({ provider: 'openai', type: 'api_key', key: 'test' });
      const previousTimeout = (PiAgent as any).SUBPROCESS_STARTUP_TIMEOUT_MS;
      (PiAgent as any).SUBPROCESS_STARTUP_TIMEOUT_MS = mode === 'exit' ? 1000 : 50;
      let watchdog: ReturnType<typeof setTimeout>;
      try {
        const start = a.ensureSubprocess().then(() => 'ready', (e: Error) => e.message);
        if (mode === 'stop') await a.abort();
        const outcome = await Promise.race([start, new Promise<string>(resolve => { watchdog = setTimeout(() => resolve('hung'), 1500); })]);
        expect(outcome).not.toBe('hung');
        expect(outcome).toMatch(mode === 'exit' ? /exited|code.?7/ : mode === 'timeout' ? /timed out/ : mode === 'spawn-error' ? /ENOENT/ : /abort/i);
      } finally {
        clearTimeout(watchdog!);
        a.destroy();
        (PiAgent as any).SUBPROCESS_STARTUP_TIMEOUT_MS = previousTimeout;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('shares initialization and prevents a late spawn after Stop during credential loading', async () => {
    const a = agent();
    a.config.runtime = { paths: { piServer: '/tmp/unused-pi-server.js', node: process.execPath } };
    let release!: (value: unknown) => void;
    let credentialReads = 0;
    a.getPiAuth = () => { credentialReads++; return new Promise(resolve => { release = resolve; }); };
    const first = a.ensureSubprocess().then(() => 'ready', (e: Error) => e.message);
    const second = a.ensureSubprocess().then(() => 'ready', (e: Error) => e.message);
    await a.abort();
    expect(await first).toMatch(/abort/i);
    expect(await second).toMatch(/abort/i);
    release({ provider: 'openai', type: 'api_key', key: 'test' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(credentialReads).toBe(1);
    expect(a.subprocess).toBeNull();
    a.destroy();
  });

  it('supports legacy targeted results without failing siblings on an uncorrelated error envelope', () => {
    const a = agent();
    const rejected: string[] = [];
    for (const id of ['bad', 'healthy']) a.pendingLlmQueries.set(id, { resolve() {}, reject() { rejected.push(id); } });
    a.handleLine(JSON.stringify({ type: 'error', code: 'llm_query_error', message: 'Unknown model' }));
    expect(rejected).toEqual([]);
    a.handleLine(JSON.stringify({ type: 'llm_query_result', id: 'bad', result: null, errorMessage: 'Unknown model' }));
    expect(rejected).toEqual(['bad']);
    expect(a.pendingLlmQueries.has('healthy')).toBe(true);
    a.destroy();
  });
});
