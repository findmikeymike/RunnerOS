import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  createOutputBundle,
} from '@craft-agent/shared/outputs'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import type { HostToolExecutionGuard } from '@craft-agent/shared/agent/backend'
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity'
import {
  appendOutputSchemaInstruction,
  isValidWorkflowOutputSchema,
  parseStructuredStepOutput,
} from '@craft-agent/shared/workflows'
import {
  attachDeepResearchAgentMessageReceipts,
  sanitizeDeepResearchPublicUrl as sanitizePublicUrl,
  getDeepResearchRunFile,
  readDeepResearchRun,
  markActiveDeepResearchRunsInterrupted,
  writeDeepResearchRun,
  type DeepResearchDepth,
  type DeepResearchExecutionContract,
  type DeepResearchLoopBudget,
  type DeepResearchPlan,
  type DeepResearchPlanPolicy,
  type DeepResearchPlanStep,
  type DeepResearchReportFormat,
  type DeepResearchRunSnapshot,
  type DeepResearchSourceProfile,
  type DeepResearchSourceReadiness,
  type DeepResearchStepRun,
  type DeepResearchToolKind,
  type DeepResearchToolReceipt,
  type StartDeepResearchRunInput,
  isValidDeepResearchRunId,
} from '@craft-agent/shared/deep-research'

export type DeepResearchRunnerEvent =
  | { type: 'run.created' | 'run.updated' | 'run.completed'; run: DeepResearchRunSnapshot }
  | { type: 'outputs.updated'; workspaceId: string }

export interface DeepResearchRunnerDeps {
  createSession: (
    workspaceId: string,
    options: CreateSessionOptions,
    hostToolExecutionGuard?: HostToolExecutionGuard,
  ) => Promise<{ id: string }>
  sendMessage: (sessionId: string, prompt: string) => Promise<void>
  getLastAssistantText: (sessionId: string) => string
  getSessionToolUseSummary: (sessionId: string) => { count: number; names: string[] }
  getSessionToolUseRecords?: (sessionId: string) => DeepResearchToolUseRecord[]
  abortSession: (sessionId: string) => Promise<void>
  deleteSession?: (sessionId: string) => Promise<void>
  getWorkspaceRootPath: (workspaceId: string) => string
  resolveSourceReadiness: (workspaceId: string, requestedSlugs: string[]) => DeepResearchSourceReadiness
  resolveSourceProfiles: (workspaceId: string, sourceSlugs: string[]) => DeepResearchSourceProfile[]
  emit?: (event: DeepResearchRunnerEvent) => void
}

export interface DeepResearchToolUseRecord {
  sessionId?: string
  toolUseId: string
  toolName: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  isError?: boolean
}

interface DeepResearchToolBudgetState {
  searchCalls: number
  pageReads: number
  totalCalls: number
  activePageReads: Set<string>
  pageAttempts: Map<string, number>
  admittedToolUseIds: Set<string>
}

interface ActiveDeepResearchRun {
  snapshot: DeepResearchRunSnapshot
  abort: AbortController
  currentSessionId?: string
  toolBudget: DeepResearchToolBudgetState
  hostToolExecutionGuard?: HostToolExecutionGuard
}

/** Trusted options supplied only by a host feature adapter, never an RPC caller. */
export interface DeepResearchHostRunOptions {
  runId?: string
  purpose?: string
  owner?: import('@craft-agent/shared/deep-research').DeepResearchOwnerBinding
  executionContract?: Partial<Omit<DeepResearchExecutionContract, 'startedAt' | 'deadlineAt'>>
  outputSchema?: Record<string, unknown>
}

const DEEP_RESEARCH_SYSTEM_PROMPT = [
  `You are ${RUNTIME_IDENTITY.productName} Deep Research.`,
  'You run a real research loop, not a single lookup.',
  'Use selected MCP/API/local/browser/search tools when they are available.',
  'When a search tool such as Exa is selected, use it for discovery before synthesis.',
  'When a browser/search tool is selected, open and inspect promising pages/items instead of relying only on snippets.',
  'After initial findings, identify gaps or contradictions and run follow-up searches when budget allows.',
  'If evidence is missing, say exactly what is missing.',
].join('\n')

const DEEP_RESEARCH_STEP_TIMEOUT_MS_BY_DEPTH: Record<DeepResearchDepth, number> = {
  quick: 5 * 60 * 1000,
  standard: 10 * 60 * 1000,
  deep: 20 * 60 * 1000,
}

const DEEP_RESEARCH_OVERALL_TIMEOUT_MS_BY_DEPTH: Record<DeepResearchDepth, number> = {
  quick: 8 * 60 * 1000,
  standard: 15 * 60 * 1000,
  deep: 30 * 60 * 1000,
}

const EXECUTION_LIMIT_MAX = 1000
const SUPPORT_EXCERPT_MAX_CHARS = 300
const CLEANUP_TIMEOUT_MS = 2_000

function nowIso(): string {
  return new Date().toISOString()
}

function cleanTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ')
}

function titleFromTopic(topic: string): string {
  const cleaned = cleanTopic(topic)
  if (cleaned.length <= 80) return cleaned
  return `${cleaned.slice(0, 77).trim()}...`
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort()
}

function loopBudgetForDepth(depth: DeepResearchDepth): DeepResearchLoopBudget {
  if (depth === 'quick') return { depth, maxSearchRounds: 2, maxPagesToOpen: 5, minFollowUpRounds: 1 }
  if (depth === 'deep') return { depth, maxSearchRounds: 5, maxPagesToOpen: 16, minFollowUpRounds: 2 }
  return { depth, maxSearchRounds: 3, maxPagesToOpen: 10, minFollowUpRounds: 1 }
}

