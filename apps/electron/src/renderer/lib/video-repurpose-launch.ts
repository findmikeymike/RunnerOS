import { openAgentSessionComposer } from './run-agent'
import type {
  AgentDefinitionDTO,
  ContextDocDTO,
  CreateSessionOptions,
  LoadedSkill,
  LoadedSource,
  Session,
} from '../../shared/types'

const RAW_VIDEO_EDITOR_SLUG = 'raw-video-editor'

type OpenAgentSessionComposerFn = typeof openAgentSessionComposer

export interface OpenVideoRepurposeSessionParams {
  workspaceId: string
  draftInput?: string
  autoSendDraft?: boolean
  navigateOnCreate?: boolean
  activeAgents?: AgentDefinitionDTO[]
  skills?: LoadedSkill[]
  sources?: LoadedSource[]
  onCreateSession: (workspaceId: string, options?: CreateSessionOptions) => Promise<Session>
  onInputChange: (sessionId: string, value: string) => void
  onSendMessage: (sessionId: string, message: string) => boolean | void | Promise<boolean | void>
  getAgentDefinition?: (agentSlug: string) => Promise<AgentDefinitionDTO | null>
  listWorkspaceContextDocsForAgent?: (workspaceId: string, agentSlug: string) => Promise<ContextDocDTO[]>
  openSessionComposer?: OpenAgentSessionComposerFn
}

export async function openVideoRepurposeSession(params: OpenVideoRepurposeSessionParams): Promise<Session> {
  const activeAgents = params.activeAgents ?? []
  const getAgentDefinition = params.getAgentDefinition ?? window.electronAPI.getAgentDefinition
  const listWorkspaceContextDocsForAgent = params.listWorkspaceContextDocsForAgent ?? window.electronAPI.listWorkspaceContextDocsForAgent
  const openSessionComposer = params.openSessionComposer ?? openAgentSessionComposer

  const agent = activeAgents.find((candidate) => candidate.slug === RAW_VIDEO_EDITOR_SLUG)
    ?? await getAgentDefinition(RAW_VIDEO_EDITOR_SLUG)
  if (!agent) throw new Error('Raw Video Editor is not installed')

  const contextDocs = await listWorkspaceContextDocsForAgent(params.workspaceId, agent.slug).catch(() => [])
  return openSessionComposer({
    agent,
    workspaceId: params.workspaceId,
    onCreateSession: params.onCreateSession,
    onInputChange: params.onInputChange,
    onSendMessage: params.onSendMessage,
    skills: params.skills ?? [],
    sources: params.sources ?? [],
    contextDocs,
    agentCatalog: activeAgents.filter((candidate) => candidate.slug !== agent.slug),
    draftInput: params.draftInput,
    autoSendDraft: params.autoSendDraft ?? true,
    navigateOnCreate: params.navigateOnCreate,
  })
}
