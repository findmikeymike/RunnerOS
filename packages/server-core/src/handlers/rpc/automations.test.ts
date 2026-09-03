import { describe, expect, test } from 'bun:test'
import { scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { assertAutomationQueueWorkBindings, automaticScheduleOccupancyFromConfig, beginPromptAutomation, findAutomationMatcherIndexByIdentity, replacementAutomationMatcher, uniqueWebhookSlug } from './automations'

describe('automation RPC helpers', () => {
  test('extracts enabled scheduled work for atomic automatic placement', () => {
    expect(automaticScheduleOccupancyFromConfig({ automations: { SchedulerTick: [
      { cron: '0 9 * * 1', timezone: 'America/Chicago', actions: [{ type: 'prompt', prompt: 'Run.' }] },
      { cron: '30 9 * * 2', enabled: false, actions: [{ type: 'prompt', prompt: 'Run.' }] },
      { name: 'not scheduled yet', actions: [{ type: 'prompt', prompt: 'Run.' }] },
    ] } })).toEqual([
      { cron: '0 9 * * 1', enabled: true, timezone: 'America/Chicago' },
      { cron: '30 9 * * 2', enabled: false, timezone: undefined },
    ])
  })

  test('fails closed when scheduled occupancy cannot be trusted', () => {
    expect(() => automaticScheduleOccupancyFromConfig({ automations: { SchedulerTick: {} } })).toThrow('cannot be trusted')
    expect(() => automaticScheduleOccupancyFromConfig({ automations: { SchedulerTick: [
      { cron: 'not a cron', actions: [{ type: 'prompt', prompt: 'Run.' }] },
    ] } })).toThrow('Invalid cron expression')
    expect(() => automaticScheduleOccupancyFromConfig({ automations: { SchedulerTick: [
      { cron: '0 9 * * 1', timezone: 'Nowhere/Imaginary', actions: [{ type: 'prompt', prompt: 'Run.' }] },
    ] } })).toThrow('Invalid timezone')
  })

  test('gives duplicated webhook automations a valid unique slug', () => {
    const matchers = [
      { slug: 'campaign-ready' },
      { slug: 'campaign-ready-copy' },
    ]
    expect(uniqueWebhookSlug('campaign-ready', matchers, true)).toBe('campaign-ready-copy-2')
  })

  test('keeps generated webhook slugs within the schema limit', () => {
    const base = 'a'.repeat(64)
    const duplicate = uniqueWebhookSlug(base, [{ slug: base }], true)
    expect(duplicate.length).toBeLessThanOrEqual(64)
    expect(duplicate).toMatch(/-copy$/)
  })

  test('builds an atomic replacement without changing the automation identity', () => {
    const current = { id: 'abc123', name: 'Old scan', cron: '0 9 * * 1' }
    const replacement = { name: 'Weekly Signal Scan', cron: '0 10 * * 1' }

    expect(replacementAutomationMatcher(current, replacement, () => 'unused')).toEqual({
      id: 'abc123',
      name: 'Weekly Signal Scan',
      cron: '0 10 * * 1',
    })
    expect(replacement).toEqual({ name: 'Weekly Signal Scan', cron: '0 10 * * 1' })
  })

  test('trims a replacement name before persistence', () => {
    expect(replacementAutomationMatcher({ id: 'abc123' }, { name: '  Weekly scan  ' }, () => 'unused').name)
      .toBe('Weekly scan')
  })

  test('validates workflow bindings against the targeted workflow before persistence', () => {
    const workflow = {
      slug: 'brief-run', path: '/tmp/brief-run', source: 'global' as const, body: '',
      metadata: {
        name: 'Brief run', description: '', trigger: { type: 'manual' as const, inputs: [{ name: 'brief', type: 'string' as const, required: true }] },
        steps: [{ id: 'run', agent: 'writer', input: '{{trigger.brief}}' }],
      },
    }
    const matcher = {
      actions: [{
        type: 'queue-work', ownerScope: 'hq', title: 'Brief run',
        execution: { type: 'workflow-run', workflowSlug: workflow.slug, workflowDigest: scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }), triggerInputs: {} },
        inputBindings: {},
      }],
    }
    const deps = { loadWorkflow: () => workflow, activeWorkflowSlugs: () => [workflow.slug] }
    expect(() => assertAutomationQueueWorkBindings('/tmp', 'SchedulerTick', matcher, deps))
      .toThrow('Workflow input needs a binding: brief')
    const validMatcher = {
      ...matcher,
      actions: [{ ...matcher.actions[0]!, inputBindings: { brief: { mode: 'fixed' as const, value: 'Launch' } } }],
    }
    expect(() => assertAutomationQueueWorkBindings('/tmp', 'SchedulerTick', validMatcher, deps)).not.toThrow()
  })

  test('validates legacy workflow trigger inputs when binding metadata is absent', () => {
    const workflow = {
      slug: 'brief-run', path: '/tmp/brief-run', source: 'global' as const, body: '',
      metadata: {
        name: 'Brief run', description: '', trigger: { type: 'manual' as const, inputs: [{ name: 'brief', type: 'string' as const, required: true }] },
        steps: [{ id: 'run', agent: 'writer', input: '{{trigger.brief}}' }],
      },
    }
    const digest = scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body })
    const matcher = {
      actions: [{
        type: 'queue-work', ownerScope: 'hq', title: 'Brief run',
        execution: { type: 'workflow-run', workflowSlug: workflow.slug, workflowDigest: digest, triggerInputs: {} },
      }],
    }
    const deps = { loadWorkflow: () => workflow, activeWorkflowSlugs: () => [workflow.slug] }
    expect(() => assertAutomationQueueWorkBindings('/tmp', 'SchedulerTick', matcher, deps)).toThrow('Missing required workflow input: brief')
    matcher.actions[0]!.execution.triggerInputs = { brief: 'Launch' }
    expect(() => assertAutomationQueueWorkBindings('/tmp', 'SchedulerTick', matcher, deps)).not.toThrow()
  })

  test('rejects unsigned webhook payload bindings before persistence', () => {
    const workflow = {
      slug: 'webhook-run', path: '/tmp/webhook-run', source: 'global' as const, body: '',
      metadata: {
        name: 'Webhook run', description: '', trigger: { type: 'manual' as const, inputs: [{ name: 'body', type: 'string' as const, required: true }] },
        steps: [{ id: 'run', agent: 'writer', input: '{{trigger.body}}' }],
      },
    }
    const matcher = {
      allowUnauthenticated: true,
      actions: [{
        type: 'queue-work', ownerScope: 'hq', title: 'Webhook run',
        execution: { type: 'workflow-run', workflowSlug: workflow.slug, workflowDigest: scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }), triggerInputs: {} },
        inputBindings: { body: { mode: 'trigger', from: 'webhook.body' } },
      }],
    }
    expect(() => assertAutomationQueueWorkBindings('/tmp', 'WebhookReceive', matcher, {
      loadWorkflow: () => workflow,
      activeWorkflowSlugs: () => [workflow.slug],
    })).toThrow('Unauthenticated webhooks cannot supply workflow input values')
  })

  test('targets automation replacement by stable identity and rejects a stale revision', () => {
    const matchers = [
      { id: 'first1', name: 'Different job' },
      { id: 'signal1', name: 'Weekly Signal Scan', enabled: true },
    ]
    const expected = { id: 'signal1', name: 'Weekly Signal Scan', enabled: true }

    expect(findAutomationMatcherIndexByIdentity(matchers, 'signal1', expected)).toBe(1)
    expect(() => findAutomationMatcherIndexByIdentity(
      [{ id: 'signal1', name: 'Weekly Signal Scan', enabled: false }],
      'signal1',
      expected,
    )).toThrow('changed since this screen loaded')
  })

  test('matches one legacy automation by exact revision without trusting its stale array index', () => {
    const expected = { name: 'Legacy Signal Scan', cron: '0 9 * * 1' }
    expect(findAutomationMatcherIndexByIdentity(
      [{ name: 'Other' }, expected],
      'SchedulerTick-0',
      expected,
    )).toBe(1)
  })

  test('returns a prompt automation start without waiting for the model turn', async () => {
    let finish!: () => void
    const launch = beginPromptAutomation(async (onSessionCreated) => {
      onSessionCreated('session-spotify')
      await new Promise<void>((resolve) => { finish = resolve })
      return { sessionId: 'session-spotify' }
    })

    await expect(launch.started).resolves.toEqual({ sessionId: 'session-spotify' })
    let completed = false
    void launch.completion.then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)

    finish()
    await expect(launch.completion).resolves.toEqual({ sessionId: 'session-spotify' })
  })

  test('surfaces a prompt automation failure that occurs before session creation', async () => {
    const launch = beginPromptAutomation(async () => {
      throw new Error('agent unavailable')
    })

    await expect(launch.started).rejects.toThrow('agent unavailable')
    await expect(launch.completion).rejects.toThrow('agent unavailable')
  })
})
