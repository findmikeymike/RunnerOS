import { describe, expect, test } from 'bun:test';
import {
  fillMissingWorkflowTriggerInputConstraints,
  buildToolNotEnabledDenial,
  isSourceAllowed,
  normalizeWorkflowTriggerInputs,
  parseTriggerToolsetOverride,
  resolveEnabledToolsets,
  resolvePermissionMode,
  TRIGGER_PERMISSION_MODES,
  type TriggerToolsetOverride,
  type PlatformToolsetConfig,
} from './trigger-inputs.ts';
import type { LoadedWorkflow } from './types.ts';

function workflow(inputs: LoadedWorkflow['metadata']['trigger']['inputs']): LoadedWorkflow {
  return {
    slug: 'demo',
    path: '/tmp/demo/WORKFLOW.md',
    source: 'global',
    body: '',
    metadata: {
      name: 'Demo',
      description: 'Demo workflow',
      trigger: { type: 'manual', inputs },
      steps: [{ id: 'one', agent: 'agent', input: 'Do it' }],
    },
  };
}

describe('normalizeWorkflowTriggerInputs', () => {
  test('applies defaults and keeps declared fields only', () => {
    expect(normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
      { name: 'limit', type: 'number', default: 3 },
    ]), { topic: 'markets', extra: 'ignored' })).toEqual({
      topic: 'markets',
      limit: 3,
    });
  });

  test('preserves only recognized runner controls alongside declared inputs', () => {
    expect(normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
    ]), {
      topic: 'markets',
      enabled_source_slugs: ['github'],
      permission_mode: 'subconscious',
      extra: 'ignored',
    })).toEqual({
      topic: 'markets',
      enabled_source_slugs: ['github'],
      permission_mode: 'subconscious',
    });
  });

  test('rejects missing required inputs', () => {
    expect(() => normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
    ]), {})).toThrow('Missing required workflow input: topic');
  });

  test('rejects invalid input types', () => {
    expect(() => normalizeWorkflowTriggerInputs(workflow([
      { name: 'limit', type: 'number' },
    ]), { limit: '5' })).toThrow('Workflow input "limit" must be a number.');
  });

  test('enforces finite numeric range and integer contracts', () => {
    const bounded = workflow([
      { name: 'count', type: 'number', min: 1, max: 25, integer: true },
    ]);

    expect(normalizeWorkflowTriggerInputs(bounded, { count: 12 })).toEqual({ count: 12 });
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: 0 })).toThrow('must be at least 1');
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: 26 })).toThrow('must be at most 25');
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: 1.5 })).toThrow('must be a whole number');
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: Number.POSITIVE_INFINITY })).toThrow('must be a number');
  });

  test('enforces a number input ceiling from another input', () => {
    const related = workflow([
      { name: 'targets', type: 'number', min: 1, max: 25, integer: true },
      { name: 'drafts', type: 'number', min: 0, max: 10, integer: true, maxFrom: 'targets' },
    ]);

    expect(normalizeWorkflowTriggerInputs(related, { targets: 3, drafts: 3 })).toEqual({
      targets: 3,
      drafts: 3,
    });
    expect(() => normalizeWorkflowTriggerInputs(related, { targets: 2, drafts: 3 }))
      .toThrow('Workflow input "drafts" must be no greater than "targets" (2).');
  });
});

describe('fillMissingWorkflowTriggerInputConstraints', () => {
  test('adds new canonical bounds without overwriting user customizations', () => {
    expect(fillMissingWorkflowTriggerInputConstraints(
      [{
        name: 'count',
        type: 'number',
        description: 'My wording',
        min: 3,
        max: 9,
        integer: false,
      }],
      [{
        name: 'count',
        type: 'number',
        description: 'Canonical wording',
        min: 1,
        max: 25,
        integer: true,
        maxFrom: 'ceiling',
      }],
    )).toEqual([{
      name: 'count',
      type: 'number',
      description: 'My wording',
      min: 3,
      max: 9,
      integer: false,
      maxFrom: 'ceiling',
    }]);
  });
});

// ---------------------------------------------------------------------------
// Per-job toolset override (R5, Hermes MIT)
// ---------------------------------------------------------------------------

