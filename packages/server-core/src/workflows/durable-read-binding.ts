import { getWorkspaces } from '../../../shared/src/config/storage.ts';
import { getCredentialManager } from '../../../shared/src/credentials/manager.ts';
import { resolveBackendContext } from '../../../shared/src/agent/backend/factory.ts';
import { durableCredentialIdentity } from '../../../shared/src/protocol/durable-execution.ts';
import { canonical } from '../../../shared/src/durable-execution/index.ts';
import type { DurableReadBinding } from './durable-read-runner.ts';

export function createDurableReadBindingResolver(deps = {
  getWorkspaces,
  resolveContext: resolveBackendContext,
  getApiKey: (slug: string) => getCredentialManager().getLlmApiKey(slug),
}) {
  return async (workspaceId: string, connectionSlug: string, model: string): Promise<DurableReadBinding> => {
    if (![workspaceId, connectionSlug, model].every(value => typeof value === 'string' && value.trim())) throw new Error('durable-binding-input-required');
    const current = () => {
      const workspace = deps.getWorkspaces().find(item => item.id === workspaceId);
      if (!workspace || workspace.remoteServer) throw new Error('durable-binding-local-workspace-required');
      const context = deps.resolveContext({ sessionConnectionSlug: connectionSlug, managedModel: model });
      const connection = context.connection;
      if (context.provider !== 'pi' || connection?.slug !== connectionSlug || context.resolvedModel !== model) throw new Error('durable-binding-exact-route-required');
      if (context.authType !== 'api_key' || connection.authType !== 'api_key' || !connection.piAuthProvider) throw new Error('durable-binding-api-key-required');
      return JSON.parse(canonical({ workspace, context })) as Pick<DurableReadBinding, 'workspace' | 'context'>;
    };
    const binding = current();
    const key = await deps.getApiKey(connectionSlug);
    if (!key) throw new Error('durable-binding-credential-required');
    if (canonical(current()) !== canonical(binding)) throw new Error('durable-binding-changed');
    const connection = binding.context.connection!;
    // Match the existing Pi driver's custom-endpoint transport identity, including OpenRouter.
    const provider = connection.customEndpoint || connection.piAuthProvider === 'openrouter' ? 'custom-endpoint' : connection.piAuthProvider!;
    const credentialIdentity = await durableCredentialIdentity({ provider, credential: { type: 'api_key', key } });
    return { ...binding, credentialIdentity };
  };
}
