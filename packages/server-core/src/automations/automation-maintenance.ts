import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { assertTeamPermission } from '@craft-agent/shared/workspaces'
import { validateAutomationsConfig, type QueueWorkAction } from '@craft-agent/shared/automations'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import type { ScheduleWorkExecutionInput, ScheduleWorkTriggerInput } from '@craft-agent/session-tools-core'
import { resolveExecution } from '../scheduled-work/HnicScheduledWork'
import { replaceAutomationMatcherGuarded } from '../handlers/rpc/automations'

type Matcher = Record<string, unknown>
export interface AutomationMaintenancePatch {
  name?: string; description?: string; enabled?: boolean
  trigger?: ScheduleWorkTriggerInput; execution?: ScheduleWorkExecutionInput
}
export interface AutomationMaintenanceUpdate {
  automationId: string; expectedRevision: string; patch: AutomationMaintenancePatch; intent: string
}
const families: Record<string, ScheduleWorkTriggerInput['type']> = {
  SchedulerTick: 'schedule', FileWatch: 'file-change', WebhookReceive: 'webhook', PollUrl: 'url-change', MessageReceive: 'message',
}
const actionsOf = (matcher: Matcher): Matcher[] => Array.isArray(matcher.actions) ? matcher.actions as Matcher[] : []
export const automationMaintenanceRevision = (workspaceId: string, eventName: string, matcher: Matcher): string =>
  createHash('sha256').update(JSON.stringify([workspaceId, eventName, matcher])).digest('hex')

export function isMaintenanceProtected(matcher: Matcher): boolean {
  return Boolean(matcher.templateKey || matcher.systemOwned || matcher.protected || matcher.managedBy)
    || actionsOf(matcher).some(action => action.type === 'pulse'
      || (action.agentSlug === 'spotify-analyst' && action.taskModeId === 'fresh-snapshot')
      || (action.agentSlug === 'social-publisher' && action.taskModeId === 'growth'))
}

function visibleTrigger(eventName: string, matcher: Matcher): ScheduleWorkTriggerInput | undefined {
  // Do not echo arbitrary URLs, regexes or payloads, which may embed credentials.
  if (eventName === 'SchedulerTick' && typeof matcher.cron === 'string') return {
    type: 'schedule', cron: matcher.cron, ...(typeof matcher.timezone === 'string' ? { timezone: matcher.timezone } : {}),
  }
  if (eventName === 'FileWatch' && typeof matcher.watchPath === 'string') return {
    type: 'file-change', watchPath: matcher.watchPath,
    ...(typeof matcher.watchGlob === 'string' ? { watchGlob: matcher.watchGlob } : {}),
    ...(Array.isArray(matcher.watchChangeTypes) ? {
      changeTypes: matcher.watchChangeTypes.filter((value): value is 'add' | 'change' | 'remove' =>
        value === 'add' || value === 'change' || value === 'remove'),
    } : {}),
  }
  if (eventName === 'WebhookReceive' && typeof matcher.slug === 'string') return {
    type: 'webhook', slug: matcher.slug,
    ...(typeof matcher.secretEnv === 'string' ? { secretEnv: matcher.secretEnv } : {}),
    ...(matcher.allowUnauthenticated === true ? { allowUnauthenticated: true } : {}),
  }
  return undefined
}

function visibleInputBindings(actions: Matcher[]) {
  // Maintenance execution edits support a single tracked workflow action. Do
  // not merge identically named inputs from unrelated actions into one view.
  if (actions.length !== 1 || actions[0]?.type !== 'queue-work'
    || (actions[0].execution as Matcher | undefined)?.type !== 'workflow-run') return undefined
  const bindings = actions[0].inputBindings
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return undefined
  const summaries: Array<[string, { mode: 'ask' | 'fixed' } | { mode: 'trigger'; from: string }]> = []
  const sources = new Set(['file.path', 'file.name', 'webhook.body', 'message.text', 'url.content'])
  for (const [name, raw] of Object.entries(bindings).slice(0, 50)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)
      || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const binding = raw as Matcher
    if (binding.mode === 'ask' || binding.mode === 'fixed') summaries.push([name, { mode: binding.mode }])
    else if (binding.mode === 'trigger' && typeof binding.from === 'string' && sources.has(binding.from)) {
      summaries.push([name, { mode: 'trigger', from: binding.from }])
    }
  }
  return Object.fromEntries(summaries)
}

