import { getWorkspaceByNameOrId, getMiniModel, getDefaultThinkingLevel, loadConfigDefaults } from '@craft-agent/shared/config';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { loadGlobalAgent } from '../../../shared/src/agent-definitions/storage';
import type { AgentMetadata } from '../../../shared/src/agent-definitions/types';
import { resolveBackendContext, resolveSessionConnection } from '../../../shared/src/agent/backend/factory';
import { normalizeThinkingLevel } from '../../../shared/src/agent/thinking-levels';
import type { CreateSessionOptions } from '../../../shared/src/protocol/dto';

const unsupported = () => new Error('unsupported-durable-agent-bundle');
/** Call before session-option composition, which can refresh context and enable skills. */
export function assertDurableWorkflowAgentMetadata(metadata: AgentMetadata): void {
  if (metadata.skills?.length || metadata.sources?.length || metadata.optionalSources?.length
    || metadata.trustedWorkerTools?.length || metadata.taskModes?.length || metadata.visualAgent) throw unsupported();
}
const defaults = { getWorkspaceByNameOrId, loadWorkspaceConfig, loadGlobalAgent, resolveBackendContext,
  resolveSessionConnection, getMiniModel, getDefaultThinkingLevel, loadConfigDefaults };

export function createDurableWorkflowBundleResolver(deps: typeof defaults = defaults) {
  return (workspaceId: string, agentSlug: string, options: Partial<CreateSessionOptions>): { connectionSlug: string; model: string; systemPrompt: string } => {
    const workspace = deps.getWorkspaceByNameOrId(workspaceId), agent = deps.loadGlobalAgent(agentSlug);
    if (!workspace || workspace.id !== workspaceId || workspace.remoteServer || !agent || agent.slug !== agentSlug) throw unsupported();
    assertDurableWorkflowAgentMetadata(agent.metadata);
    const config = deps.loadWorkspaceConfig(workspace.rootPath);
    const sources = options.enabledSourceSlugs ?? config?.defaults?.enabledSourceSlugs;
    const thinking = normalizeThinkingLevel(options.thinkingLevel) ?? normalizeThinkingLevel(config?.defaults?.thinkingLevel) ?? deps.getDefaultThinkingLevel();
    const permission = options.permissionMode ?? config?.defaults?.permissionMode ?? deps.loadConfigDefaults().workspaceDefaults.permissionMode;
    if (options.agentSkillSlugs?.length || sources?.length || options.trustedWorkerTools?.length || options.launchReceipt?.taskMode
      || thinking !== 'off' || permission !== 'safe' || !options.customSystemPrompt?.trim()
      || options.spawnedFromAgent && options.spawnedFromAgent.agentSlug !== agentSlug
      || options.workingDirectory && options.workingDirectory !== 'user_default'
      || config?.defaults?.workingDirectory && config.defaults.workingDirectory !== workspace.rootPath
      || options.branchFromSessionId || options.branchFromMessageId || options.systemPromptPreset
      || options.subconsciousMode && options.subconsciousMode !== 'default') throw unsupported();
    const defaultModel = config?.defaults?.model;
    let model = options.model || defaultModel;
    if (model === 'fast' || model === 'default') {
      const connection = deps.resolveSessionConnection(options.llmConnection, config?.defaults?.defaultLlmConnection);
      model = connection ? model === 'fast'
        ? deps.getMiniModel(connection) ?? connection.defaultModel ?? defaultModel
        : connection.defaultModel ?? defaultModel : defaultModel;
    }
    const context = deps.resolveBackendContext({ sessionConnectionSlug: options.llmConnection,
      workspaceDefaultConnectionSlug: config?.defaults?.defaultLlmConnection, managedModel: model });
    if (context.provider !== 'pi' || context.authType !== 'api_key' || context.connection?.authType !== 'api_key'
      || !context.connection.piAuthProvider || !context.connection.slug || !context.resolvedModel) throw unsupported();
    return { connectionSlug: context.connection.slug, model: context.resolvedModel, systemPrompt: options.customSystemPrompt };
  };
}
export const resolveDurableWorkflowBundle = createDurableWorkflowBundleResolver();
