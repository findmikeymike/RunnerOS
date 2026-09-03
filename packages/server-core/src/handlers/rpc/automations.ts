import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { appendAutomationHistoryEntry } from '@craft-agent/shared/automations/history-store'
import { assertWorkflowInputBindings, validateAutomationsConfig, type QueueWorkAction, type WorkflowBindingTrigger } from '@craft-agent/shared/automations'
import { loadGlobalWorkflow, normalizeWorkflowTriggerInputs, readActivatedWorkflows } from '@craft-agent/shared/workflows'
import { scheduledWorkDefinitionDigest } from '@craft-agent/shared/scheduled-work'
import { AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER } from '@craft-agent/shared/automations/constants'
import {
  automaticSchedulePlacementUnavailableError,
  suggestAutomaticSchedule,
  type AutomaticScheduleCadence,
} from '@craft-agent/shared/automations/staggered-schedule'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { withAutomaticSchedulePlacementLock } from '../../scheduled-work/AutomaticSchedulePlacementLock'
import { cancelPendingAutomationWorkForMatcherLocked } from '../../scheduled-work/AutomationWorkQueue'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'

// History file name — matches AUTOMATIONS_HISTORY_FILE from @craft-agent/shared/automations/constants
const HISTORY_FILE = 'automations-history.jsonl'
interface HistoryEntry { id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; workOrderIds?: string[]; workTitle?: string; error?: string; webhook?: { method: string; url: string; statusCode: number; durationMs: number; attempts?: number; error?: string; responseBody?: string } }

type AutomaticScheduleEntry = { cron: string; enabled?: boolean; timezone?: string }

export function assertUniqueAutomationTemplateKey(config: AutomationsConfigJson, templateKey: string): void {
  const duplicate = Object.values(config.automations ?? {}).some((matchers) => (
    Array.isArray(matchers) && matchers.some((candidate) => candidate.templateKey === templateKey)
  ))
  if (duplicate) throw new Error('This shared automation is already installed in Artist HQ.')
}

export function assertAutomationCanBeDuplicated(matcher: Record<string, unknown>): void {
  if (typeof matcher.templateKey === 'string' && matcher.templateKey.trim()) {
    throw new Error('Shared artist automations cannot be duplicated.')
  }
}

export function automaticScheduleOccupancyFromConfig(value: unknown): AutomaticScheduleEntry[] {
  const validation = validateAutomationsConfig(value)
  if (!validation.valid || !validation.config) {
    throw new Error(`Automation config cannot be trusted for schedule placement: ${validation.errors.join('; ')}`)
  }
  return (validation.config.automations.SchedulerTick ?? []).flatMap((matcher): AutomaticScheduleEntry[] => {
    if (!matcher.cron?.trim()) return []
    return [{
      cron: matcher.cron,
      enabled: matcher.enabled === false ? false : true,
      timezone: matcher.timezone,
    }]
  })
}

async function readAutomaticScheduleOccupancy(workspaceRoots: string[]): Promise<AutomaticScheduleEntry[]> {
  const configs = await Promise.all(workspaceRoots.map(async (rootPath) => {
    try {
      return JSON.parse(await readFile(resolveAutomationsConfigPath(rootPath), 'utf-8')) as unknown
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return { automations: {} }
      throw error
    }
  }))
  return configs.flatMap(automaticScheduleOccupancyFromConfig)
}

// Per-workspace config mutex: serializes read-modify-write cycles on automations.json
// to prevent concurrent IPC calls from clobbering each other's changes.
const configMutexes = new Map<string, Promise<void>>()
function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run fn regardless of previous result
  configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
  return next
}

export interface PromptAutomationLaunch {
  started: Promise<{ sessionId: string }>
  completion: Promise<{ sessionId: string }>
}

/**
 * Start a prompt automation without making the calling RPC wait for the full
 * model turn. The start promise resolves as soon as the durable session exists;
 * completion remains available for history and error reporting.
 */
