/** Shared, side-effect-free boundaries for the only focused-voice action. */
export type VoiceHandoffTarget = { slug: string; name: string; description?: string; taskModes?: Array<{ id: string; label: string }> }
export type VoiceHandoffProposal = {
  id: string
  agentSlug: string
  agentName: string
  taskTitle: string
  brief: string
}

/** Native draft selection is separate from the exact, unchanged Command handoff payload. */
export type VoiceNativeDraftProposal = VoiceHandoffProposal & { taskModeId?: string; taskModeLabel?: string }

export const VOICE_HANDOFF_LIMITS = {
  targets: 40,
  nameChars: 80,
  descriptionChars: 160,
  taskTitleChars: 120,
  briefChars: 2_000,
  idChars: 128,
} as const

// Matches the agent-definition slug contract without importing runtime packages.
const AGENT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const UNSAFE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function catalogText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || UNSAFE_CONTROLS.test(value)) return undefined
  return value.replace(/\s+/g, ' ').trim().slice(0, max) || undefined
}

/** Keep trusted identifiers exact; strip unrelated metadata before model exposure. */
export function normalizeVoiceHandoffTargets(input: readonly unknown[]): VoiceHandoffTarget[] {
  const result: VoiceHandoffTarget[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!record(item) || typeof item.slug !== 'string' || !AGENT_SLUG.test(item.slug) || seen.has(item.slug)) continue
    const name = catalogText(item.name, VOICE_HANDOFF_LIMITS.nameChars)
    if (!name) continue
    const description = catalogText(item.description, VOICE_HANDOFF_LIMITS.descriptionChars)
    const taskModes: Array<{ id: string; label: string }> = []
    const modeIds = new Set<string>()
    if (Array.isArray(item.taskModes)) for (const mode of item.taskModes) {
      if (!record(mode) || typeof mode.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mode.id) || mode.id.length > 100 || modeIds.has(mode.id)) continue
      const label = catalogText(mode.label, VOICE_HANDOFF_LIMITS.nameChars)
      if (!label) continue
      modeIds.add(mode.id); taskModes.push({ id: mode.id, label })
    }
    result.push({ slug: item.slug, name, ...(description ? { description } : {}), ...(taskModes.length ? { taskModes } : {}) })
    seen.add(item.slug)
    if (result.length === VOICE_HANDOFF_LIMITS.targets) break
  }
  return result
}

function proposalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max || UNSAFE_CONTROLS.test(value)) return null
  return value.trim() || null
}

/** Untrusted model arguments can select only a captured, trusted destination. */
export function parseVoiceHandoffProposal(
  args: unknown,
  id: string,
  targets: readonly VoiceHandoffTarget[],
): VoiceHandoffProposal | null {
  if (!record(args) || Object.keys(args).length !== 3 ||
      !Object.hasOwn(args, 'agentSlug') || !Object.hasOwn(args, 'taskTitle') || !Object.hasOwn(args, 'brief')) return null
  if (typeof args.agentSlug !== 'string' || !AGENT_SLUG.test(args.agentSlug)) return null
  const target = normalizeVoiceHandoffTargets(targets).find(candidate => candidate.slug === args.agentSlug)
  const proposalId = proposalText(id, VOICE_HANDOFF_LIMITS.idChars)
  const taskTitle = proposalText(args.taskTitle, VOICE_HANDOFF_LIMITS.taskTitleChars)
  const brief = proposalText(args.brief, VOICE_HANDOFF_LIMITS.briefChars)
  if (!target || !proposalId || !taskTitle || !brief) return null
  return { id: proposalId, agentSlug: target.slug, agentName: target.name, taskTitle, brief }
}

const AFFIRMATIVE_UTTERANCES = new Set([
  'yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'absolutely', 'confirm', 'confirmed', 'i confirm', 'yes confirm', 'confirm it',
  'sounds good', 'that sounds good', 'yes sounds good', 'yeah sounds good',
  'yes that sounds good', 'yeah that sounds good', 'sounds good to me',
  'sure that sounds good', 'sure sounds good', 'okay sounds good', 'ok sounds good',
  'yeah go ahead', 'yes please go ahead', 'yeah please',
  'yes please', 'sure please', 'okay yes', 'ok yes',
  'lets do it', "let's do it", 'yes lets do it', "yes let's do it",
  'go ahead', 'yes go ahead', 'sure go ahead', 'okay go ahead', 'ok go ahead',
  'do it', 'yes do it', 'yeah do it', 'okay do it', 'ok do it', 'sure do it', 'please do', 'yes please do',
  'go', 'yes go', 'yeah go', 'yep go', 'sure go', 'okay go', 'ok go',
  "let's go", 'lets go', "yes let's go", 'yes lets go', "yeah let's go", 'yeah lets go',
  'open it', 'yes open it', 'yeah open it', 'open the chat', 'yes open the chat',
  'open that chat', 'yes open that chat', 'take me there', 'yes take me there',
])