export function automationMaintenanceView(workspaceId: string, eventName: string, matcher: Matcher) {
  const actions = actionsOf(matcher)
  const targets = actions.map(action => {
    if (action.type === 'queue-work') {
      const execution = action.execution as Matcher | undefined
      return execution?.type === 'workflow-run' ? `workflow:${String(execution.workflowSlug ?? '')}` : `agent:${String(execution?.agentSlug ?? '')}`
    }
    return action.type === 'prompt' ? `agent:${typeof action.agentSlug === 'string' ? action.agentSlug : 'default'}` : String(action.type ?? 'unknown')
  })
  return {
    automationId: String(matcher.id ?? ''), eventName,
    name: typeof matcher.name === 'string' ? matcher.name.slice(0, 200) : 'Untitled automation',
    enabled: matcher.enabled !== false,
    protected: !families[eventName] || isMaintenanceProtected(matcher),
    revision: automationMaintenanceRevision(workspaceId, eventName, matcher),
    triggerSummary: families[eventName] ?? eventName,
    executionTarget: targets.join(', ').slice(0, 500),
    trigger: visibleTrigger(eventName, matcher),
    inputBindings: visibleInputBindings(actions),
    // Deliberately no action prompt, execution brief/inputs, auth, headers, response or raw matcher.
  }
}

async function readWorkspace(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace || workspace.id !== workspaceId) throw new Error('Workspace not found; use the current workspace ID.')
  assertTeamPermission(workspace.rootPath, 'team.settings.update')
  let config: { automations?: Record<string, Matcher[]> }
  try { config = JSON.parse(await readFile(resolveAutomationsConfigPath(workspace.rootPath), 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') config = { automations: {} }
    else throw new Error('Automation configuration could not be read. Open Automations to repair it.')
  }
  const validation = validateAutomationsConfig(config)
  if (!validation.valid) throw new Error('Automation configuration is invalid. Open Automations to repair it.')
  const entries = Object.entries(config.automations ?? {}).flatMap(([eventName, matchers]) => matchers.map(matcher => ({ eventName, matcher })))
  return { workspace, entries }
}

async function lastOutcomes(root: string): Promise<Map<string, { ok: boolean; ts: number }>> {
  const outcomes = new Map<string, { ok: boolean; ts: number }>()
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(join(root, 'automations-history.jsonl'), 'r')
    const { size } = await file.stat()
    const start = Math.max(0, size - 128 * 1024)
    const buffer = Buffer.alloc(Math.min(size, 128 * 1024))
    await file.read(buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    if (start) lines.shift()
    for (const line of lines) try {
      const value = JSON.parse(line)
      if (typeof value.id === 'string' && typeof value.ok === 'boolean' && typeof value.ts === 'number' && Number.isFinite(value.ts)) outcomes.set(value.id, { ok: value.ok, ts: value.ts })
    } catch { /* Ignore partial history lines; never expose their payloads. */ }
  } catch { /* Missing history is unknown, not success. */ }
  finally { await file?.close() }
  return outcomes
}

export async function listAutomationMaintenance(workspaceId: string, options: { limit?: number } = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 30)))
  if (!Number.isFinite(limit)) throw new Error('limit must be a finite number.')
  const { workspace, entries } = await readWorkspace(workspaceId)
  const outcomes = await lastOutcomes(workspace.rootPath)
  // Old entries without IDs remain manageable through the existing UI transition.
  const identified = entries.filter(entry => typeof entry.matcher.id === 'string' && entry.matcher.id)
  return { ok: true as const, automations: identified.slice(0, limit).map(entry => ({ ...automationMaintenanceView(workspaceId, entry.eventName, entry.matcher), lastOutcome: outcomes.get(String(entry.matcher.id)) })), hasMore: identified.length > limit }
}

