/**
 * Integration tests for ShellHookHandler — verifies the `shell-hook` action
 * type routes through the runner and surfaces normalised outcomes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WorkspaceEventBus } from '../event-bus.ts';
import { ShellHookHandler, buildHookEvent, type ShellHookAction, type ShellHookOutcome } from './shell-hook-handler.ts';
import type { AutomationsConfigProvider } from './types.ts';
import type { AutomationEvent, AutomationMatcher } from '../types.ts';

const FIXTURES = path.join(
  import.meta.dir,
  '..',
  'hooks',
  '__tests__',
  'fixtures'
);

function makeProvider(matchersByEvent: Partial<Record<AutomationEvent, AutomationMatcher[]>>): AutomationsConfigProvider {
  return {
    getConfig: () => ({ automations: matchersByEvent }) as never,
    getMatchersForEvent: (event: AutomationEvent) => matchersByEvent[event] ?? [],
  };
}

let workDir: string;
let allowlistPath: string;
let bus: WorkspaceEventBus;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'rnos-handler-'));
  allowlistPath = path.join(workDir, 'allowlist.json');
  bus = new WorkspaceEventBus('test-ws');
});

afterEach(async () => {
  bus.dispose();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('buildHookEvent', () => {
  it('maps PreToolUse → pre_tool_call and hoists tool fields out of extra', () => {
    const action: ShellHookAction = { type: 'shell-hook', command: '/bin/true' };
    const ev = buildHookEvent(
      'PreToolUse',
      {
        workspaceId: 'ws', timestamp: Date.now(),
        sessionId: 'sess', toolName: 'terminal', toolInput: { command: 'ls' },
      } as never,
      action,
      'sess'
    );
    expect(ev.hook_event_name).toBe('pre_tool_call');
    expect(ev.tool_name).toBe('terminal');
    expect(ev.tool_input).toEqual({ command: 'ls' });
    expect(ev.session_id).toBe('sess');
    expect(ev.extra).not.toHaveProperty('toolName');
    expect(ev.extra).not.toHaveProperty('toolInput');
  });

  it('honors an explicit action.event override', () => {
    const action: ShellHookAction = { type: 'shell-hook', command: '/bin/true', event: 'custom_event' };
    const ev = buildHookEvent('PreToolUse', { workspaceId: 'ws', timestamp: 0 } as never, action, undefined);
    expect(ev.hook_event_name).toBe('custom_event');
  });
});

describe('ShellHookHandler — DSL routing', () => {
  it('routes a matching shell-hook action through the runner and surfaces a block outcome', async () => {
    const outcomes: ShellHookOutcome[] = [];
    const matcher: AutomationMatcher = {
      id: 'm-blk',
      matcher: 'terminal',
      actions: [
        {
          type: 'shell-hook',
          command: path.join(FIXTURES, 'hook-block-claude.sh'),
          event: 'pre_tool_call',
          // Per-action accept_hooks bypass — keeps the test non-interactive.
          acceptHooks: true,
        } as unknown as AutomationMatcher['actions'][number],
      ],
    };

    const handler = new ShellHookHandler(
      {
        workspaceId: 'test-ws',
        workspaceRootPath: workDir,
        sessionId: 'sess',
        allowlistPath,
        onHookResult: (o) => outcomes.push(o),
      },
      makeProvider({ PreToolUse: [matcher] })
    );
    handler.subscribe(bus);

    await bus.emit('PreToolUse', {
      workspaceId: 'test-ws',
      timestamp: Date.now(),
      sessionId: 'sess',
      toolName: 'terminal',
      toolInput: { command: 'rm -rf /' },
    } as never);

    expect(outcomes).toHaveLength(1);
    const out = outcomes[0]!;
    expect(out.event).toBe('PreToolUse');
    expect(out.matcherId).toBe('m-blk');
    // Claude-Code wire shape normalised:
    expect(out.response).toEqual({ action: 'block', message: 'forbidden by script' });

    handler.dispose();
  });

  it('surfaces a context-injection response unchanged', async () => {
    const outcomes: ShellHookOutcome[] = [];
    const matcher: AutomationMatcher = {
      id: 'm-ctx',
      matcher: '.*',
      actions: [
        {
          type: 'shell-hook',
          command: `python3 ${path.join(FIXTURES, 'hook-context.py')}`,
          event: 'pre_llm_call',
          acceptHooks: true,
        } as unknown as AutomationMatcher['actions'][number],
      ],
    };

    const handler = new ShellHookHandler(
      {
        workspaceId: 'test-ws',
        workspaceRootPath: workDir,
        allowlistPath,
        onHookResult: (o) => outcomes.push(o),
      },
      makeProvider({ UserPromptSubmit: [matcher] })
    );
    handler.subscribe(bus);

    await bus.emit('UserPromptSubmit', {
      workspaceId: 'test-ws',
      timestamp: Date.now(),
      sessionId: 'sess',
    } as never);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.response).toEqual({ context: 'Today is Friday' });
    handler.dispose();
  });

  it('ignores actions that are not shell-hook', async () => {
    const outcomes: ShellHookOutcome[] = [];
    const matcher: AutomationMatcher = {
      id: 'm-other',
      matcher: '.*',
      actions: [
        { type: 'prompt', prompt: 'unrelated' } as unknown as AutomationMatcher['actions'][number],
      ],
    };

    const handler = new ShellHookHandler(
      {
        workspaceId: 'test-ws',
        workspaceRootPath: workDir,
        allowlistPath,
        onHookResult: (o) => outcomes.push(o),
      },
      makeProvider({ PreToolUse: [matcher] })
    );
    handler.subscribe(bus);

    await bus.emit('PreToolUse', {
      workspaceId: 'test-ws',
      timestamp: Date.now(),
      sessionId: 'sess',
      toolName: 'terminal',
      toolInput: {},
    } as never);

    expect(outcomes).toEqual([]);
    handler.dispose();
  });
});

describe('ShellHookHandler — registry wiring', () => {
  it('is exported from automations/handlers/index.ts under ShellHookHandler', async () => {
    const mod = await import('./index.ts');
    expect(typeof (mod as { ShellHookHandler?: unknown }).ShellHookHandler).toBe('function');
  });
});