describe('parseTriggerToolsetOverride', () => {
  test('returns empty when input is undefined/null/non-object', () => {
    expect(parseTriggerToolsetOverride(undefined)).toEqual({});
    expect(parseTriggerToolsetOverride(null)).toEqual({});
    expect(parseTriggerToolsetOverride('string')).toEqual({});
    expect(parseTriggerToolsetOverride(42)).toEqual({});
  });

  test('parses both fields when valid', () => {
    expect(parseTriggerToolsetOverride({
      enabled_source_slugs: ['github', 'slack'],
      permission_mode: 'yolo',
    })).toEqual({
      enabled_source_slugs: ['github', 'slack'],
      permission_mode: 'yolo',
    });
  });

  test('preserves empty array (deny-all sentinel) — distinct from undefined', () => {
    const parsed = parseTriggerToolsetOverride({ enabled_source_slugs: [] });
    expect(parsed.enabled_source_slugs).toEqual([]);
    expect(parsed.enabled_source_slugs).not.toBeUndefined();
  });

  test('backward compat: object without new fields parses to empty override', () => {
    expect(parseTriggerToolsetOverride({ topic: 'markets', limit: 3 })).toEqual({});
  });

  test('rejects non-string-array enabled_source_slugs', () => {
    expect(() => parseTriggerToolsetOverride({ enabled_source_slugs: 'github' })).toThrow();
    expect(() => parseTriggerToolsetOverride({ enabled_source_slugs: [1, 2] })).toThrow();
  });

  test('rejects unknown permission_mode values', () => {
    expect(() => parseTriggerToolsetOverride({ permission_mode: 'garbage' })).toThrow();
  });

  test('accepts every documented permission_mode value', () => {
    for (const mode of TRIGGER_PERMISSION_MODES) {
      expect(parseTriggerToolsetOverride({ permission_mode: mode }).permission_mode).toBe(mode);
    }
  });
});

describe('resolveEnabledToolsets — precedence chain (Hermes cron/scheduler.py:60-88)', () => {
  test('per-job override wins over platform + default', () => {
    const perJobOverride: TriggerToolsetOverride = { enabled_source_slugs: ['github'] };
    const perPlatformConfig: PlatformToolsetConfig = {
      cron: { enabled_source_slugs: ['slack', 'github'] },
    };
    const defaultToolset = ['fs', 'github', 'slack'];
    expect(resolveEnabledToolsets({ perJobOverride, perPlatformConfig, defaultToolset }))
      .toEqual(['github']);
  });

  test('per-platform wins when per-job override absent', () => {
    const perPlatformConfig: PlatformToolsetConfig = {
      cron: { enabled_source_slugs: ['slack'] },
    };
    expect(resolveEnabledToolsets({
      perPlatformConfig,
      defaultToolset: ['fs', 'github', 'slack'],
    })).toEqual(['slack']);
  });

  test('default wins when per-job + per-platform both absent', () => {
    expect(resolveEnabledToolsets({ defaultToolset: ['fs', 'github'] }))
      .toEqual(['fs', 'github']);
  });

  test('undefined when no layer specifies anything (no gating)', () => {
    expect(resolveEnabledToolsets({})).toBeUndefined();
  });

  test('empty array on per-job override → deny-all, NOT default fallback', () => {
    const perJobOverride: TriggerToolsetOverride = { enabled_source_slugs: [] };
    const result = resolveEnabledToolsets({
      perJobOverride,
      perPlatformConfig: { cron: { enabled_source_slugs: ['slack'] } },
      defaultToolset: ['fs', 'github', 'slack'],
    });
    expect(result).toEqual([]);
    expect(result).not.toBeUndefined();
  });

  test('empty array on per-platform layer → deny-all at platform level', () => {
    const result = resolveEnabledToolsets({
      perPlatformConfig: { cron: { enabled_source_slugs: [] } },
      defaultToolset: ['fs', 'github'],
    });
    expect(result).toEqual([]);
  });

  test('undefined on per-job → falls through to per-platform (does NOT deny)', () => {
    const result = resolveEnabledToolsets({
      perJobOverride: { permission_mode: 'yolo' }, // no enabled_source_slugs
      perPlatformConfig: { cron: { enabled_source_slugs: ['slack'] } },
      defaultToolset: ['fs', 'github'],
    });
    expect(result).toEqual(['slack']);
  });

  test('non-existent per-platform key falls through to default (Hermes graceful degradation)', () => {
    // platformKey="cron" but config only has "workflow" — should fall through.
    const result = resolveEnabledToolsets({
      perPlatformConfig: { workflow: { enabled_source_slugs: ['x'] } },
      platformKey: 'cron',
      defaultToolset: ['fs', 'github'],
    });
    expect(result).toEqual(['fs', 'github']);
  });

  test('resolver does NOT validate slug existence — matches Hermes (runtime checks at call site)', () => {
    expect(resolveEnabledToolsets({
      perJobOverride: { enabled_source_slugs: ['nonexistent-slug-xyz'] },
    })).toEqual(['nonexistent-slug-xyz']);
  });

  test('dedupes and trims slugs', () => {
    expect(resolveEnabledToolsets({
      perJobOverride: { enabled_source_slugs: ['github', ' github ', 'slack', '', 'slack'] },
    })).toEqual(['github', 'slack']);
  });

  test('platformKey="workflow" reads the workflow layer', () => {
    expect(resolveEnabledToolsets({
      perPlatformConfig: {
        cron: { enabled_source_slugs: ['cron-only'] },
        workflow: { enabled_source_slugs: ['workflow-only'] },
      },
      platformKey: 'workflow',
    })).toEqual(['workflow-only']);
  });
});