function boundedInteger(value: unknown, fallback: number, min: number, max = EXECUTION_LIMIT_MAX): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function executionContractForDepth(
  depth: DeepResearchDepth,
  budget: DeepResearchLoopBudget,
  requested: DeepResearchHostRunOptions['executionContract'],
): DeepResearchExecutionContract {
  const maxSearchCalls = boundedInteger(requested?.maxSearchCalls, budget.maxSearchRounds, 0)
  const maxPageReads = boundedInteger(requested?.maxPageReads, budget.maxPagesToOpen, 0)
  return {
    overallTimeoutMs: boundedInteger(
      requested?.overallTimeoutMs,
      DEEP_RESEARCH_OVERALL_TIMEOUT_MS_BY_DEPTH[depth],
      1,
      24 * 60 * 60 * 1000,
    ),
    ...(requested?.researchToolsOnly === true ? { researchToolsOnly: true } : {}),
    ...(requested?.nativePublicWebOnly === true ? { nativePublicWebOnly: true } : {}),
    maxSearchCalls,
    maxPageReads,
    maxConcurrentPageReads: boundedInteger(
      requested?.maxConcurrentPageReads,
      2,
      1,
      Math.max(1, maxPageReads),
    ),
    maxRetriesPerPage: boundedInteger(requested?.maxRetriesPerPage, 1, 0, 10),
    maxTotalResearchToolCalls: boundedInteger(
      requested?.maxTotalResearchToolCalls,
      maxSearchCalls + maxPageReads + 4,
      1,
    ),
    maxStructuredOutputRepairs: boundedInteger(requested?.maxStructuredOutputRepairs, 1, 0, 2),
  }
}

function cleanOptionalText(value: string | undefined, maxChars: number): string | undefined {
  const cleaned = value?.trim().replace(/\s+/g, ' ')
  if (!cleaned) return undefined
  return cleaned.slice(0, maxChars)
}

function sanitizeAttemptUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.username = ''
    url.password = ''
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:api[_-]?key|token|authorization|secret|password|signature|credential)/i.test(key)) {
        url.searchParams.set(key, '[redacted]')
      }
    }
    url.searchParams.sort()
    return url.toString()
  } catch {
    return undefined
  }
}

function findUrlInValue(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined
  const direct = sanitizePublicUrl(value)
  if (direct) return direct
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findUrlInValue(item, depth + 1)
      if (nested) return nested
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const nested = findUrlInValue(nestedValue, depth + 1)
    if (nested) return nested
  }
  return undefined
}

