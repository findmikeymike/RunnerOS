import { expect, test } from 'bun:test';
import { createDurableWorkflowBundleResolver, assertDurableWorkflowAgentMetadata } from './durable-workflow-bundle';
import type { CreateSessionOptions } from '../../../shared/src/protocol/dto';

type Dependencies = NonNullable<Parameters<typeof createDurableWorkflowBundleResolver>[0]>;
function fixture() {
  const config = { defaults: { model: 'standard', defaultLlmConnection: 'workspace-route', thinkingLevel: 'off', permissionMode: 'safe' } } as ReturnType<Dependencies['loadWorkspaceConfig']> & {};
  const metadata = { name: 'Reader', description: '' } as NonNullable<ReturnType<Dependencies['loadGlobalAgent']>>['metadata'];
  const calls: unknown[] = [];
  const connection = { slug: 'workspace-route', name: 'Local', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', defaultModel: 'standard', createdAt: 1 } as NonNullable<ReturnType<Dependencies['resolveSessionConnection']>>;
  const deps = { getWorkspaceByNameOrId: () => ({ id: 'w', name: 'w', slug: 'w', rootPath: '/fixture', createdAt: 1 }),
    loadWorkspaceConfig: () => config, loadGlobalAgent: () => ({ slug: 'reader', metadata }),
    resolveSessionConnection: (...args: unknown[]) => { calls.push(args); return connection; }, getMiniModel: () => 'mini',
    getDefaultThinkingLevel: () => 'off', loadConfigDefaults: () => ({ workspaceDefaults: { permissionMode: 'safe' } }),
    resolveBackendContext: (args: { managedModel?: string }) => { calls.push(args); return { provider: 'pi', authType: 'api_key', connection, resolvedModel: args.managedModel ?? 'standard', capabilities: { needsHttpPoolServer: false } }; },
  } as unknown as Dependencies;
  const options: Partial<CreateSessionOptions> = { customSystemPrompt: 'Exact composed prompt\n\nContext retained', spawnedFromAgent: { agentSlug: 'reader', agentName: 'Reader' } };
  return { config, metadata, calls, connection, deps, options, resolve: createDurableWorkflowBundleResolver(deps) };
}

test('preserves full host prompt and standard workspace route defaults', () => {
  const f = fixture(); expect(f.resolve('w', 'reader', f.options)).toEqual({ connectionSlug: 'workspace-route', model: 'standard', systemPrompt: f.options.customSystemPrompt! });
  expect(f.calls).toEqual([{ sessionConnectionSlug: undefined, workspaceDefaultConnectionSlug: 'workspace-route', managedModel: 'standard' }]);
});
for (const alias of ['fast', 'default']) test(`resolves ${alias} through existing connection helpers`, () => {
  const f = fixture(); const result = f.resolve('w', 'reader', { ...f.options, model: alias, llmConnection: 'agent-route' });
  expect(result.model).toBe(alias === 'fast' ? 'mini' : 'standard'); expect(f.calls[0]).toEqual(['agent-route', 'workspace-route']);
});
for (const field of ['skills', 'sources', 'optionalSources', 'trustedWorkerTools'] as const) test(`rejects declared ${field} before composing an agent`, () => {
  expect(() => assertDurableWorkflowAgentMetadata({ name: 'x', description: '', [field]: ['needed'] })).toThrow('unsupported-durable-agent-bundle');
});
test('inherited sources cannot silently disappear; explicit empty list preserves normal override semantics', () => {
  const f = fixture(); f.config.defaults!.enabledSourceSlugs = ['connector'];
  expect(() => f.resolve('w', 'reader', f.options)).toThrow('unsupported-durable-agent-bundle');
  expect(f.resolve('w', 'reader', { ...f.options, enabledSourceSlugs: [] }).model).toBe('standard');
});
test('rejects resolved skills, thinking, task focus, and different workspace execution directory', () => {
  const f = fixture();
  for (const extra of [{ agentSkillSlugs: ['skill'] }, { thinkingLevel: 'high' }, { trustedWorkerTools: ['write'] }, { permissionMode: 'allow-all' }, { launchReceipt: { taskMode: { id: 'focus' } } }]) {
    expect(() => f.resolve('w', 'reader', { ...f.options, ...extra } as Partial<CreateSessionOptions>)).toThrow('unsupported-durable-agent-bundle');
  }
  f.config.defaults!.workingDirectory = '/different'; expect(() => f.resolve('w', 'reader', f.options)).toThrow('unsupported-durable-agent-bundle');
});
test('rejects unsupported provider authentication rather than substituting a different connection', () => {
  const f = fixture(); f.connection.authType = 'oauth'; expect(() => f.resolve('w', 'reader', f.options)).toThrow('unsupported-durable-agent-bundle');
});
