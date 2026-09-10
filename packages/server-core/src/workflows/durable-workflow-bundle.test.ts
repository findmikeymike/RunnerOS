import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { createDurableWorkflowBundleResolver, assertDurableWorkflowAgentMetadata, assertDurableWorkflowSourcesBeforeComposition } from './durable-workflow-bundle';
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
for (const field of ['skills', 'trustedWorkerTools'] as const) test(`rejects declared ${field} before composing an agent`, () => {
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

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
test('required, selected optional and inherited local sources become frozen native-read context', () => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), 'durable-bundle-source-')); roots.push(root);
  f.deps.getWorkspaceByNameOrId = () => ({ id: 'w', name: 'w', slug: 'w', rootPath: root, createdAt: 1 });
  for (const slug of ['required', 'optional', 'inherited']) {
    mkdirSync(join(root, 'sources', slug), { recursive: true }); mkdirSync(join(root, slug));
    writeFileSync(join(root, 'sources', slug, 'config.json'), JSON.stringify({ id: slug, slug, name: slug, enabled: true, type: 'local', provider: 'local', local: { format: 'filesystem', path: join(root, slug) } }));
    writeFileSync(join(root, 'sources', slug, 'guide.md'), `Guide for ${slug}`);
  }
  f.metadata.sources = ['required']; f.metadata.optionalSources = ['optional'];
  expect(() => assertDurableWorkflowAgentMetadata(f.metadata)).not.toThrow();
  const result = f.resolve('w', 'reader', { ...f.options, enabledSourceSlugs: ['optional'] });
  expect(result.localSources?.map(source => source.slug)).toEqual(['optional', 'required']);
  expect(result.systemPrompt).toContain(f.options.customSystemPrompt!); expect(result.systemPrompt).toContain('Guide for required');
  expect(result.systemPrompt).toContain(join(root, 'optional'));
  f.metadata.sources = []; f.metadata.optionalSources = []; f.config.defaults!.enabledSourceSlugs = ['inherited'];
  expect(f.resolve('w', 'reader', f.options).localSources?.map(source => source.slug)).toEqual(['inherited']);
  expect(f.resolve('w', 'reader', { ...f.options, enabledSourceSlugs: [] }).localSources).toBeUndefined();
});

test('precomposition rejects selected built-in optional tools before composing context', () => {
  const root = mkdtempSync(join(tmpdir(), 'durable-bundle-precheck-')); roots.push(root);
  expect(() => assertDurableWorkflowSourcesBeforeComposition(root, { name: 'Reader', description: '', optionalSources: ['computer-use'] })).toThrow('unsupported-durable-agent-bundle');
});
