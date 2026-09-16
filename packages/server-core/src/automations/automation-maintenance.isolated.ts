import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertContextDoc, loadContextDoc } from '@craft-agent/shared/workspace-context'
import { SCHEDULED_WORK_CONTEXT_SLUG, scheduledWorkMetadata, serializeScheduledWorkBody, parseScheduledWorkDocResult, scheduledWorkDefinitionDigest, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
const root = mkdtempSync(join(tmpdir(), 'automation-maintenance-'))
const workspace = { id: 'test-workspace', rootPath: root }
let denied = false
let failWorkWrite = false
const actualContext = { ...await import('@craft-agent/shared/workspace-context') }
mock.module('@craft-agent/shared/workspace-context', () => ({ ...actualContext, upsertContextDoc: (...args: Parameters<typeof actualContext.upsertContextDoc>) => {
  if (failWorkWrite && args[1].slug === SCHEDULED_WORK_CONTEXT_SLUG) { failWorkWrite = false; throw new Error('Injected work write failure') }
  return actualContext.upsertContextDoc(...args)
} }))
const actualConfig = { ...await import('@craft-agent/shared/config') }
const actualWorkspaces = { ...await import('@craft-agent/shared/workspaces') }
mock.module('@craft-agent/shared/config', () => ({ ...actualConfig, getWorkspaceByNameOrId: (id: string) => id === workspace.id ? workspace : null }))
mock.module('@craft-agent/shared/workspaces', () => ({ ...actualWorkspaces, assertTeamPermission: (path: string) => { if (path !== root || denied) throw new Error('Permission denied') } }))
const { listAutomationMaintenance, getAutomationMaintenance, updateAutomationMaintenance } = await import('./automation-maintenance')
const configPath = join(root, 'automations.json')
const base = { id: 'abc123', name: 'Report', cron: '0 9 * * 1', timezone: 'UTC', enabled: true, actions: [{ type: 'prompt', prompt: 'TOPSECRET report text', agentSlug: 'reporter' }] }
const writeConfig = (matchers: Record<string, unknown>[] = [base]) => writeFileSync(configPath, JSON.stringify({ version: 2, automations: { SchedulerTick: matchers } }))
beforeEach(() => { rmSync(root, { recursive: true, force: true }); mkdirSync(root); denied = false; writeConfig() })
afterAll(() => rmSync(root, { recursive: true, force: true }))
const change = async (patch: Record<string, unknown>) => {
  const { automation } = await getAutomationMaintenance(workspace.id, base.id)
  return updateAutomationMaintenance(workspace.id, { automationId: base.id, expectedRevision: automation.revision, intent: 'User asked for this', patch })
}
function work(status: 'running' | 'scheduled', id: string): ScheduledWorkOrder {
  const now = new Date().toISOString()
  return { version: 1, id, title: 'Report', owner: { scope: 'hq', workspaceId: workspace.id }, calendarLink: { calendar: 'hq', itemId: id }, calendarVisibility: 'hidden', type: 'agent-task', status,
    startAt: now, timezone: 'UTC', execution: { type: 'agent-task', agentSlug: 'reporter', brief: 'Report', permissionMode: 'safe', expectedOutput: { requirement: 'none' } },
    inputRefs: [], approvals: [], runs: [], executionKey: { payloadDigest: 'digest', idempotencyKey: id },
    automationRef: { matcherId: base.id, event: 'SchedulerTick', name: 'Report', definitionDigest: 'digest', actionIndex: 0, configurationDigest: 'digest' }, createdAt: now, updatedAt: now }
}
function writeWork(items: ScheduledWorkOrder[]) {
  upsertContextDoc(root, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody({ version: 1, workspaceId: workspace.id, items, updatedAt: new Date().toISOString() }) })
}
test('list/get are bounded and redact live saved secrets/history', async () => {
  writeConfig([base, { ...base, id: 'def456' }])
  writeFileSync(join(root, 'automations-history.jsonl'), JSON.stringify({ id: base.id, ts: 10, ok: false, error: 'SECRET', prompt: 'TOPSECRET' }) + '\n')
  const list = await listAutomationMaintenance(workspace.id, { limit: 1 })
  expect(list.hasMore).toBe(true)
  expect(list.automations[0]?.lastOutcome).toEqual({ ok: false, ts: 10 })
  expect(JSON.stringify(list)).not.toContain('SECRET')
  expect(JSON.stringify(await getAutomationMaintenance(workspace.id, base.id))).not.toContain('TOPSECRET')
})
test('wrong workspace and team-denied reads/writes fail', async () => {
  await expect(getAutomationMaintenance('other', base.id)).rejects.toThrow('Workspace')
  denied = true
  await expect(listAutomationMaintenance(workspace.id)).rejects.toThrow('Permission')
  await expect(change({ enabled: false })).rejects.toThrow('Permission')
  expect(JSON.parse(readFileSync(configPath, 'utf8')).automations.SchedulerTick[0].enabled).toBe(true)
})
test('invalid schedule leaves saved config unchanged', async () => {
  const old = readFileSync(configPath, 'utf8')
  await expect(change({ trigger: { type: 'schedule', cron: 'not cron' } })).rejects.toThrow('Invalid automation')
  expect(readFileSync(configPath, 'utf8')).toBe(old)
})
test('malformed pending work fails before replacing config', async () => {
  upsertContextDoc(root, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: '```json\n{"invalid":true}\n```' })
  const old = readFileSync(configPath, 'utf8')
  await expect(change({ enabled: false })).rejects.toThrow()
  expect(readFileSync(configPath, 'utf8')).toBe(old)
})
test('queue cancellation keeps active work, and repeat updates create nothing', async () => {
  writeWork([work('scheduled', 'pending'), work('running', 'active')])
  const changed = await change({ enabled: false })
  expect(changed).toMatchObject({ changed: true, canceledQueuedWork: 1, runningWork: 1 })
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG)!, workspace.id)
  expect(parsed.ok && parsed.work.items.map(item => item.status)).toEqual(['canceled', 'running'])
  const repeated = await change({ enabled: false })
  expect(repeated).toMatchObject({ changed: false, canceledQueuedWork: 0 })
  expect(JSON.parse(readFileSync(configPath, 'utf8')).automations.SchedulerTick).toHaveLength(1)
})
test('concurrent updates conflict instead of clobbering another edit', async () => {
  const { automation } = await getAutomationMaintenance(workspace.id, base.id)
  const request = { automationId: base.id, expectedRevision: automation.revision, intent: 'Edit' }
  const results = await Promise.allSettled([
    updateAutomationMaintenance(workspace.id, { ...request, patch: { name: 'First' } }),
    updateAutomationMaintenance(workspace.id, { ...request, patch: { name: 'Second' } }),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
})

test('a missing workflow remains pausable but cannot be resumed', async () => {
  writeConfig([{ ...base, scheduleWorkKey: 'original', scheduleWorkDigest: 'digest', scheduleWorkIntentDigest: 'intent', actions: [{ type: 'queue-work', ownerScope: 'hq', title: 'Report', execution: { type: 'workflow-run', workflowSlug: 'missing-workflow', workflowDigest: 'missing', triggerInputs: {} } }] }])
  expect((await change({ enabled: false })).automation.enabled).toBe(false)
  await expect(change({ enabled: true })).rejects.toThrow('not found')
  expect(JSON.parse(readFileSync(configPath, 'utf8')).automations.SchedulerTick[0].enabled).toBe(false)
})
test('a retry after settings saved recovers still-pending obsolete work', async () => {
  writeConfig([{ ...base, enabled: false }])
  writeWork([work('scheduled', 'uncleaned'), work('running', 'active')])
  const result = await change({ enabled: false })
  expect(result).toMatchObject({ changed: false, canceledQueuedWork: 1, runningWork: 1 })
})

test('an unchanged enabled retry preserves work from the current definition', async () => {
  const action = { type: 'queue-work', ownerScope: 'hq', title: 'Report', execution: { type: 'agent-task', agentSlug: 'reporter', brief: 'Report', permissionMode: 'safe', expectedOutput: { requirement: 'none' } } }
  writeConfig([{ ...base, actions: [action] }])
  const fresh = work('scheduled', 'fresh')
  fresh.automationRef!.configurationDigest = scheduledWorkDefinitionDigest({ matcherId: base.id, actionIndex: 0, event: 'SchedulerTick', action })
  writeWork([work('scheduled', 'stale'), fresh])
  expect(await change({ enabled: true })).toMatchObject({ changed: false, canceledQueuedWork: 1 })
  const result = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG)!, workspace.id)
  expect(result.ok && result.work.items.map(item => item.status)).toEqual(['canceled', 'scheduled'])
})

