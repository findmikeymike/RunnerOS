import { describe, expect, test } from 'bun:test'
import { automationMaintenanceRevision, automationMaintenanceView, buildAutomationMaintenanceReplacement, isMaintenanceProtected } from './automation-maintenance'

const current = { id: 'abc123', name: 'Weekly report', cron: '0 9 * * 1', timezone: 'America/Chicago', enabled: true, actions: [{ type: 'prompt', agentSlug: 'reporter', prompt: 'Private token TOPSECRET', headers: { Authorization: 'SECRET' } }] }
test('workflow binding inspection exposes modes and known source names without values or private text', () => {
  const action = { type: 'queue-work', execution: { type: 'workflow-run', workflowSlug: 'report', triggerInputs: { token: 'SECRET' }, brief: 'SECRET' }, inputBindings: {
    ask_token: { mode: 'ask', prompt: 'SECRET' }, fixed_token: { mode: 'fixed', value: { secret: 'SECRET' } },
    source: { mode: 'trigger', from: 'file.path', value: 'SECRET' },
    invalid_source: { mode: 'trigger', from: 'SECRET' }, invalid_mode: { mode: 'SECRET' },
    ['x'.repeat(65)]: { mode: 'ask' }, ['url?SECRET']: { mode: 'ask' },
  } }
  const view = automationMaintenanceView('workspace', 'FileWatch', { ...current, actions: [action] })
  expect(view.inputBindings).toEqual({ ask_token: { mode: 'ask' }, fixed_token: { mode: 'fixed' }, source: { mode: 'trigger', from: 'file.path' } })
  expect(JSON.stringify(view)).not.toContain('SECRET')
  expect(automationMaintenanceView('workspace', 'FileWatch', { ...current, actions: [action, action] }).inputBindings).toBeUndefined()
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`input_${i}`, { mode: 'ask' }]))
  expect(Object.keys(automationMaintenanceView('workspace', 'FileWatch', { ...current, actions: [{ ...action, inputBindings: many }] }).inputBindings!)).toHaveLength(50)
})
function edit(patch: Record<string, unknown>, matcher = current, event = 'SchedulerTick') {
  return buildAutomationMaintenanceReplacement('workspace', '/tmp/unused', event, matcher, {
    automationId: matcher.id, expectedRevision: automationMaintenanceRevision('workspace', event, matcher), patch, intent: 'User requested this change',
  })
}

