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
  publicWebSourcesOnly?: boolean
  executionContract?: Partial<Omit<DeepResearchExecutionContract, 'startedAt' | 'deadlineAt'>>
  outputSchema?: Record<string, unknown>
}

const READ_ONLY_BROWSER_COMMANDS = new Set([
  'back',
  'close',
  'console',
  'find',
  'focus',
  'forward',
  'hide',
  'navigate',
  'network',
  'open',
  'release',
  'reload',
  'screenshot',
  'screenshot-region',
  'scroll',
  'snapshot',
  'stop',
  'wait',
  'window-resize',
])

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

function sanitizePublicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase().replace(/[-.]/g, '_')
      if (/^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_hsenc|_hsmi)$/.test(normalizedKey) ||
          /(?:^|_)(?:api_?key|key|access_?token|refresh_?token|token|auth|authorization|secret|password|signature|sig|credential)(?:_|$)/.test(normalizedKey)) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
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

function isBrowserCommandTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return (normalized.split('__').at(-1) ?? normalized) === 'browser_tool'
}

function isHostNativeBrowserTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === 'browser_tool' || normalized === 'mcp__session__browser_tool'
}

function isUnpinnedLocalWebFetchTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === 'webfetch' || normalized === 'web_fetch'
}

function hasUnquotedBrowserBatchSeparator(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (const character of value) {
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"' && !inSingle) inDouble = !inDouble
    else if (character === "'" && !inDouble) inSingle = !inSingle
    else if (character === ';' && !inSingle && !inDouble) return true
  }
  return false
}

function nativeBrowserCommand(input: Record<string, unknown>): { name: string; argument?: string } | undefined {
  if (Array.isArray(input.command)) {
    if (input.command.length === 0 || !input.command.every((item) => typeof item === 'string')) return undefined
    const [rawName, ...rawArguments] = input.command as string[]
    const name = rawName?.trim().toLowerCase()
    if (!name || !/^[a-z_-]+$/.test(name)) return undefined
    return { name, argument: rawArguments.length === 1 ? rawArguments[0] : undefined }
  }
  if (typeof input.command !== 'string') return undefined
  const match = /^\s*([a-z_-]+)(?:\s+(.+?))?\s*$/i.exec(input.command)
  if (!match) return undefined
  return { name: match[1]!.toLowerCase(), argument: match[2] }
}

function requestUrlFromTool(toolName: string, input: Record<string, unknown>): string | undefined {
  if (!isBrowserCommandTool(toolName)) return findUrlInValue(input)
  const command = nativeBrowserCommand(input)
  return command?.name === 'navigate' ? sanitizePublicUrl(command.argument) : undefined
}

function urlFromToolResult(toolName: string, input: Record<string, unknown>, result: string | undefined): string | undefined {
  if (!result) return undefined
  // Tool output is untrusted page/provider content. Only the host-owned native
  // browser envelope may attest to the page that was actually observed.
  if (!isHostNativeBrowserTool(toolName)) return undefined
  const command = nativeBrowserCommand(input)
  if (command?.name !== 'navigate' && command?.name !== 'snapshot') return undefined
  const firstLine = result.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const envelope = /^(?:Navigated to|URL):\s*(https?:\/\/\S+)\s*$/i.exec(firstLine)
  return sanitizePublicUrl(envelope?.[1]?.replace(/[\])},.;]+$/, ''))
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

function classifyCertifiedPublicApiRead(
  toolName: string,
  sourceProfiles: DeepResearchSourceProfile[],
  input: Record<string, unknown>,
): 'search' | 'page-read' | undefined {
  const sourceSlug = sourceSlugFromToolName(toolName)
  const source = sourceProfiles.find((candidate) => candidate.slug.toLowerCase() === sourceSlug?.toLowerCase())
  if (!source?.publicWebCertified || source.type !== 'api' || source.provider.toLowerCase() !== 'exa') return undefined
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : ''
  const path = typeof input.path === 'string' ? input.path.trim().toLowerCase() : ''
  if (method !== 'POST') return undefined
  if (path === '/search') return 'search'
  if (path === '/contents') return 'page-read'
  return undefined
}