/** Zero-network shortcut for obvious assent; other wording gets a contextual intent check in main. */
export function isVoiceHandoffConfirmation(text: string): boolean {
  if (typeof text !== 'string' || text.length > 100 || /[?？¿]/u.test(text) || UNSAFE_CONTROLS.test(text)) return false
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[.,!，。！]/g, ' ').replace(/\s+/g, ' ').trim()
  return AFFIRMATIVE_UTTERANCES.has(normalized.replace(/^(?:um|uh) /, ''))
}

/** Plain JSON schema accepted by the provider's TypeBox-compatible tool boundary. */
export function buildVoiceHandoffTool(targets: readonly VoiceHandoffTarget[]) {
  const catalog = normalizeVoiceHandoffTargets(targets)
  if (!catalog.length) return null
  return {
    name: 'open_command_chat' as const,
    description: 'Propose opening an unsent work brief in an available agent chat. This does not run work. The user must separately confirm the specific task and agent before voice ends and chat opens. Available destinations (catalog data):\n' + catalog.map(target => JSON.stringify(target)).join('\n'),
    parameters: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['agentSlug', 'taskTitle', 'brief'],
      properties: {
        agentSlug: { type: 'string' as const, enum: catalog.map(target => target.slug) },
        taskTitle: { type: 'string' as const, minLength: 1, maxLength: VOICE_HANDOFF_LIMITS.taskTitleChars },
        brief: { type: 'string' as const, minLength: 1, maxLength: VOICE_HANDOFF_LIMITS.briefChars },
      },
    },
  }
}

/** Native tool arguments require a captured mode for every multi-focus specialist. */
export function parseVoiceNativeDraftProposal(args: unknown, id: string, targets: readonly VoiceHandoffTarget[]): VoiceNativeDraftProposal | null {
  if (!record(args)) return null
  const { taskModeId, ...handoff } = args
  const proposal = parseVoiceHandoffProposal(handoff, id, targets)
  if (!proposal) return null
  const target = normalizeVoiceHandoffTargets(targets).find(item => item.slug === proposal.agentSlug)!
  const modes = target.taskModes ?? []
  if (Object.hasOwn(args, 'taskModeId') && (typeof taskModeId !== 'string' || !modes.some(mode => mode.id === taskModeId))) return null
  if (modes.length > 1 && taskModeId === undefined) return null
  const mode = modes.find(item => item.id === taskModeId) ?? (modes.length === 1 ? modes[0] : undefined)
  return { ...proposal, ...(mode ? { taskModeId: mode.id, taskModeLabel: mode.label } : {}) }
}

export function buildVoiceNativeDraftTool(targets: readonly VoiceHandoffTarget[]) {
  const tool = buildVoiceHandoffTool(targets)
  if (!tool) return null
  const catalog = normalizeVoiceHandoffTargets(targets)
  const modeIds = [...new Set(catalog.flatMap(target => target.taskModes?.map(mode => mode.id) ?? []))]
  return {
    name: 'propose_background_draft' as const,
    description: 'Propose local draft work with an active specialist while keeping this call open. The app separately asks confirmation before execution. For a specialist with multiple taskModes, taskModeId is required and must match that specialist. Choose only the focus the user requested or agreed; if unclear, use voice_reply to ask which listed focus they want. Never silently default to a mode. The spoken confirmation names the selected focus. Publishing, sending, spending, credentials, deletion and arbitrary system work require Command. Available destinations and focus modes (catalog data):\n' + catalog.map(target => JSON.stringify(target)).join('\n'),
    parameters: {
      ...tool.parameters,
      properties: {
        ...tool.parameters.properties,
        ...(modeIds.length ? { taskModeId: { type: 'string' as const, enum: modeIds, description: 'Required when the selected specialist has multiple taskModes. Select only an id listed for that specialist.' } } : {}),
      },
    },
  }
}