describe('automation maintenance boundaries', () => {
  test('redacts action text, secret credentials, raw URLs and payloads from inspection', () => {
    const matcher = { ...current, pollUrl: 'https://user:SECRET@example.com/TOKEN?key=TOPSECRET', actions: [{ type: 'webhook', url: 'https://example.com/TOKEN', auth: { token: 'TOPSECRET' }, body: { token: 'SECRET' } }] }
    const view = automationMaintenanceView('workspace', 'PollUrl', matcher)
    const text = JSON.stringify(view)
    for (const secret of ['TOPSECRET', 'SECRET', 'TOKEN', 'https://']) expect(text).not.toContain(secret)
    expect(view.executionTarget).toBe('webhook')
    expect(JSON.stringify(automationMaintenanceView('workspace', 'SchedulerTick', current))).not.toContain('TOPSECRET')
  })
  test('updates only the schedule, preserving private actions and identity', () => {
    const replacement = edit({ trigger: { type: 'schedule', cron: '0 17 * * 5' } })
    expect(replacement.id).toBe('abc123')
    expect(replacement.cron).toBe('0 17 * * 5')
    expect(replacement.timezone).toBe('America/Chicago')
    expect(replacement.actions).toEqual(current.actions)
    expect(current.cron).toBe('0 9 * * 1')
  })
  test('pause/resume retains the target and clears snooze on resume', () => {
    const paused = edit({ enabled: false })
    expect(paused.enabled).toBe(false)
    expect(edit({ enabled: true }, { ...current, enabled: false, snoozedUntil: 123 } as typeof current).snoozedUntil).toBeUndefined()
    expect(paused.actions).toEqual(current.actions)
  })
  test('FileWatch inspection exposes only saved supported change types without inventing defaults', () => {
    const matcher = { id: 'file-watch', watchPath: 'builder-qa-fixtures', watchGlob: '*.txt', actions: [] }
    const trigger = (extra: Record<string, unknown> = {}) =>
      automationMaintenanceView('workspace', 'FileWatch', { ...matcher, ...extra }).trigger
    expect(trigger({ watchChangeTypes: ['change'] })).toEqual({
      type: 'file-change', watchPath: 'builder-qa-fixtures', watchGlob: '*.txt', changeTypes: ['change'],
    })
    expect(trigger()).not.toHaveProperty('changeTypes')
    expect(trigger({ watchChangeTypes: [] })).toHaveProperty('changeTypes', [])
    expect(trigger({ watchChangeTypes: ['add', 'SECRET', 'remove', 42] })).toHaveProperty('changeTypes', ['add', 'remove'])
  })
  test('opaque revisions are workspace-scoped and stale updates fail', () => {
    expect(automationMaintenanceRevision('other', 'SchedulerTick', current)).not.toBe(automationMaintenanceRevision('workspace', 'SchedulerTick', current))
    expect(() => buildAutomationMaintenanceReplacement('workspace', '/tmp', 'SchedulerTick', current, { automationId: current.id, expectedRevision: 'stale', patch: { enabled: false }, intent: 'pause' })).toThrow('changed')
  })
  test('rejects changing family, raw actions and ownership fields', () => {
    expect(() => edit({ trigger: { type: 'message' } })).toThrow('trigger families')
    for (const key of ['actions', 'id', 'templateKey', 'permissionMode', 'scheduleWorkDigest']) expect(() => edit({ [key]: 'x' })).toThrow('Unsupported')
    expect(() => edit({ trigger: { type: 'schedule', cron: '0 9 * * 1', secretEnv: 'SECRET' } })).toThrow('Unsupported trigger')
  })
  test('protects application-managed rules and native Pulses', () => {
    for (const matcher of [
      { ...current, templateKey: 'shared' },
      { ...current, actions: [{ type: 'pulse' }] },
      { ...current, actions: [{ type: 'prompt', agentSlug: 'spotify-analyst', taskModeId: 'fresh-snapshot' }] },
      { ...current, actions: [{ type: 'prompt', agentSlug: 'social-publisher', taskModeId: 'growth' }] },
    ]) {
      expect(isMaintenanceProtected(matcher)).toBe(true)
      expect(() => edit({ enabled: false }, matcher as typeof current)).toThrow('app-managed')
    }
  })
  test('cannot weaken incoming webhook authentication', () => {
    const webhook = { ...current, slug: 'reports', secretEnv: 'REPORT_SECRET' }
    expect(() => edit({ trigger: { type: 'webhook', slug: 'reports', allowUnauthenticated: true } }, webhook, 'WebhookReceive')).toThrow('authentication')
    const next = edit({ trigger: { type: 'webhook', slug: 'new-reports' } }, webhook, 'WebhookReceive')
    expect(next.secretEnv).toBe('REPORT_SECRET')
  })
  test('raw webhook or prompt execution cannot be rewritten through tracked execution input', () => {
    expect(() => edit({ execution: { type: 'agent-task', agentSlug: 'writer', brief: 'draft' } })).toThrow('tracked')
  })
  test('tracked execution is resolved by host; old generation inputs are not retained', () => {
    const matcher = { ...current, scheduleWorkKey: 'original', scheduleWorkDigest: 'old', scheduleWorkIntentDigest: 'old', actions: [{ type: 'queue-work', ownerScope: 'hq', title: 'Weekly report', execution: { type: 'workflow-run', workflowSlug: 'old', workflowDigest: 'old' }, inputBindings: { old: { mode: 'ask' } } }] }
    const next = buildAutomationMaintenanceReplacement('workspace', '/tmp', 'SchedulerTick', matcher, {
      automationId: matcher.id, expectedRevision: automationMaintenanceRevision('workspace', 'SchedulerTick', matcher), intent: 'Switch target',
      patch: { execution: { type: 'agent-task', agentSlug: 'writer', brief: 'Draft a report' } },
    }, (_root, request) => { expect(request.destination).toBe('automation'); return { type: 'agent-task', agentSlug: 'writer', brief: 'Draft a report', permissionMode: 'safe', expectedOutput: { requirement: 'none' } } })
    expect((next.actions as any[])[0].inputBindings).toBeUndefined()
    expect(next.scheduleWorkIntentDigest).not.toBe('old')
    const retry = buildAutomationMaintenanceReplacement('workspace', '/tmp', 'SchedulerTick', next, { automationId: matcher.id, expectedRevision: automationMaintenanceRevision('workspace', 'SchedulerTick', next), patch: { enabled: true }, intent: 'Already enabled' })
    expect(retry).toEqual(next)
  })
})

// Run module-mocked filesystem integration in a subprocess, isolated from other suites.
test('maintenance filesystem/queue integration', async () => {
  const fixture = new URL('./automation-maintenance.isolated.ts', import.meta.url).pathname
  const child = Bun.spawn([process.execPath, 'test', fixture], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ code, output: code ? stdout + stderr : '' }).toEqual({ code: 0, output: '' })
}, 20000)