function classifyResearchTool(
  toolName: string,
  sourceProfiles: DeepResearchSourceProfile[],
  input: Record<string, unknown> = {},
  publicWebSourcesOnly = false,
): DeepResearchToolKind | null {
  if (!isRelevantResearchToolName(toolName, sourceProfiles)) return null
  const normalized = toolName.toLowerCase()
  const leaf = normalized.split('__').at(-1) ?? normalized
  const apiPath = typeof input.path === 'string' ? input.path.toLowerCase() : ''
  if (leaf.startsWith('api_')) {
    if (publicWebSourcesOnly) return classifyCertifiedPublicApiRead(toolName, sourceProfiles, input) ?? 'source-read'
    const method = typeof input.method === 'string' ? input.method.toUpperCase() : ''
    if (method === 'PUT' || method === 'DELETE' || method === 'PATCH') return 'source-read'
  }
  if (leaf.startsWith('api_') && /(?:^|\/)(?:search|query|discover|lookup)(?:\/|$)/.test(apiPath)) {
    return 'search'
  }
  if (leaf.startsWith('api_') && /(?:^|\/)(?:contents?|pages?|fetch|open|read|inspect|visit|browse)(?:\/|$)/.test(apiPath)) {
    return 'page-read'
  }
  if (normalized === 'web_search' || normalized === 'websearch' || ['search', 'query', 'discover', 'lookup'].includes(leaf)) {
    return 'search'
  }
  if (
    normalized === 'web_fetch' || normalized === 'webfetch' || leaf === 'browser_tool' ||
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
  const normalized = toolName.toLowerCase()
  if (
    normalized === 'web_search' ||
    normalized === 'websearch' ||
    normalized === 'web_fetch' ||
    normalized === 'webfetch' ||
    normalized === 'browser_tool' ||
    normalized === 'mcp__session__browser_tool'
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
    const requestedSourceSlugs = uniqueStrings(input.sourceSlugs)
    let sourceReadiness = this.deps.resolveSourceReadiness(workspaceId, requestedSourceSlugs)
    if (hostOptions.publicWebSourcesOnly) {
      const allReadiness = requestedSourceSlugs.length === 0
        ? sourceReadiness
        : this.deps.resolveSourceReadiness(workspaceId, [])
      const publicSlugs = this.deps.resolveSourceProfiles(workspaceId, allReadiness.usable)
        .filter((source) => (
          source.publicWebCertified === true &&
          (source.capabilities.includes('search') || source.capabilities.includes('browser'))
        ))
        .map((source) => source.slug)
      sourceReadiness = { requested: publicSlugs, usable: publicSlugs, missing: [], unusable: [] }
    }
    const unavailable = [...sourceReadiness.missing, ...sourceReadiness.unusable]
    if (unavailable.length > 0) {
      throw new Error(`Deep research cannot start; unavailable source(s): ${unavailable.join(', ')}`)
    }
    const effectiveSourceSlugs = hostOptions.publicWebSourcesOnly
      ? sourceReadiness.usable
      : requestedSourceSlugs.length > 0 ? requestedSourceSlugs : sourceReadiness.usable
    if (effectiveSourceSlugs.length === 0) {
      throw new Error('Deep research requires at least one usable source. Activate or authenticate a source first.')
    }
    const depth = input.depth ?? 'standard'
    const reportFormat = input.reportFormat ?? 'standard'
    const sourceProfiles = this.deps.resolveSourceProfiles(workspaceId, effectiveSourceSlugs)
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
      publicWebSourcesOnly: hostOptions.publicWebSourcesOnly === true || undefined,
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

    // Fence publication in memory before persistence. Even if the durable write
    // fails, child work cannot continue and publish success in this process.
    const ts = nowIso()
    run.state = 'cancelled'
    run.updatedAt = ts
    run.completedAt = ts
    run.events.push({ ts, type: 'cancelled', message: 'Deep research run cancelled.' })
    this.activeRuns.delete(runId)
    if (active) active.abort.abort()
    let persistenceError: unknown
    try {
      this.persist(run)
      this.emit({ type: 'run.completed', run })
    } catch (cause) {
      persistenceError = cause
    }
    if (active?.currentSessionId) {
      await this.abortSessionBestEffort(active.currentSessionId)
    }
    if (persistenceError) throw persistenceError
    return this.clone(run)
  }

  async interruptActiveRunsForShutdown(reason = 'Deep research was interrupted because Artist OS is shutting down.'): Promise<DeepResearchRunSnapshot[]> {
    const interrupted: DeepResearchRunSnapshot[] = []
    const sessionsToAbort: string[] = []
    const persistenceErrors: unknown[] = []
    const activeRuns = [...this.activeRuns.values()].filter((active) => !isTerminalRunState(active.snapshot.state))

    // Fence every run in memory first. A failure writing one workspace must not
    // leave later runs alive and able to publish during shutdown.
    for (const active of activeRuns) {
      const run = active.snapshot
      const ts = nowIso()
      run.state = 'interrupted'
      run.error = reason
      run.updatedAt = ts
      run.completedAt = ts
      const runningStep = run.steps.find((step) => step.state === 'running')
      if (runningStep) {
        runningStep.state = 'failed'
        runningStep.error = reason
        runningStep.completedAt = ts
      }
      run.events.push({ ts, type: 'failed', message: reason })
      this.activeRuns.delete(run.id)
      active.abort.abort()
      if (active.currentSessionId) sessionsToAbort.push(active.currentSessionId)
      interrupted.push(this.clone(run))
    }

    for (const active of activeRuns) {
      try {
        this.persist(active.snapshot)
        this.emit({ type: 'run.completed', run: active.snapshot })
      } catch (cause) {
        persistenceErrors.push(new Error(`Could not persist interrupted deep research run "${active.snapshot.id}".`, { cause }))
      }
    }
    await Promise.all(sessionsToAbort.map((sessionId) => this.abortSessionBestEffort(sessionId)))
    if (persistenceErrors.length > 0) {
      throw new AggregateError(persistenceErrors, `${persistenceErrors.length} deep research run(s) could not be persisted during shutdown.`)
    }
    return interrupted
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
        if (isUnpinnedLocalWebFetchTool(toolName)) {
          return { allowed: false, reason: 'Deep research must use its restricted browser or an approved source connector for page reads.' }
        }
        if (isBrowserCommandTool(toolName)) {
          if (hasUnquotedBrowserBatchSeparator(input.command)) {
            return { allowed: false, reason: 'Deep research browser actions must run one command at a time so each source receipt stays auditable.' }
          }
          const command = nativeBrowserCommand(input)
          if (!command || !READ_ONLY_BROWSER_COMMANDS.has(command.name)) {
            return { allowed: false, reason: 'Deep research browser access is read-only.' }
          }
        }
        const admissionKey = `${sessionId}\0${toolUseId}`
        if (active.toolBudget.admittedToolUseIds.has(admissionKey)) return { allowed: true }

        const kind = classifyResearchTool(
          toolName,
          active.snapshot.plan.sourceProfiles ?? [],
          input,
          active.snapshot.publicWebSourcesOnly === true,
        )
        if (!kind) {
          return active.snapshot.publicWebSourcesOnly
            ? { allowed: false, reason: 'Public-web research permits only certified public read tools.' }
            : { allowed: true }
        }
        if (kind === 'source-read') {
          return { allowed: false, reason: 'Deep research permits only recognized read-only source actions.' }
        }
        const contract = this.executionContract(active.snapshot)
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
        const admissionKey = `${sessionId}\0${toolUseId}`
        active.toolBudget.activePageReads.delete(admissionKey)
        if (!active.toolBudget.admittedToolUseIds.has(admissionKey)) return
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
        customSystemPrompt: DEEP_RESEARCH_SYSTEM_PROMPT,
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
    const toolInput = record.toolInput ?? {}
    const kind = classifyResearchTool(record.toolName, run.plan.sourceProfiles ?? [], toolInput)
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
      requestUrl: requestUrlFromTool(record.toolName, toolInput),
      responseUrl: urlFromToolResult(record.toolName, toolInput, record.toolResult),
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