test('trigger-only save failure recovers exact old queued work without canceling new work', async () => {
  const action = { type: 'queue-work', ownerScope: 'hq', title: 'Report', execution: { type: 'agent-task', agentSlug: 'reporter', brief: 'Report', permissionMode: 'safe', expectedOutput: { requirement: 'none' } } }
  writeConfig([{ ...base, actions: [action] }])
  const digest = scheduledWorkDefinitionDigest({ matcherId: base.id, actionIndex: 0, event: 'SchedulerTick', action })
  const old = work('scheduled', 'before-edit')
  old.automationRef!.configurationDigest = digest
  writeWork([old])
  failWorkWrite = true
  const patch = { trigger: { type: 'schedule' as const, cron: '0 17 * * 5' } }
  await expect(change(patch)).rejects.toThrow('settings were saved')
  const saved = JSON.parse(readFileSync(configPath, 'utf8')).automations.SchedulerTick[0]
  expect(saved.cron).toBe('0 17 * * 5')
  expect(saved._pendingWorkCleanup).toEqual(['before-edit'])
  expect(JSON.stringify(await getAutomationMaintenance(workspace.id, base.id))).not.toContain('_pendingWorkCleanup')
  const fresh = work('scheduled', 'after-edit')
  fresh.automationRef!.configurationDigest = digest
  writeWork([old, fresh])
  expect(await change(patch)).toMatchObject({ changed: false, canceledQueuedWork: 1 })
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG)!, workspace.id)
  expect(parsed.ok && parsed.work.items.map(item => item.status)).toEqual(['canceled', 'scheduled'])
  expect(JSON.parse(readFileSync(configPath, 'utf8')).automations.SchedulerTick[0]._pendingWorkCleanup).toBeUndefined()
})