function supportExcerpt(result: string | undefined): string | undefined {
  if (!result) return undefined
  const cleaned = result
    .replace(/"(api[_-]?key|x[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|client[_-]?secret|secret|password|set[_-]?cookie|cookie)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/\b(api[_-]?key|x[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|password|set[_-]?cookie|cookie)\b\s*[:=]\s*[^\s,;}]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s<>'"`]+/gi, (url) => sanitizePublicUrl(url.replace(/[),.;]+$/, '')) ?? '[url omitted]')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, SUPPORT_EXCERPT_MAX_CHARS) : undefined
}

function sourceSlugFromToolName(toolName: string): string | undefined {
  const parts = toolName.split('__')
  return parts[0]?.toLowerCase() === 'mcp'
    ? cleanOptionalText(parts[1], 120)
    : undefined
}

function normalizeResearchToolName(toolName: string): string {
  const name = toolName.toLowerCase()
  return name === 'websearch' ? 'web_search' : name === 'webfetch' ? 'web_fetch' : name
}

function classifyResearchTool(
  toolName: string,
  sourceProfiles: DeepResearchSourceProfile[],
  input: Record<string, unknown> = {},
): DeepResearchToolKind | null {
  if (!isRelevantResearchToolName(toolName, sourceProfiles)) return null
  const normalized = normalizeResearchToolName(toolName)
  const leaf = normalized.split('__').at(-1) ?? normalized
  const apiPath = typeof input.path === 'string' ? input.path.toLowerCase() : ''
  if (leaf.startsWith('api_') && /(?:^|\/)(?:search|query|discover|lookup)(?:\/|$)/.test(apiPath)) {
    return 'search'
  }
  if (leaf.startsWith('api_') && /(?:^|\/)(?:contents?|pages?|fetch|open|read|inspect|visit|browse)(?:\/|$)/.test(apiPath)) {
    return 'page-read'
  }
  if (normalized === 'web_search' || ['search', 'query', 'discover', 'lookup'].includes(leaf)) {
    return 'search'
  }
  if (
    normalized === 'web_fetch' ||
    ['fetch', 'open', 'read', 'inspect', 'visit', 'browse', 'page', 'content', 'contents'].includes(leaf)
  ) {
    return 'page-read'
  }
  return 'source-read'
}

function buildPlan(params: {
  topic: string
  title: string
  policy: DeepResearchPlanPolicy
  sourceSlugs: string[]
  sourceProfiles: DeepResearchSourceProfile[]
  depth: DeepResearchDepth
  reportFormat: DeepResearchReportFormat
  createdAt: string
}): DeepResearchPlan {
  const budget = loopBudgetForDepth(params.depth)
  const searchSources = params.sourceProfiles
    .filter((source) => source.capabilities.includes('search'))
    .map((source) => source.slug)
  const browserSources = params.sourceProfiles
    .filter((source) => source.capabilities.includes('browser'))
    .map((source) => source.slug)
  const steps: DeepResearchPlanStep[] = [
    {
      id: 'research-loop',
      kind: 'research',
      title: 'Browser/Search Research Loop',
      instructions: [
        `Research topic: ${params.topic}`,
        `Across the whole run, use no more than ${budget.maxSearchRounds} search calls and inspect no more than ${budget.maxPagesToOpen} promising pages/items.`,
        `Reserve at least ${budget.minFollowUpRounds} search call(s) for the follow-up gap step.`,
        `Run at least ${budget.minFollowUpRounds} follow-up search round(s) when gaps, weak claims, or contradictions remain.`,
        searchSources.length > 0
          ? `Prefer selected search-capable sources first: ${searchSources.join(', ')}.`
          : 'No selected source is explicitly search-capable; use the best available source/tool for discovery.',
        browserSources.length > 0
          ? `Use selected browser-capable sources to open/read pages when useful: ${browserSources.join(', ')}.`
          : 'If no browser source is available, extract as much as possible through search/API/source results.',
        'Capture useful URLs or source names when available, but do not spend time on citation polish.',
        'End with: searches tried, pages/items inspected, key findings, contradictions, remaining gaps, and confidence.',
      ].join('\n'),
      requiredSourceSlugs: params.sourceSlugs,
    },
    {
      id: 'follow-up-research',
      kind: 'research',
      title: 'Follow-up Gap Search',
      instructions: [
        `Re-check the first-pass research for: ${params.topic}`,
        'Identify the weakest claims, missing context, contradictions, or suspiciously thin areas.',
        `Run at least ${budget.minFollowUpRounds} targeted follow-up search/browser pass(es), staying within the remaining practical budget.`,
        'Prefer selected search-capable tools for discovery and Runner browser/page tools for inspecting the best follow-up targets.',
        'End with: follow-up searches tried, pages/items inspected, what changed, what stayed uncertain, and confidence shifts.',
      ].join('\n'),
      requiredSourceSlugs: params.sourceSlugs,
    },
    {
      id: 'synthesize-report',
      kind: 'synthesis',
      title: 'Synthesize Report',
      instructions: [
        `Write a ${params.reportFormat} research report for: ${params.topic}`,
        'Use the research-loop output as the evidence base.',
        'Separate strong findings, weak/uncertain findings, practical implications, and gaps.',
        'Be direct. Do not pad.',
      ].join('\n'),
      requiredSourceSlugs: params.sourceSlugs,
    },
  ]

  return {
    id: randomUUID(),
    title: params.title,
    objective: params.topic,
    policy: params.policy,
    depth: params.depth,
    reportFormat: params.reportFormat,
    loopBudget: budget,
    sourceProfiles: params.sourceProfiles,
    steps,
    requiredSourceSlugs: params.sourceSlugs,
    assumptions: [
      'Research quality depends on the selected sources being current and reachable at execution time.',
      'RunnerOS will fail before execution when requested sources are missing, disabled, or unauthenticated.',
      'Selected sources are treated as the available tool belt; search/browser behavior depends on what their MCP/API/local tools expose.',
    ],
    riskNotes: [
      'Tool output can be stale or incomplete; the research loop must call out unresolved gaps.',
      'Auto mode can run tools without a plan approval checkpoint.',
    ],
    createdAt: params.createdAt,
  }
}

function buildStepRuns(plan: DeepResearchPlan): DeepResearchStepRun[] {
  return plan.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    title: step.title,
    state: 'queued',
  }))
}

function isTerminalRunState(state: DeepResearchRunSnapshot['state']): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function requiresResearchToolUse(run: DeepResearchRunSnapshot, step: DeepResearchPlanStep): boolean {
  if (step.id !== 'research-loop' && step.id !== 'follow-up-research') return false
  return (run.plan.sourceProfiles ?? []).some((source) => (
    source.capabilities.includes('search') || source.capabilities.includes('browser')
  ))
}

function isRelevantResearchToolName(toolName: string, sourceProfiles: DeepResearchSourceProfile[]): boolean {
  const normalized = normalizeResearchToolName(toolName)
  if (
    normalized === 'web_search' ||
    normalized === 'web_fetch'
  ) {
    return true
  }
  return sourceProfiles.some((source) => (
    normalized.startsWith(`mcp__${source.slug.toLowerCase()}__`)
  ))
}

export class DeepResearchRunner {
  private readonly activeRuns = new Map<string, ActiveDeepResearchRun>()
  private readonly listeners = new Set<(event: DeepResearchRunnerEvent) => void>()

  constructor(private readonly deps: DeepResearchRunnerDeps) {}

  subscribe(listener: (event: DeepResearchRunnerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(workspaceId: string, input: StartDeepResearchRunInput): DeepResearchRunSnapshot {
    const prepared = this.prepare(workspaceId, input)
    return prepared.planPolicy === 'auto'
      ? this.begin(workspaceId, prepared.id)
      : prepared
  }

  /**
   * Persist a run before any child work starts. Feature adapters can bind the
   * returned run id to their own durable owner record, then call begin().
   */
  prepare(
    workspaceId: string,
    input: StartDeepResearchRunInput,
    hostOptions: DeepResearchHostRunOptions = {},
  ): DeepResearchRunSnapshot {
    const topic = cleanTopic(input.topic)
    if (!topic) throw new Error('Deep research topic is required.')
    if (hostOptions.runId !== undefined && !isValidDeepResearchRunId(hostOptions.runId)) {
      throw new Error(`Invalid deep research run id: ${hostOptions.runId}`)
    }
    if (hostOptions.runId && existsSync(getDeepResearchRunFile(this.deps.getWorkspaceRootPath(workspaceId), hostOptions.runId))) {
      throw new Error(`Deep research run already exists: ${hostOptions.runId}`)
    }
    if (hostOptions.outputSchema !== undefined && !isValidWorkflowOutputSchema(hostOptions.outputSchema)) {
      throw new Error('Deep research output schema must be a JSON Schema object with a type.')
    }
    const purpose = cleanOptionalText(hostOptions.purpose, 241)
    if (purpose && purpose.length > 240) throw new Error('Deep research purpose cannot exceed 240 characters.')
    const ownerType = cleanOptionalText(hostOptions.owner?.type, 121)
    const ownerId = cleanOptionalText(hostOptions.owner?.id, 241)
    if (hostOptions.owner && (!ownerType || !ownerId)) {
      throw new Error('Deep research owner binding requires a type and id.')
    }
    if (ownerType && ownerType.length > 120) throw new Error('Deep research owner type cannot exceed 120 characters.')
    if (ownerId && ownerId.length > 240) throw new Error('Deep research owner id cannot exceed 240 characters.')
    if (hostOptions.owner?.generation !== undefined && (
      !Number.isInteger(hostOptions.owner.generation) || hostOptions.owner.generation < 0
    )) {
      throw new Error('Deep research owner generation must be a non-negative integer.')
    }

    const policy = input.planPolicy ?? 'approve'
    const nativePublicWebOnly = hostOptions.executionContract?.nativePublicWebOnly === true
    const sourceSlugs = nativePublicWebOnly ? [] : uniqueStrings(input.sourceSlugs)
    const sourceReadiness: DeepResearchSourceReadiness = nativePublicWebOnly
      ? { requested: [], usable: [], missing: [], unusable: [] }
      : this.deps.resolveSourceReadiness(workspaceId, sourceSlugs)
    const unavailable = [...sourceReadiness.missing, ...sourceReadiness.unusable]
    if (unavailable.length > 0) {
      throw new Error(`Deep research cannot start; unavailable source(s): ${unavailable.join(', ')}`)
    }
    const effectiveSourceSlugs = sourceSlugs.length > 0 ? sourceSlugs : sourceReadiness.usable
    if (!nativePublicWebOnly && effectiveSourceSlugs.length === 0) {
      throw new Error('Deep research requires at least one usable source. Activate or authenticate a source first.')
    }
    const depth = input.depth ?? 'standard'
    const reportFormat = input.reportFormat ?? 'standard'
    const sourceProfiles: DeepResearchSourceProfile[] = nativePublicWebOnly
      ? [{ slug: 'native-public-web', name: 'Built-in web_search and web_fetch', provider: 'native', type: 'builtin',
        capabilities: ['search', 'browser'], tagline: 'Use web_search for public discovery and web_fetch to read source pages. No connected-source tools are enabled.' }]
      : this.deps.resolveSourceProfiles(workspaceId, effectiveSourceSlugs)
    const hasDiscoverySource = sourceProfiles.some((source) => (
      source.capabilities.includes('search') || source.capabilities.includes('browser')
    ))
    if (!hasDiscoverySource) {
      throw new Error('Deep research requires at least one search or browser-capable source.')
    }

    const createdAt = nowIso()
    const title = input.title?.trim() || titleFromTopic(topic)
    const plan = buildPlan({
      topic,
      title,
      policy,
      sourceSlugs: effectiveSourceSlugs,
      sourceProfiles,
      depth,
      reportFormat,
      createdAt,
    })
    const executionContract = executionContractForDepth(depth, plan.loopBudget, hostOptions.executionContract)

    const run: DeepResearchRunSnapshot = {
      schemaVersion: 1,
      id: hostOptions.runId ?? randomUUID(),
      workspaceId,
      title,
      topic,
      state: policy === 'auto' ? 'created' : 'awaiting_plan_approval',
      planPolicy: policy,
      purpose,
      owner: hostOptions.owner ? {
        type: ownerType!,
        id: ownerId!,
        ...(hostOptions.owner.generation !== undefined ? { generation: hostOptions.owner.generation } : {}),
      } : undefined,
      executionContract,
      sourceReadiness,
      plan,
      steps: buildStepRuns(plan),
      events: [
        { ts: createdAt, type: 'created', message: 'Deep research run created.' },
        {
          ts: createdAt,
          type: 'plan.created',
          message: policy === 'auto' ? 'Plan created and ready for execution.' : 'Plan created; waiting for approval.',
        },
      ],
      outputSchema: hostOptions.outputSchema ? structuredClone(hostOptions.outputSchema) : undefined,
      createdAt,
      updatedAt: createdAt,
    }

    this.persist(run)
    this.emit({ type: 'run.created', run })

    return this.clone(run)
  }

  begin(workspaceId: string, runId: string): DeepResearchRunSnapshot {
    const run = this.requireRun(workspaceId, runId)
    if (run.planPolicy !== 'auto' || run.state !== 'created') {
      throw new Error(`Deep research run "${runId}" is not ready for automatic execution.`)
    }
    this.activateExecution(run, 'Plan auto-approved; execution started.')
    return this.clone(run)
  }

  approvePlan(workspaceId: string, runId: string): DeepResearchRunSnapshot {
    const run = this.requireRun(workspaceId, runId)
    if (run.state !== 'awaiting_plan_approval') {
      throw new Error(`Deep research run "${runId}" is not waiting for plan approval.`)
    }
    this.activateExecution(run, 'Plan approved; execution started.')
    return this.clone(run)
  }

  private activateExecution(run: DeepResearchRunSnapshot, message: string): void {
    const ts = nowIso()
    const contract = run.executionContract ?? executionContractForDepth(
      run.plan.depth ?? 'standard',
      run.plan.loopBudget ?? loopBudgetForDepth(run.plan.depth ?? 'standard'),
      undefined,
    )
    contract.startedAt = ts
    contract.deadlineAt = new Date(Date.now() + contract.overallTimeoutMs).toISOString()
    run.executionContract = contract
    run.state = 'running'
    run.plan.approvedAt = ts
    run.updatedAt = ts
    run.events.push({ ts, type: 'plan.approved', message })
    this.persist(run)
    this.emit({ type: 'run.updated', run })
    this.executeSoon(run)
  }

  revisePlan(workspaceId: string, runId: string, feedback: string): DeepResearchRunSnapshot {
    const run = this.requireRun(workspaceId, runId)
    if (run.state !== 'awaiting_plan_approval') {
      throw new Error(`Deep research run "${runId}" can only be revised before approval.`)
    }
    const trimmed = feedback.trim()
    if (!trimmed) throw new Error('Plan revision feedback is required.')
    const ts = nowIso()
    run.plan.revisionNotes = [...(run.plan.revisionNotes ?? []), trimmed]
    run.plan.steps = run.plan.steps.map((step) => ({
      ...step,
      instructions: `${step.instructions}\n\nPlan revision feedback:\n${trimmed}`,
    }))
    run.steps = buildStepRuns(run.plan)
    run.updatedAt = ts
    run.events.push({ ts, type: 'plan.revised', message: 'Plan revised from operator feedback.' })
    this.persist(run)
    this.emit({ type: 'run.updated', run })
    return this.clone(run)
  }

  async cancel(workspaceId: string, runId: string): Promise<DeepResearchRunSnapshot> {
    const active = this.activeRuns.get(runId)
    const run = active?.snapshot ?? this.requireRun(workspaceId, runId)
    if (run.workspaceId !== workspaceId) throw new Error(`Deep research run "${runId}" does not belong to workspace "${workspaceId}".`)
    if (isTerminalRunState(run.state)) return this.clone(run)

    // Fence publication first. Child abort is cleanup and may resolve late.
    const ts = nowIso()
    run.state = 'cancelled'
    run.updatedAt = ts
    run.completedAt = ts
    run.events.push({ ts, type: 'cancelled', message: 'Deep research run cancelled.' })
    this.persist(run)
    this.activeRuns.delete(runId)
    this.emit({ type: 'run.completed', run })

    if (active) active.abort.abort()
    if (active?.currentSessionId) {
      await this.abortSessionBestEffort(active.currentSessionId)
    }
    return this.clone(run)
  }

  private executeSoon(run: DeepResearchRunSnapshot): void {
    const toolBudget: ActiveDeepResearchRun['toolBudget'] = {
      searchCalls: 0,
      pageReads: 0,
      totalCalls: 0,
      activePageReads: new Set<string>(),
      pageAttempts: new Map<string, number>(),
      admittedToolUseIds: new Set<string>(),
    }
    const active: ActiveDeepResearchRun = {
      snapshot: this.clone(run),
      abort: new AbortController(),
      toolBudget,
    }
    active.hostToolExecutionGuard = this.createToolExecutionGuard(active)
    this.activeRuns.set(run.id, active)
    void this.execute(active).catch((err) => this.fail(active, err))
  }

  private createToolExecutionGuard(active: ActiveDeepResearchRun): HostToolExecutionGuard {
    return {
      beforeToolUse: ({ sessionId, toolUseId, toolName, input }) => {
        if (this.shouldStop(active)) {
          return { allowed: false, reason: 'Deep research run is no longer active.' }
        }
        if (this.isDeadlineExceeded(active.snapshot)) {
          return { allowed: false, reason: 'Deep research deadline exceeded.' }
        }
        const admissionKey = `${sessionId}\0${toolUseId}`
        if (active.toolBudget.admittedToolUseIds.has(admissionKey)) return { allowed: true }

        const kind = classifyResearchTool(toolName, active.snapshot.plan.sourceProfiles ?? [], input)
        const contract = this.executionContract(active.snapshot)
        if (contract.nativePublicWebOnly && !['web_search', 'web_fetch'].includes(normalizeResearchToolName(toolName))) {
          return { allowed: false, reason: 'This research run permits only built-in web_search and web_fetch.' }
        }
        if (contract.researchToolsOnly || contract.nativePublicWebOnly) {
          // Prefix membership alone classifies arbitrary source tools as source-read.
          // That is useful for accounting, but does not establish read-only intent.
          const method = typeof input.method === 'string' ? input.method.toUpperCase() : undefined
          const leaf = toolName.toLowerCase().split('__').at(-1) ?? ''
          const apiPath = typeof input.path === 'string' ? input.path : ''
          const recognizedApiPath = !leaf.startsWith('api_') || /^\/(?:search|query|discover|lookup|contents?|pages?|fetch|open|read|inspect|visit|browse)\/?$/.test(apiPath)
          if (!kind || kind === 'source-read' || !recognizedApiPath || (method !== undefined && !['GET', 'HEAD', 'POST'].includes(method))) {
            return { allowed: false, reason: 'This research run permits only recognized search and page-read tools.' }
          }
        }
        if (!kind) return { allowed: true }
        if (active.toolBudget.totalCalls >= contract.maxTotalResearchToolCalls) {
          return { allowed: false, reason: 'Deep research tool-call limit reached.' }
        }
        if (kind === 'search' && active.toolBudget.searchCalls >= contract.maxSearchCalls) {
          return { allowed: false, reason: 'Deep research search-call limit reached.' }
        }
        if (kind === 'page-read') {
          if (active.toolBudget.pageReads >= contract.maxPageReads) {
            return { allowed: false, reason: 'Deep research page-read limit reached.' }
          }
          if (active.toolBudget.activePageReads.size >= contract.maxConcurrentPageReads) {
            return { allowed: false, reason: 'Deep research concurrent page-read limit reached.' }
          }
          const attemptKey = this.pageAttemptKey(toolName, input)
          if (attemptKey) {
            const priorAttempts = active.toolBudget.pageAttempts.get(attemptKey) ?? 0
            if (priorAttempts >= contract.maxRetriesPerPage + 1) {
              return { allowed: false, reason: 'Deep research per-page retry limit reached.' }
            }
            active.toolBudget.pageAttempts.set(attemptKey, priorAttempts + 1)
          }
          active.toolBudget.pageReads += 1
          active.toolBudget.activePageReads.add(admissionKey)
        } else if (kind === 'search') {
          active.toolBudget.searchCalls += 1
        }
        active.toolBudget.totalCalls += 1
        active.toolBudget.admittedToolUseIds.add(admissionKey)
        return { allowed: true }
      },
      onToolUseCompleted: ({ sessionId, toolUseId, toolName, toolInput, toolResult, isError }) => {
        active.toolBudget.activePageReads.delete(`${sessionId}\0${toolUseId}`)
        const step = active.snapshot.steps.find((item) => item.sessionId === sessionId)
        if (!step) return
        this.captureToolReceipt(active.snapshot, step, {
          sessionId,
          toolUseId,
          toolName,
          toolInput,
          toolResult,
          isError,
        })
        this.persistAndEmit(active.snapshot)
      },
    }
  }

  private pageAttemptKey(toolName: string, input: Record<string, unknown>): string | undefined {
    const url = this.findAttemptUrl(input)
    if (url) return url
    if (Object.keys(input).length === 0) return undefined
    return `${toolName}:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`
  }

  private findAttemptUrl(value: unknown, depth = 0): string | undefined {
    if (depth > 6) return undefined
    const direct = sanitizeAttemptUrl(value)
    if (direct) return direct
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = this.findAttemptUrl(item, depth + 1)
        if (nested) return nested
      }
      return undefined
    }
    if (!value || typeof value !== 'object') return undefined
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const nested = this.findAttemptUrl(nestedValue, depth + 1)
      if (nested) return nested
    }
    return undefined
  }

  private async execute(active: ActiveDeepResearchRun): Promise<void> {
    for (const planStep of active.snapshot.plan.steps) {
      if (this.shouldStop(active)) return
      this.assertWithinDeadline(active.snapshot)
      const stepRun = active.snapshot.steps.find((step) => step.id === planStep.id)
      if (!stepRun) throw new Error(`Missing deep research step record: ${planStep.id}`)

      const startedAt = nowIso()
      stepRun.state = 'running'
      stepRun.startedAt = startedAt
      active.snapshot.updatedAt = startedAt
      active.snapshot.events.push({ ts: startedAt, type: 'step.started', message: `${planStep.title} started.` })
      this.persistAndEmit(active.snapshot)

      const session = await this.createSessionWithinDeadline(active, {
        name: `${active.snapshot.title} · ${planStep.title}`,
        hidden: true,
        permissionMode: active.snapshot.planPolicy === 'auto' ? 'safe' : 'ask',
        enabledSourceSlugs: active.snapshot.sourceReadiness.usable,
        sessionStatus: 'in-progress',
        customSystemPrompt: this.executionContract(active.snapshot).nativePublicWebOnly
          ? `${DEEP_RESEARCH_SYSTEM_PROMPT}\nUse only the built-in web_search and web_fetch tools. Search public web sources, then read their pages. Do not discover, activate, or call connected-source integrations.`
          : DEEP_RESEARCH_SYSTEM_PROMPT,
        launchReceipt: {
          createdAt: Date.now(),
          origin: 'deep-research',
          summary: `Deep research "${active.snapshot.title}" step "${planStep.title}".`,
          deepResearch: {
            runId: active.snapshot.id,
            stepId: planStep.id,
          },
          config: {},
          injected: {
            skills: [],
            sources: active.snapshot.sourceReadiness.usable,
            contextDocs: [],
            systemPromptChars: DEEP_RESEARCH_SYSTEM_PROMPT.length,
          },
        },
      })
      stepRun.sessionId = session.id
      active.currentSessionId = session.id
      try {
        if (this.shouldStop(active)) {
          try {
            await this.abortSessionBestEffort(session.id)
          } catch {
            // Best effort: the run has already been cancelled or otherwise stopped.
          }
          return
        }
        this.persistAndEmit(active.snapshot)

        await this.sendMessageWithTimeout(active, session.id, this.buildStepPrompt(active.snapshot, planStep))
        if (this.shouldStop(active)) return
        let output = this.deps.getLastAssistantText(session.id).trim()
        if (!output) throw new Error(`Step "${planStep.id}" produced no output.`)

        if (planStep.kind === 'synthesis' && active.snapshot.outputSchema) {
          let parsed = parseStructuredStepOutput(output, active.snapshot.outputSchema)
          const repairs = this.executionContract(active.snapshot).maxStructuredOutputRepairs
          for (let attempt = 0; !parsed.ok && attempt < repairs; attempt += 1) {
            await this.sendMessageWithTimeout(active, session.id, [
              'Your prior answer failed the required JSON output contract.',
              `Validation error: ${parsed.message}`,
              'Repair the answer using only evidence already gathered. Return only valid JSON matching the requested schema.',
            ].join('\n'))
            if (this.shouldStop(active)) return
            output = this.deps.getLastAssistantText(session.id).trim()
            parsed = parseStructuredStepOutput(output, active.snapshot.outputSchema)
          }
          if (!parsed.ok) {
            throw new Error(`Structured deep research output was invalid: ${parsed.message}`)
          }
          active.snapshot.structuredOutput = parsed.value
        }
        this.captureToolReceipts(active.snapshot, stepRun, session.id)
        if (requiresResearchToolUse(active.snapshot, planStep)) {
          const hasAuditableDiscovery = this.deps.getSessionToolUseRecords
            ? (stepRun.toolReceipts ?? []).some((receipt) => (
              receipt.status === 'succeeded' && (receipt.kind === 'search' || receipt.kind === 'page-read')
            ))
            : this.deps.getSessionToolUseSummary(session.id).names.some((name) => (
              classifyResearchTool(name, active.snapshot.plan.sourceProfiles ?? []) === 'search' ||
              classifyResearchTool(name, active.snapshot.plan.sourceProfiles ?? []) === 'page-read'
            ))
          if (!hasAuditableDiscovery) {
            const toolUseSummary = this.deps.getSessionToolUseSummary(session.id)
            throw new Error(
              `Step "${planStep.id}" did not use any selected search/browser tool. ` +
              `Completed tools: ${toolUseSummary.names.join(', ') || 'none'}.`,
            )
          }
        }

        const completedAt = nowIso()
        stepRun.state = 'succeeded'
        stepRun.output = output
        stepRun.completedAt = completedAt
        active.snapshot.updatedAt = completedAt
        active.snapshot.events.push({ ts: completedAt, type: 'step.completed', message: `${planStep.title} completed.` })
        this.persistAndEmit(active.snapshot)
      } finally {
        this.captureToolReceipts(active.snapshot, stepRun, session.id)
        active.currentSessionId = undefined
        await this.deleteHiddenStepSession(session.id)
      }
    }

    if (this.shouldStop(active)) return
    this.finalizeReport(active.snapshot)
    this.activeRuns.delete(active.snapshot.id)
    this.emit({ type: 'run.completed', run: active.snapshot })
  }

  private buildStepPrompt(run: DeepResearchRunSnapshot, step: DeepResearchPlanStep): string {
    const priorOutputs = run.steps
      .filter((item) => item.output)
      .map((item) => `## ${item.title}\n${item.output}`)
      .join('\n\n')
    const depth = run.plan.depth ?? 'standard'
    const reportFormat = run.plan.reportFormat ?? 'standard'
    const loopBudget = run.plan.loopBudget ?? loopBudgetForDepth(depth)
    const sourceProfiles = (run.plan.sourceProfiles ?? []).map((source) => (
      `- ${source.slug} (${source.name}; ${source.type}; ${source.capabilities.join(', ') || 'general'}${source.tagline ? `): ${source.tagline}` : ')'}`
    )).join('\n')
    const receiptCatalog = step.kind === 'synthesis'
      ? run.steps.flatMap((item) => item.toolReceipts ?? [])
        .filter((receipt) => receipt.status === 'succeeded')
        .map((receipt) => JSON.stringify({
          receiptId: receipt.id,
          kind: receipt.kind,
          url: receipt.responseUrl ?? receipt.requestUrl,
          observedAt: receipt.observedAt,
          resultSha256: receipt.resultSha256,
          supportExcerpt: receipt.supportExcerpt,
        }))
        .join('\n')
      : ''
    const prompt = [
      `Deep Research topic: ${run.topic}`,
      `Current step: ${step.title}`,
      `Depth: ${depth}`,
      `Report format: ${reportFormat}`,
      `Run-wide loop budget: ${loopBudget.maxSearchRounds} search calls, ${loopBudget.maxPagesToOpen} page/item inspections, minimum ${loopBudget.minFollowUpRounds} follow-up call(s) when gaps remain.`,
      '',
      'Selected source/tool profiles:',
      sourceProfiles || '- none',
      '',
      step.instructions,
      '',
      priorOutputs ? `Prior step outputs:\n\n${priorOutputs}` : 'No prior step outputs yet.',
      ...(step.kind === 'synthesis' ? [
        '',
        'Host-audited source receipts (JSON Lines):',
        receiptCatalog || '- none',
        'For structured evidence, use an exact receiptId and URL from this catalog. Evidence support must be a verbatim substring of that receipt supportExcerpt. Never invent a receipt, URL, or support text.',
      ] : []),
      '',
      'Return only the completed work for this step.',
    ].join('\n')
    return step.kind === 'synthesis' && run.outputSchema
      ? appendOutputSchemaInstruction(prompt, run.outputSchema)
      : prompt
  }

  private executionContract(run: DeepResearchRunSnapshot): DeepResearchExecutionContract {
    return run.executionContract ?? executionContractForDepth(
      run.plan.depth ?? 'standard',
      run.plan.loopBudget ?? loopBudgetForDepth(run.plan.depth ?? 'standard'),
      undefined,
    )
  }

  private isDeadlineExceeded(run: DeepResearchRunSnapshot): boolean {
    const deadlineAt = this.executionContract(run).deadlineAt
    return deadlineAt !== undefined && Date.now() >= Date.parse(deadlineAt)
  }

  private assertWithinDeadline(run: DeepResearchRunSnapshot): void {
    if (this.isDeadlineExceeded(run)) throw new Error('Deep research deadline exceeded.')
  }

  private captureToolReceipts(
    run: DeepResearchRunSnapshot,
    step: DeepResearchStepRun,
    sessionId: string,
  ): void {
    const records = this.deps.getSessionToolUseRecords?.(sessionId) ?? []
    if (records.length === 0) return
    const existing = new Map((step.toolReceipts ?? []).map((receipt) => [receipt.id, receipt]))
    for (const record of records) {
      const receipt = this.buildToolReceipt(run, step, { ...record, sessionId }, existing)
      if (receipt && !existing.has(receipt.id)) existing.set(receipt.id, receipt)
    }
    step.toolReceipts = Array.from(existing.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  private captureToolReceipt(
    run: DeepResearchRunSnapshot,
    step: DeepResearchStepRun,
    record: DeepResearchToolUseRecord,
  ): void {
    const existing = new Map((step.toolReceipts ?? []).map((receipt) => [receipt.id, receipt]))
    const receipt = this.buildToolReceipt(run, step, record, existing)
    if (!receipt) return
    existing.set(receipt.id, receipt)
    step.toolReceipts = Array.from(existing.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  private buildToolReceipt(
    run: DeepResearchRunSnapshot,
    step: DeepResearchStepRun,
    record: DeepResearchToolUseRecord,
    existing: Map<string, DeepResearchToolReceipt>,
  ): DeepResearchToolReceipt | null {
    const kind = classifyResearchTool(record.toolName, run.plan.sourceProfiles ?? [], record.toolInput)
    if (!kind) return null
    const result = record.toolResult ?? ''
    const id = createHash('sha256')
      .update(`${run.id}\0${step.id}\0${record.sessionId ?? ''}\0${record.toolUseId}`)
      .digest('hex')
      .slice(0, 32)
    return {
      id,
      toolUseId: record.toolUseId,
      toolName: record.toolName,
      kind,
      sourceSlug: sourceSlugFromToolName(record.toolName),
      status: record.isError ? 'failed' : 'succeeded',
      requestUrl: findUrlInValue(record.toolInput),
      // Tool output is untrusted content, not host-attested redirect metadata.
      // Keep the requested source URL even if that content claims a final URL.
      resultSha256: result ? createHash('sha256').update(result).digest('hex') : undefined,
      resultChars: result.length,
      supportExcerpt: !record.isError && kind !== 'search' ? supportExcerpt(result) : undefined,
      observedAt: existing.get(id)?.observedAt ?? nowIso(),
    }
  }

  private async sendMessageWithTimeout(active: ActiveDeepResearchRun, sessionId: string, prompt: string): Promise<void> {
    const depth = active.snapshot.plan.depth ?? 'standard'
    const stepTimeoutMs = DEEP_RESEARCH_STEP_TIMEOUT_MS_BY_DEPTH[depth] ?? DEEP_RESEARCH_STEP_TIMEOUT_MS_BY_DEPTH.standard
    const deadlineAt = this.executionContract(active.snapshot).deadlineAt
    const deadlineRemainingMs = deadlineAt ? Date.parse(deadlineAt) - Date.now() : stepTimeoutMs
    if (deadlineRemainingMs <= 0) throw new Error('Deep research deadline exceeded.')
    const timeoutMs = Math.min(stepTimeoutMs, deadlineRemainingMs)
    const deadlineBound = timeoutMs === deadlineRemainingMs
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.deps.sendMessage(sessionId, prompt),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(deadlineBound
              ? 'Deep research deadline exceeded.'
              : `Deep research step timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
          }, timeoutMs)
        }),
      ])
    } catch (err) {
      if (err instanceof Error && (
        err.message.startsWith('Deep research step timed out') ||
        err.message === 'Deep research deadline exceeded.'
      )) {
        try {
          await this.abortSessionBestEffort(sessionId)
        } catch {
          // The timeout failure is the meaningful error; abort cleanup is best-effort.
        }
      }
      throw err
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  private async deleteHiddenStepSession(sessionId: string): Promise<void> {
    if (!this.deps.deleteSession) return
    try {
      await this.withCleanupTimeout(this.deps.deleteSession(sessionId))
    } catch {
      // Hidden deep-research sessions are transient; run snapshots retain the useful output.
    }
  }

  private async createSessionWithinDeadline(
    active: ActiveDeepResearchRun,
    options: CreateSessionOptions,
  ): Promise<{ id: string }> {
    const deadlineAt = this.executionContract(active.snapshot).deadlineAt
    const remainingMs = deadlineAt ? Date.parse(deadlineAt) - Date.now() : 0
    if (remainingMs <= 0) throw new Error('Deep research deadline exceeded.')
    const creating = this.deps.createSession(active.snapshot.workspaceId, options, active.hostToolExecutionGuard)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let removeAbortListener: (() => void) | undefined
    try {
      return await Promise.race([
        creating,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Deep research deadline exceeded.')), remainingMs)
        }),
        new Promise<never>((_, reject) => {
          const onAbort = () => reject(new Error('Deep research run cancelled.'))
          active.abort.signal.addEventListener('abort', onAbort, { once: true })
          removeAbortListener = () => active.abort.signal.removeEventListener('abort', onAbort)
        }),
      ])
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'Deep research deadline exceeded.' ||
        error.message === 'Deep research run cancelled.'
      )) {
        void creating.then((session) => this.deleteHiddenStepSession(session.id)).catch(() => {})
      }
      throw error
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      removeAbortListener?.()
    }
  }

  private async abortSessionBestEffort(sessionId: string): Promise<void> {
    try { await this.withCleanupTimeout(this.deps.abortSession(sessionId)) } catch {}
  }

  private async withCleanupTimeout<T>(work: Promise<T>): Promise<T | undefined> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<undefined>((resolve) => {
          timeoutId = setTimeout(() => resolve(undefined), CLEANUP_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  private finalizeReport(run: DeepResearchRunSnapshot): void {
    const ts = nowIso()
    const report = [
      `# ${run.title}`,
      '',
      `Topic: ${run.topic}`,
      '',
      '## Plan',
      ...run.plan.steps.map((step, index) => `${index + 1}. ${step.title}`),
      '',
      '## Research Output',
      ...run.steps.map((step) => [
        `### ${step.title}`,
        '',
        step.output ?? step.error ?? 'No output.',
      ].join('\n')),
    ].join('\n')
    const workspaceRoot = this.deps.getWorkspaceRootPath(run.workspaceId)
    const output = createOutputBundle(workspaceRoot, {
      workspaceId: run.workspaceId,
      title: `${run.title} Research Report`,
      kind: 'report',
      status: 'published',
      summary: `Deep research report for ${run.topic}`,
      origin: { source: 'deep-research', deepResearchRunId: run.id },
      content: report,
      contentMimeType: 'text/markdown',
      tags: ['deep-research'],
      completedAt: ts,
    })
    run.outputId = output.id
    run.state = 'succeeded'
    run.updatedAt = ts
    run.completedAt = ts
    run.events.push({ ts, type: 'report.created', message: 'Research report output created.' })
    this.persist(run)
    this.emit({ type: 'outputs.updated', workspaceId: run.workspaceId })
    this.emit({ type: 'run.updated', run })
  }

  private fail(active: ActiveDeepResearchRun, err: unknown): void {
    if (this.shouldStop(active)) {
      if (this.activeRuns.get(active.snapshot.id) === active) this.activeRuns.delete(active.snapshot.id)
      return
    }
    const ts = nowIso()
    const message = err instanceof Error ? err.message : String(err)
    active.snapshot.state = 'failed'
    active.snapshot.error = message
    active.snapshot.updatedAt = ts
    active.snapshot.completedAt = ts
    const runningStep = active.snapshot.steps.find((step) => step.state === 'running')
    if (runningStep) {
      runningStep.state = 'failed'
      runningStep.error = message
      runningStep.completedAt = ts
      active.snapshot.events.push({ ts, type: 'step.failed', message: `${runningStep.title} failed: ${message}` })
    }
    active.snapshot.events.push({ ts, type: 'failed', message })
    this.persist(active.snapshot)
    this.activeRuns.delete(active.snapshot.id)
    this.emit({ type: 'run.completed', run: active.snapshot })
  }

  private requireRun(workspaceId: string, runId: string): DeepResearchRunSnapshot {
    const run = readDeepResearchRun(this.deps.getWorkspaceRootPath(workspaceId), runId)
    if (!run) throw new Error(`Deep research run not found: ${runId}`)
    if (run.workspaceId !== workspaceId) {
      throw new Error(`Deep research run "${runId}" does not belong to workspace "${workspaceId}".`)
    }
    return run
  }

  recoverInterruptedRuns(workspaces: Array<{ id: string; rootPath: string }>): DeepResearchRunSnapshot[] {
    const recovered: DeepResearchRunSnapshot[] = []
    for (const workspace of workspaces) {
      recovered.push(
        ...markActiveDeepResearchRunsInterrupted(
          workspace.rootPath,
          'Deep research run was interrupted while RunnerOS was not running.',
        ),
      )
    }
    for (const run of recovered) this.emit({ type: 'run.completed', run })
    return recovered
  }

  private shouldStop(active: ActiveDeepResearchRun): boolean {
    return active.abort.signal.aborted ||
      isTerminalRunState(active.snapshot.state) ||
      this.activeRuns.get(active.snapshot.id) !== active
  }

  private persistAndEmit(run: DeepResearchRunSnapshot): void {
    this.persist(run)
    this.emit({ type: 'run.updated', run })
  }

  private persist(run: DeepResearchRunSnapshot): void {
    const root = this.deps.getWorkspaceRootPath(run.workspaceId)
    attachDeepResearchAgentMessageReceipts(root, run)
    writeDeepResearchRun(root, run)
  }

  private emit(event: DeepResearchRunnerEvent): void {
    this.deps.emit?.(event)
    for (const listener of this.listeners) {
      try { listener(event) } catch {}
    }
  }

  private clone(run: DeepResearchRunSnapshot): DeepResearchRunSnapshot {
    return JSON.parse(JSON.stringify(run)) as DeepResearchRunSnapshot
  }
}