export function beginPromptAutomation(
  execute: (onSessionCreated: (sessionId: string) => void) => Promise<{ sessionId: string }>,
): PromptAutomationLaunch {
  let startedSettled = false
  let resolveStarted!: (result: { sessionId: string }) => void
  let rejectStarted!: (error: unknown) => void
  const started = new Promise<{ sessionId: string }>((resolve, reject) => {
    resolveStarted = resolve
    rejectStarted = reject
  })

  const completion = Promise.resolve().then(() => execute((sessionId) => {
    if (startedSettled) return
    startedSettled = true
    resolveStarted({ sessionId })
  }))

  void completion.then(
    (result) => {
      if (startedSettled) return
      startedSettled = true
      resolveStarted(result)
    },
    (error) => {
      if (startedSettled) return
      startedSettled = true
      rejectStarted(error)
    },
  )

  return { started, completion }
}

export function uniqueWebhookSlug(base: string, matchers: Record<string, unknown>[], duplicate = false): string {
  const existing = new Set(matchers.flatMap((matcher) => typeof matcher.slug === 'string' ? [matcher.slug] : []))
  if (!duplicate && !existing.has(base)) return base
  let attempt = duplicate ? 1 : 2
  while (true) {
    const suffix = duplicate
      ? attempt === 1 ? '-copy' : `-copy-${attempt}`
      : `-${attempt}`
    const stem = base.slice(0, 64 - suffix.length).replace(/-+$/, '') || 'webhook'
    const candidate = `${stem}${suffix}`
    if (!existing.has(candidate)) return candidate
    attempt += 1
  }
}

export function replacementAutomationMatcher(
  current: Record<string, unknown>,
  replacement: Record<string, unknown>,
  generateId: () => string,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(replacement)) as Record<string, unknown>
  if (typeof cloned.name === 'string') cloned.name = cloned.name.trim()
  cloned.id = typeof current.id === 'string' && current.id ? current.id : generateId()
  return cloned
}

export function findAutomationMatcherIndexByIdentity(
  matchers: Record<string, unknown>[],
  automationId: string,
  expectedMatcher: Record<string, unknown>,
): number {
  const expectedRevision = JSON.stringify(expectedMatcher)
  let index = matchers.findIndex((matcher) => matcher.id === automationId)
  if (index < 0 && expectedMatcher.id === undefined) {
    const legacyMatches = matchers
      .map((matcher, matcherIndex) => JSON.stringify(matcher) === expectedRevision ? matcherIndex : -1)
      .filter((matcherIndex) => matcherIndex >= 0)
    if (legacyMatches.length === 1) index = legacyMatches[0]!
  }
  if (index < 0) throw new Error('Automation no longer exists. Refresh and try again.')
  if (JSON.stringify(matchers[index]) !== expectedRevision) {
    throw new Error('Automation changed since this screen loaded. Refresh and review the latest settings.')
  }
  return index
}

export function assertAutomationQueueWorkBindings(
  workspaceRootPath: string,
  eventName: string,
  matcher: Record<string, unknown>,
  deps: {
    loadWorkflow?: typeof loadGlobalWorkflow
    activeWorkflowSlugs?: (rootPath: string) => string[]
  } = {},
): void {
  if (!Array.isArray(matcher.actions)) return
  for (const rawAction of matcher.actions) {
    if (!rawAction || typeof rawAction !== 'object' || (rawAction as { type?: unknown }).type !== 'queue-work') continue
    const action = rawAction as QueueWorkAction
    if (action.execution.type !== 'workflow-run') {
      if (action.inputBindings) throw new Error('Workflow input bindings require workflow work.')
      continue
    }
    const workflow = (deps.loadWorkflow ?? loadGlobalWorkflow)(action.execution.workflowSlug)
    if (!workflow) throw new Error(`Automation workflow was not found: ${action.execution.workflowSlug}`)
    const active = deps.activeWorkflowSlugs?.(workspaceRootPath) ?? readActivatedWorkflows(workspaceRootPath).active
    if (!active.includes(action.execution.workflowSlug)) {
      throw new Error(`Automation workflow is not active: ${action.execution.workflowSlug}`)
    }
    const digest = scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body })
    if (digest !== action.execution.workflowDigest) throw new Error(`Automation workflow changed: ${action.execution.workflowSlug}`)
    if (action.inputBindings) {
      assertWorkflowInputBindings(
        workflow.metadata.trigger.inputs ?? [],
        action.inputBindings,
        bindingTriggerForEvent(eventName),
        { allowUnauthenticatedWebhook: eventName === 'WebhookReceive' && matcher.allowUnauthenticated === true },
      )
    } else {
      normalizeWorkflowTriggerInputs(workflow, action.execution.triggerInputs)
    }
  }
}