export async function getAutomationMaintenance(workspaceId: string, automationId: string) {
  const { entries } = await readWorkspace(workspaceId)
  const found = entries.filter(entry => entry.matcher.id === automationId)
  if (!automationId || found.length !== 1) throw new Error('Automation ID is missing, ambiguous, or unavailable in this workspace.')
  return { ok: true as const, automation: automationMaintenanceView(workspaceId, found[0]!.eventName, found[0]!.matcher) }
}

/** Pure allowlisted transform. Never accepts model-supplied queue digests or raw actions. */
export function buildAutomationMaintenanceReplacement(
  workspaceId: string, root: string, eventName: string, current: Matcher, input: AutomationMaintenanceUpdate,
  executionResolver: typeof resolveExecution = resolveExecution,
): Matcher {
  if (!input.intent?.trim()) throw new Error('Explain the approved change before editing an automation.')
  if (automationMaintenanceRevision(workspaceId, eventName, current) !== input.expectedRevision) throw new Error('Automation changed. Re-read it before editing.')
  if (!families[eventName] || isMaintenanceProtected(current)) throw new Error('This app-managed automation must be changed through its existing Artist HQ or Automations control.')
  const patch = input.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['name', 'description', 'enabled', 'trigger', 'execution'].includes(key))) throw new Error('Unsupported automation patch field.')
  const next = JSON.parse(JSON.stringify(current)) as Matcher
  for (const key of ['name', 'description'] as const) if (patch[key] !== undefined) {
    if (typeof patch[key] !== 'string' || !patch[key]!.trim() || patch[key]!.length > (key === 'name' ? 200 : 2000)) throw new Error(`Invalid ${key}.`)
    next[key] = patch[key]!.trim()
  }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('enabled must be a boolean.')
    next.enabled = patch.enabled
    if (patch.enabled) delete next.snoozedUntil
  }
  if (patch.trigger) {
    const trigger = patch.trigger
    if (trigger.type !== families[eventName]) throw new Error('Changing trigger families is unsupported. Keep the existing trigger type.')
    const allowed: Record<string, string[]> = {
      schedule: ['type', 'cron', 'timezone'], 'file-change': ['type', 'watchPath', 'watchGlob', 'changeTypes'],
      webhook: ['type', 'slug', 'secretEnv', 'allowUnauthenticated'], 'url-change': ['type', 'url', 'intervalSeconds'], message: ['type', 'matcher'],
    }
    if (Object.keys(trigger).some(key => !allowed[trigger.type]?.includes(key))) throw new Error('Unsupported trigger field; edits require an explicit supported schedule, not automatic cadence.')
    if (trigger.type === 'schedule') {
      if (!trigger.cron?.trim()) throw new Error('Schedule edits require an explicit cron expression.')
      next.cron = trigger.cron; if (trigger.timezone !== undefined) next.timezone = trigger.timezone
      delete next.dailyWindow
    } else if (trigger.type === 'file-change') {
      next.watchPath = trigger.watchPath
      if (trigger.watchGlob !== undefined) next.watchGlob = trigger.watchGlob
      if (trigger.changeTypes !== undefined) next.watchChangeTypes = trigger.changeTypes
    } else if (trigger.type === 'webhook') {
      if (trigger.allowUnauthenticated === true && current.allowUnauthenticated !== true) throw new Error('Cannot remove webhook authentication through this edit.')
      next.slug = trigger.slug
      if (trigger.secretEnv !== undefined) next.secretEnv = trigger.secretEnv
      if (trigger.allowUnauthenticated !== undefined) next.allowUnauthenticated = trigger.allowUnauthenticated
    } else if (trigger.type === 'url-change') {
      next.pollUrl = trigger.url; if (trigger.intervalSeconds !== undefined) next.pollIntervalSec = trigger.intervalSeconds
    } else next.matcher = trigger.matcher ?? current.matcher
  }
  if (patch.execution) {
    const executionInput = patch.execution
    const executionKeys = executionInput.type === 'agent-task'
      ? ['type', 'agentSlug', 'taskModeId', 'brief', 'permissionMode', 'expectedOutput']
      : executionInput.type === 'workflow-run' ? ['type', 'workflowSlug', 'triggerInputs', 'inputBindings'] : []
    if (!executionKeys.length || Object.keys(executionInput).some(key => !executionKeys.includes(key))) throw new Error('Unsupported execution fields.')
    if (executionInput.type === 'agent-task' && (typeof executionInput.brief !== 'string' || !executionInput.brief.trim()
      || (executionInput.permissionMode !== undefined && !['safe', 'ask'].includes(executionInput.permissionMode)))) throw new Error('Tracked agent execution requires a brief and safe or ask permissions.')
    const actions = actionsOf(next)
    if (actions.length !== 1 || actions[0]?.type !== 'queue-work') throw new Error('Execution edits currently require one tracked worker/workflow action. Raw prompt and webhook actions remain unchanged.')
    if (actions[0].followUp) throw new Error('This tracked job has a follow-up; use its existing control to revise execution.')
    const trigger = patch.trigger ?? visibleTrigger(eventName, next)
    // Reconstruct only for validation, never expose private trigger text to the model.
    const resolvedTrigger = trigger ?? (eventName === 'PollUrl' ? { type: 'url-change' as const, url: String(next.pollUrl) } : { type: 'message' as const, matcher: typeof next.matcher === 'string' ? next.matcher : undefined })
    const execution = executionResolver(root, { idempotencyKey: String(current.id), destination: 'automation', title: String(next.name ?? 'Automation'), explanation: input.intent, execution: patch.execution, trigger: resolvedTrigger })
    const action = actions[0] as unknown as QueueWorkAction
    action.execution = execution
    delete action.inputBindings
    if (patch.execution.type === 'workflow-run' && patch.execution.inputBindings) action.inputBindings = patch.execution.inputBindings
  }
  if (patch.name !== undefined) for (const action of actionsOf(next)) if (action.type === 'queue-work') action.title = next.name
  if (JSON.stringify(next) !== JSON.stringify(current) && current.scheduleWorkKey) {
    const { id: _id, scheduleWorkDigest: _digest, scheduleWorkIntentDigest: _intent, ...body } = next
    next.scheduleWorkDigest = scheduledWorkDefinitionDigest({ eventName, matcher: body })
    // Old creation retries must not resurrect pre-edit intent.
    next.scheduleWorkIntentDigest = scheduledWorkDefinitionDigest({ maintenance: true, eventName, matcher: body })
  }
  return next
}

export async function updateAutomationMaintenance(workspaceId: string, input: AutomationMaintenanceUpdate) {
  const { workspace, entries } = await readWorkspace(workspaceId)
  const found = entries.filter(entry => entry.matcher.id === input.automationId)
  if (!input.automationId || found.length !== 1) throw new Error('Automation ID is missing, ambiguous, or unavailable in this workspace.')
  const { eventName, matcher } = found[0]!
  const replacement = buildAutomationMaintenanceReplacement(workspaceId, workspace.rootPath, eventName, matcher, input)
  if (actionsOf(replacement).some(action => action.type === 'webhook')) assertTeamPermission(workspace.rootPath, 'automation.external.execute')
  const outcome = await replaceAutomationMatcherGuarded(workspaceId, eventName, input.automationId, matcher, replacement)
  return { ...(await getAutomationMaintenance(workspaceId, input.automationId)), ...outcome }
}