describe('resolvePermissionMode', () => {
  test('per-job override wins', () => {
    expect(resolvePermissionMode({
      perJobOverride: { permission_mode: 'yolo' },
      perPlatformConfig: { cron: { permission_mode: 'subconscious' } },
    })).toBe('yolo');
  });

  test('platform layer wins when per-job absent', () => {
    expect(resolvePermissionMode({
      perPlatformConfig: { cron: { permission_mode: 'subconscious' } },
    })).toBe('subconscious');
  });

  test('defaults to "default" when nothing specified', () => {
    expect(resolvePermissionMode({})).toBe('default');
  });
});

describe('isSourceAllowed + buildToolNotEnabledDenial — runtime gating', () => {
  test('undefined resolved list → allow (no gating active)', () => {
    expect(isSourceAllowed(undefined, 'github')).toBe(true);
    expect(isSourceAllowed(undefined, 'anything')).toBe(true);
  });

  test('empty resolved list → deny everything', () => {
    expect(isSourceAllowed([], 'github')).toBe(false);
    expect(isSourceAllowed([], '')).toBe(false);
  });

  test('non-empty list → allow only members', () => {
    expect(isSourceAllowed(['github'], 'github')).toBe(true);
    expect(isSourceAllowed(['github'], 'slack')).toBe(false);
  });

  test('denial payload carries the rejected slug and is typed as denied:true', () => {
    const denial = buildToolNotEnabledDenial('slack');
    expect(denial.denied).toBe(true);
    expect(denial.sourceSlug).toBe('slack');
    expect(denial.error).toContain('slack');
    expect(denial.error).toContain('not enabled');
  });
});

describe('integration: per-job override end-to-end (no full agent boot)', () => {
  // Simulates the workflow-runner tool-dispatch gate. The runner resolves the
  // allow-list once at agent-init, then on each tool call consults
  // `isSourceAllowed`. If the slug is outside the list, the dispatcher returns
  // the typed denial without invoking the underlying tool.
  function simulateToolDispatch(allowList: string[] | undefined, requestedSlug: string) {
    if (!isSourceAllowed(allowList, requestedSlug)) {
      return buildToolNotEnabledDenial(requestedSlug);
    }
    return { ok: true as const, slug: requestedSlug };
  }

  test('workflow with enabled_source_slugs:["github"] rejects a slack tool call', () => {
    const resolved = resolveEnabledToolsets({
      perJobOverride: { enabled_source_slugs: ['github'] },
      defaultToolset: ['github', 'slack', 'fs'], // would have allowed slack
    });
    const result = simulateToolDispatch(resolved, 'slack');
    expect(result).toEqual({
      denied: true,
      sourceSlug: 'slack',
      error: expect.stringContaining('slack'),
    });
  });

  test('workflow with enabled_source_slugs:["github"] permits a github tool call', () => {
    const resolved = resolveEnabledToolsets({
      perJobOverride: { enabled_source_slugs: ['github'] },
    });
    expect(simulateToolDispatch(resolved, 'github')).toEqual({ ok: true, slug: 'github' });
  });

  test('workflow with empty deny-all override rejects every tool call (including default-toolset members)', () => {
    const resolved = resolveEnabledToolsets({
      perJobOverride: { enabled_source_slugs: [] },
      defaultToolset: ['github', 'fs'],
    });
    expect(simulateToolDispatch(resolved, 'github')).toEqual({
      denied: true,
      sourceSlug: 'github',
      error: expect.any(String),
    });
    expect(simulateToolDispatch(resolved, 'fs')).toEqual({
      denied: true,
      sourceSlug: 'fs',
      error: expect.any(String),
    });
  });

  test('workflow with no override + workspace default toolset permits default members', () => {
    const resolved = resolveEnabledToolsets({
      defaultToolset: ['github', 'fs'],
    });
    expect(simulateToolDispatch(resolved, 'github')).toEqual({ ok: true, slug: 'github' });
    expect(simulateToolDispatch(resolved, 'slack')).toEqual({
      denied: true,
      sourceSlug: 'slack',
      error: expect.any(String),
    });
  });
});