function bindingTriggerForEvent(eventName: string): WorkflowBindingTrigger {
  if (eventName === 'SchedulerTick' || eventName === 'FileWatch' || eventName === 'WebhookReceive' || eventName === 'PollUrl' || eventName === 'MessageReceive') return eventName
  throw new Error(`Event cannot supply workflow inputs: ${eventName}`)
}

export function assertTestAutomationHasQueueWorkEvent(
  payload: import('@craft-agent/shared/protocol').TestAutomationPayload,
): void {
  if (payload.automationId && !payload.event && payload.actions.some((action) => action.type === 'queue-work')) {
    throw new Error('The saved automation trigger is unavailable. Refresh and run the test again.')
  }
}

// Shared helper: resolve workspace, read automations.json, validate matcher, mutate, write back
interface AutomationsConfigJson { automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
async function withAutomationEvent<T>(
  workspaceId: string,
  eventName: string,
  mutate: (matchers: Record<string, unknown>[], config: AutomationsConfigJson, genId: () => string) => T,
  afterWrite?: (result: T, workspaceRootPath: string) => Promise<void>,
): Promise<T> {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
  assertTeamPermission(workspace.rootPath, 'team.settings.update')

  return withConfigMutex(workspace.rootPath, async () => {
    const { resolveAutomationsConfigPath, generateShortId } = await import('@craft-agent/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)

    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)

    const eventMap = config.automations ?? {}
    const matchers = eventMap[eventName]
    if (!Array.isArray(matchers)) throw new Error(`Invalid automation event: ${eventName}`)
    const result = mutate(matchers, config, generateShortId)

    // Backfill missing IDs on all matchers before writing
    for (const eventMatchers of Object.values(eventMap)) {
      if (!Array.isArray(eventMatchers)) continue
      for (const m of eventMatchers as Record<string, unknown>[]) {
        if (!m.id) m.id = generateShortId()
      }
    }

    const validation = validateAutomationsConfig(config)
    if (!validation.valid) throw new Error(`Invalid automation: ${validation.errors.join('; ')}`)

    if (afterWrite) {
      await withWorkspaceContextLock(workspace.rootPath, async () => {
        await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
        await afterWrite(result, workspace.rootPath)
      })
    } else {
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    }
    return result
  })
}

async function withAutomationMatcher<T = void>(
  workspaceId: string,
  eventName: string,
  matcherIndex: number,
  mutate: (matchers: Record<string, unknown>[], index: number, config: AutomationsConfigJson, genId: () => string) => T,
  afterWrite?: (result: T, workspaceRootPath: string) => Promise<void>,
): Promise<T> {
  return withAutomationEvent(workspaceId, eventName, (matchers, config, generateId) => {
    if (matcherIndex < 0 || matcherIndex >= matchers.length) {
      throw new Error(`Invalid automation reference: ${eventName}[${matcherIndex}]`)
    }
    return mutate(matchers, matcherIndex, config, generateId)
  }, afterWrite)
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.automations.GET,
  RPC_CHANNELS.automations.TEST,
  RPC_CHANNELS.automations.SET_ENABLED,
  RPC_CHANNELS.automations.SET_SNOOZED_UNTIL,
  RPC_CHANNELS.automations.DUPLICATE,
  RPC_CHANNELS.automations.DELETE,
  RPC_CHANNELS.automations.GET_HISTORY,
  RPC_CHANNELS.automations.GET_LAST_EXECUTED,
  RPC_CHANNELS.automations.REPLAY,
  RPC_CHANNELS.automations.CREATE_FROM_TEMPLATE,
  RPC_CHANNELS.automations.REPLACE,
  RPC_CHANNELS.automations.GET_TRIGGER_SERVER_INFO,
] as const

export function registerAutomationsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get automations config for a workspace (read-only, resolves path server-side)
  server.handle(RPC_CHANNELS.automations.GET, async (_ctx, workspaceId: string) => {
    log.info(`AUTOMATIONS_GET: Loading automations for workspace: ${workspaceId}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`AUTOMATIONS_GET: Workspace not found: ${workspaceId}`)
      return null
    }
    try {
      const { resolveAutomationsConfigPath } = await import('@craft-agent/shared/automations/resolve-config-path')
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)
      log.info(`AUTOMATIONS_GET: Reading config from: ${configPath}`)
      const content = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(content)
      const eventCount = parsed?.automations ? Object.keys(parsed.automations).length : 0
      log.info(`AUTOMATIONS_GET: Loaded ${eventCount} event type(s) from ${configPath}`)
      return parsed
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info(`AUTOMATIONS_GET: No automations.json found for workspace ${workspaceId}`)
        return null // No automations configured yet
      }
      log.error(`AUTOMATIONS_GET: Error loading automations:`, error)
      throw error
    }
  })

  server.handle(RPC_CHANNELS.automations.TEST, async (_ctx, payload: import('@craft-agent/shared/protocol').TestAutomationPayload) => {
    const workspace = getWorkspaceByNameOrId(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(workspace.rootPath, 'agent.chat')
    if (payload.actions.some((action) => action.type === 'webhook')) {
      assertTeamPermission(workspace.rootPath, 'automation.external.execute')
    }
    assertTestAutomationHasQueueWorkEvent(payload)

    const results: import('@craft-agent/shared/protocol').TestAutomationActionResult[] = []
    const { parsePromptReferences } = await import('@craft-agent/shared/automations')
    const { executeWebhookRequest, createWebhookHistoryEntry, createPromptHistoryEntry } = await import('@craft-agent/shared/automations/webhook-utils')
    let queueWorkActionIndex = 0

    for (const action of payload.actions) {
      const start = Date.now()

      if (action.type === 'webhook') {
        // Execute webhook action using shared utility (no env expansion for test — raw URLs)
        // Cast needed: protocol DTO uses loose `method?: string`, WebhookAction uses strict union
        const result = await executeWebhookRequest(action as import('@craft-agent/shared/automations').WebhookAction)
        const method = action.method ?? 'POST'

        results.push({
          ...result,
          duration: Date.now() - start,
        })

        if (payload.automationId) {
          const entry = createWebhookHistoryEntry({
            matcherId: payload.automationId,
            ok: result.success,
            method,
            url: action.url as string,
            statusCode: result.statusCode,
            durationMs: result.durationMs ?? 0,
            error: result.error,
            responseBody: result.responseBody,
          })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
        continue
      }

      if (action.type === 'queue-work') {
        const actionIndex = queueWorkActionIndex++
        try {
          const queued = await deps.sessionManager.queueTrackedWorkAutomation({
            workspaceId: payload.workspaceId,
            workspaceRootPath: workspace.rootPath,
            matcherId: payload.automationId ?? `test-${Date.now()}`,
            actionIndex,
            automationName: payload.automationName ?? action.title,
            action,
            configuredAction: action,
            event: payload.event,
          })
          results.push({
            type: 'queue-work',
            success: true,
            workOrderIds: queued.orderIds,
            duration: Date.now() - start,
          })
          if (payload.automationId) {
            try {
              await appendAutomationHistoryEntry(workspace.rootPath, {
                id: payload.automationId,
                ts: Date.now(),
                ok: true,
                workOrderIds: queued.orderIds,
                workTitle: action.title,
              })
            } catch (historyError) {
              log.warn('[Automations] Failed to write tracked-work test history:', historyError)
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          results.push({ type: 'queue-work', success: false, error, duration: Date.now() - start })
          if (payload.automationId) {
            try {
              await appendAutomationHistoryEntry(workspace.rootPath, {
                id: payload.automationId,
                ts: Date.now(),
                ok: false,
                workTitle: action.title,
                error,
              })
            } catch (historyError) {
              log.warn('[Automations] Failed to write tracked-work test history:', historyError)
            }
          }
        }
        continue
      }

      // Prompt action
      // Parse @mentions from the prompt to resolve source/skill references
      const references = parsePromptReferences(action.prompt)

      try {
        const launch = beginPromptAutomation((onSessionCreated) => (
          deps.sessionManager.executePromptAutomation({
            workspaceId: payload.workspaceId,
            workspaceRootPath: workspace.rootPath,
            prompt: action.prompt,
            labels: payload.labels,
            permissionMode: payload.permissionMode,
            mentions: references.mentions,
            agentSlug: action.agentSlug,
            llmConnection: action.llmConnection,
            model: action.model,
            thinkingLevel: action.thinkingLevel,
            automationName: payload.automationName,
            onSessionCreated,
          })
        ))
        const { sessionId } = await launch.started
        results.push({
          type: 'prompt',
          success: true,
          sessionId,
          duration: Date.now() - start,
        })

        // The RPC reports a durable start immediately. The model turn continues
        // in the background and records its real outcome when available.
        void launch.completion.then(
          async () => {
            if (!payload.automationId) return
            const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: true, sessionId, prompt: action.prompt })
            try {
              await appendAutomationHistoryEntry(workspace.rootPath, entry)
            } catch (error) {
              log.warn('[Automations] Failed to write history:', error)
            }
          },
          async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            log.error(`[Automations] Prompt test session ${sessionId} failed after launch:`, error)
            if (!payload.automationId) return
            const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: false, error: message, prompt: action.prompt })
            try {
              await appendAutomationHistoryEntry(workspace.rootPath, entry)
            } catch (historyError) {
              log.warn('[Automations] Failed to write history:', historyError)
            }
          },
        )
      } catch (err: unknown) {
        results.push({
          type: 'prompt',
          success: false,
          stderr: (err as Error).message,
          duration: Date.now() - start,
        })

        // Write failed history entry
        if (payload.automationId) {
          const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: false, error: (err as Error).message, prompt: action.prompt })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
      }
    }

    return { actions: results } satisfies import('@craft-agent/shared/protocol').TestAutomationResult
  })

  // Automation enabled state management (toggle enabled/disabled in automations.json)
  server.handle(RPC_CHANNELS.automations.SET_ENABLED, async (
    _ctx,
    workspaceId: string,
    eventName: string,
    matcherIndex: number,
    enabled: boolean,
    permissionMode?: PermissionMode,
  ) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx) => {
      const matcherId = typeof matchers[idx]!.id === 'string' ? matchers[idx]!.id as string : ''
      if (enabled) {
        delete matchers[idx].enabled
      } else {
        matchers[idx].enabled = false
      }
      if (permissionMode) {
        matchers[idx].permissionMode = permissionMode
      }
      return matcherId
    }, async (matcherId, workspaceRootPath) => {
      if (matcherId && (!enabled || permissionMode)) {
        cancelPendingAutomationWorkForMatcherLocked(workspaceId, workspaceRootPath, matcherId)
      }
    })
  })

  server.handle(RPC_CHANNELS.automations.SET_SNOOZED_UNTIL, async (
    _ctx,
    workspaceId: string,
    eventName: string,
    matcherIndex: number,
    snoozedUntil: string | null,
  ) => {
    if (snoozedUntil !== null) {
      const timestamp = Date.parse(snoozedUntil)
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('Snooze must end in the future')
    }
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx) => {
      const matcherId = typeof matchers[idx]!.id === 'string' ? matchers[idx]!.id as string : ''
      if (snoozedUntil === null) delete matchers[idx]!.snoozedUntil
      else matchers[idx]!.snoozedUntil = new Date(snoozedUntil).toISOString()
      return matcherId
    }, async (matcherId, workspaceRootPath) => {
      if (matcherId && snoozedUntil !== null) {
        cancelPendingAutomationWorkForMatcherLocked(workspaceId, workspaceRootPath, matcherId)
      }
    })
  })

  // Report inbound webhook trigger server state to the renderer.
  // Returns { enabled: false, url: null } when the host didn't wire the
  // closure (older bootstraps) or when the server is disabled.
  server.handle(RPC_CHANNELS.automations.GET_TRIGGER_SERVER_INFO, async () => {
    if (!deps.getTriggerServerInfo) return { enabled: false, url: null }
    return deps.getTriggerServerInfo()
  })

  // Append a new automation matcher built from a template. The renderer
  // sends the event name plus a fully-formed matcher object (already
  // validated client-side). The server appends, ensures a unique ID, and
  // creates the file if absent.
  server.handle(RPC_CHANNELS.automations.CREATE_FROM_TEMPLATE, async (
    _ctx,
    workspaceId: string,
    eventName: string,
    matcher: Record<string, unknown>,
    options?: { automaticCadence?: AutomaticScheduleCadence },
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(workspace.rootPath, 'team.settings.update')

    const persist = async (resolvedMatcher: Record<string, unknown>) => withConfigMutex(workspace.rootPath, async () => {
      const { generateShortId } = await import('@craft-agent/shared/automations/resolve-config-path')
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)

      let config: AutomationsConfigJson
      try {
        const raw = await readFile(configPath, 'utf-8')
        config = JSON.parse(raw)
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          config = { version: 2, automations: {} }
        } else {
          throw err
        }
      }

      if (!config.automations) config.automations = {}
      const templateKey = typeof resolvedMatcher.templateKey === 'string' ? resolvedMatcher.templateKey.trim() : ''
      if (templateKey) assertUniqueAutomationTemplateKey(config, templateKey)
      const eventMap = config.automations
      if (!eventMap[eventName]) eventMap[eventName] = []
      const matchers = eventMap[eventName]!

      const cloned = JSON.parse(JSON.stringify(resolvedMatcher)) as Record<string, unknown>
      if (typeof cloned.name === 'string') cloned.name = cloned.name.trim()
      cloned.id = generateShortId()
      // For WebhookReceive, ensure the slug is unique within the event group
      if (eventName === 'WebhookReceive' && typeof cloned.slug === 'string') {
        cloned.slug = uniqueWebhookSlug(cloned.slug, matchers)
      }
      assertAutomationQueueWorkBindings(workspace.rootPath, eventName, cloned)
      matchers.push(cloned)

      // Backfill missing IDs across the whole config (matches DUPLICATE handler convention)
      for (const e of Object.values(eventMap)) {
        if (!Array.isArray(e)) continue
        for (const m of e as Record<string, unknown>[]) {
          if (!m.id) m.id = generateShortId()
        }
      }

      const validation = validateAutomationsConfig(config)
      if (!validation.valid) {
        throw new Error(`Invalid automation: ${validation.errors.join('; ')}`)
      }

      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    })

    if (options?.automaticCadence) {
      if (eventName !== 'SchedulerTick') throw new Error('Automatic cadence is available only for scheduled automations.')
      const automaticCadence = options.automaticCadence
      return withAutomaticSchedulePlacementLock(async () => {
        const timezone = typeof matcher.timezone === 'string' && matcher.timezone.trim() ? matcher.timezone : 'UTC'
        let existing: AutomaticScheduleEntry[]
        try {
          existing = await readAutomaticScheduleOccupancy(deps.sessionManager.getWorkspaces().map((candidate) => candidate.rootPath))
        } catch (error) {
          throw automaticSchedulePlacementUnavailableError(error)
        }
        const suggestion = suggestAutomaticSchedule(existing, automaticCadence, { timezone })
        await persist({ ...matcher, cron: suggestion.cron, timezone })
        return suggestion
      })
    }
    await persist(matcher)
    return {}
  })

  // Replace in one validated write so a failed update cannot delete the working automation.
  server.handle(RPC_CHANNELS.automations.REPLACE, async (
    _ctx,
    workspaceId: string,
    eventName: string,
    automationId: string,
    expectedMatcher: Record<string, unknown>,
    matcher: Record<string, unknown>,
  ) => {
    await withAutomationEvent(workspaceId, eventName, (matchers, _config, generateId) => {
      const idx = findAutomationMatcherIndexByIdentity(matchers, automationId, expectedMatcher)
      const replacement = replacementAutomationMatcher(matchers[idx]!, matcher, generateId)
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('Workspace not found')
      assertAutomationQueueWorkBindings(workspace.rootPath, eventName, replacement)
      matchers[idx] = replacement
      return replacement.id as string
    }, async (matcherId, workspaceRootPath) => {
      cancelPendingAutomationWorkForMatcherLocked(workspaceId, workspaceRootPath, matcherId)
    })
  })

  // Duplicate an automation matcher
  server.handle(RPC_CHANNELS.automations.DUPLICATE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, _config, genId) => {
      assertAutomationCanBeDuplicated(matchers[idx]!)
      const clone = JSON.parse(JSON.stringify(matchers[idx]))
      clone.id = genId()
      clone.name = clone.name ? `${clone.name} Copy` : 'Untitled Copy'
      if (eventName === 'WebhookReceive' && typeof clone.slug === 'string') {
        clone.slug = uniqueWebhookSlug(clone.slug, matchers, true)
      }
      matchers.splice(idx + 1, 0, clone)
    })
  })

  // Delete an automation matcher
  server.handle(RPC_CHANNELS.automations.DELETE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config) => {
      const matcherId = typeof matchers[idx]!.id === 'string' ? matchers[idx]!.id as string : ''
      matchers.splice(idx, 1)
      if (matchers.length === 0) {
        const eventMap = config.automations
        if (eventMap) delete eventMap[eventName]
      }
      return matcherId
    }, async (matcherId, workspaceRootPath) => {
      if (matcherId) cancelPendingAutomationWorkForMatcherLocked(workspaceId, workspaceRootPath, matcherId)
    })
  })

  // Read execution history for a specific automation
  server.handle(RPC_CHANNELS.automations.GET_HISTORY, async (_ctx, workspaceId: string, automationId: string, limit = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const clampedLimit = Math.max(1, Math.min(limit, AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER))
    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      return lines
        .map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter((e): e is HistoryEntry => e?.id === automationId)
        .slice(-clampedLimit)
        .reverse()
    } catch {
      return [] // File doesn't exist yet
    }
  })

  // Replay webhook actions for a specific automation matcher
  server.handle(RPC_CHANNELS.automations.REPLAY, async (_ctx, workspaceId: string, automationId: string, eventName: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(workspace.rootPath, 'automation.external.execute')

    const { resolveAutomationsConfigPath } = await import('@craft-agent/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)
    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw) as { automations?: Record<string, Array<{ id?: string; actions?: Array<{ type: string; [key: string]: unknown }> }>> }

    const matchers = config.automations?.[eventName] ?? []
    const matcher = matchers.find(m => m.id === automationId)
    if (!matcher) throw new Error('Automation not found')

    const webhookActions = (matcher.actions ?? []).filter(a => a.type === 'webhook')
    if (webhookActions.length === 0) throw new Error('No webhook actions to replay')

    const { executeWebhookRequest, createWebhookHistoryEntry } = await import('@craft-agent/shared/automations/webhook-utils')
    const results = await Promise.all(
      webhookActions.map(a => executeWebhookRequest(a as unknown as import('@craft-agent/shared/automations').WebhookAction))
    )

    // Write history entries for replay — use index to correctly attribute method per action
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const action = webhookActions[i]!
      const entry = createWebhookHistoryEntry({
        matcherId: automationId,
        ok: result.success,
        method: (action as { method?: string }).method,
        url: result.url,
        statusCode: result.statusCode,
        durationMs: result.durationMs ?? 0,
        error: result.error,
      })
      try {
        await appendAutomationHistoryEntry(workspace.rootPath, entry)
      } catch (e) {
        log.warn('[Automations] Failed to write replay history:', e)
      }
    }

    return { results: results.map(r => ({ ...r, duration: r.durationMs ?? 0 })) }
  })

  // Return last execution timestamp for all automations
  server.handle(RPC_CHANNELS.automations.GET_LAST_EXECUTED, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const result: Record<string, number> = {}
      for (const line of content.trim().split('\n')) {
        try {
          const entry = JSON.parse(line)
          if (entry.id && entry.ts) result[entry.id] = entry.ts
        } catch { /* skip malformed lines */ }
      }
      return result
    } catch {
      return {}
    }
  })
}
