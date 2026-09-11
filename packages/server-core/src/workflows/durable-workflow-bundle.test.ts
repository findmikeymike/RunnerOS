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

test('explicit skill-free mode replaces base skills and sources without inheriting defaults', () => {
  const f = fixture();
  f.metadata.skills = ['unsupported-base-skill']; f.metadata.sources = ['base-remote'];
  f.metadata.taskModes = [{ id: 'read', label: 'Read', description: 'Read only', kind: 'focus', primarySkillSlugs: [], requiredSourceSlugs: [] }];
  f.config.defaults!.enabledSourceSlugs = ['default-remote'];
  const mode = assertDurableWorkflowAgentMetadata(f.metadata, 'read')!;
  const options = { ...f.options, enabledSourceSlugs: [], launchReceipt: { taskMode: {
    schemaVersion: 1, id: mode.id, label: mode.label, definitionRevision: mode.definitionRevision, selectionSource: 'workflow', primarySkills: [], adjacentSkills: [], fullMode: false,
  } } } as unknown as Partial<CreateSessionOptions>;
  expect(f.resolve('w', 'reader', options, 'read').model).toBe('standard');
  expect(() => f.resolve('w', 'reader', options)).toThrow('unsupported-durable-agent-bundle');
  expect(() => f.resolve('w', 'reader', options, 'unknown')).toThrow('unsupported-durable-agent-bundle');
  expect(() => f.resolve('w', 'reader', f.options, 'read')).toThrow('unsupported-durable-agent-bundle');
  expect(() => f.resolve('w', 'reader', { ...options, enabledSourceSlugs: ['default-remote'] }, 'read')).toThrow('unsupported-durable-agent-bundle');
  expect(() => f.resolve('w', 'reader', { ...options, launchReceipt: { ...options.launchReceipt, taskMode: { ...options.launchReceipt!.taskMode!, definitionRevision: 'changed' } } } as Partial<CreateSessionOptions>, 'read')).toThrow('unsupported-durable-agent-bundle');
});

test('mode selection rejects primary skills and adjacent expansions before composition', () => {
  const f = fixture(); f.metadata.skills = ['write'];
  f.metadata.taskModes = [{ id: 'read', label: 'Read', description: 'Read', kind: 'focus', primarySkillSlugs: ['write'] }];
  expect(() => assertDurableWorkflowAgentMetadata(f.metadata, 'read')).toThrow('unsupported-durable-agent-bundle');
  f.metadata.taskModes[0]!.primarySkillSlugs = [];
  f.metadata.taskModes[0]!.adjacentSkills = [{ slug: 'write', when: 'later', expansion: 'same-session' }];
  expect(() => assertDurableWorkflowAgentMetadata(f.metadata, 'read')).toThrow('unsupported-durable-agent-bundle');
});

test('certified skills require exact resolved and injected lists before freezing their private prompt', () => {
  const f = fixture(), slugs = ['artist-belief-system', 'artist-brand-expression-strategist'];
  f.metadata.skills = slugs;
  const calls: unknown[] = [];
  f.deps.resolveDurableWorkflowSkills = (root, selected) => { calls.push([root, selected]); return '\nPRIVATE_FROZEN_SKILL_CONTEXT'; };
  const options = { ...f.options, agentSkillSlugs: slugs, launchReceipt: { injected: { skills: slugs } } } as Partial<CreateSessionOptions>;
  expect(f.resolve('w', 'reader', options).systemPrompt).toBe(f.options.customSystemPrompt + '\nPRIVATE_FROZEN_SKILL_CONTEXT');
  expect(calls).toEqual([['/fixture', slugs]]);
  for (const override of [{ agentSkillSlugs: [] }, { agentSkillSlugs: [...slugs].reverse() }, { launchReceipt: undefined }, { launchReceipt: { injected: { skills: [slugs[0]] } } }]) {
    expect(() => f.resolve('w', 'reader', { ...options, ...override } as Partial<CreateSessionOptions>)).toThrow('unsupported-durable-agent-bundle');
  }
  expect(calls).toHaveLength(1);
});

test('explicit certified skill mode verifies its frozen primary receipt and rejects expansion', () => {
  const f = fixture(), skills = ['artist-belief-system'];
  f.metadata.skills = ['unsupported-base-skill', ...skills];
  f.metadata.taskModes = [{ id: 'belief', label: 'Belief', description: 'Read-only doctrine', kind: 'focus', primarySkillSlugs: skills }];
  const mode = assertDurableWorkflowAgentMetadata(f.metadata, 'belief')!;
  f.deps.resolveDurableWorkflowSkills = (_root, selected) => { expect(selected).toEqual(skills); return '\nFROZEN_BELIEF'; };
  const options = { ...f.options, agentSkillSlugs: skills, enabledSourceSlugs: [], launchReceipt: { injected: { skills }, taskMode: {
    schemaVersion: 1, id: mode.id, label: mode.label, definitionRevision: mode.definitionRevision, selectionSource: 'workflow', primarySkills: skills, adjacentSkills: [], fullMode: false,
  } } } as unknown as Partial<CreateSessionOptions>;
  expect(f.resolve('w', 'reader', options, 'belief').systemPrompt).toContain('FROZEN_BELIEF');
  options.launchReceipt!.taskMode!.primarySkills = [];
  expect(() => f.resolve('w', 'reader', options, 'belief')).toThrow('unsupported-durable-agent-bundle');
  f.metadata.taskModes[0]!.adjacentSkills = [{ slug: 'artist-brand-expression-strategist', when: 'later', expansion: 'same-session' }];
  expect(() => assertDurableWorkflowAgentMetadata(f.metadata, 'belief')).toThrow('unsupported-durable-agent-bundle');
});

test('mode uses selected required filesystem sources and refuses missing composed requirements', () => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), 'durable-mode-source-')); roots.push(root);
  f.deps.getWorkspaceByNameOrId = () => ({ id: 'w', name: 'w', slug: 'w', rootPath: root, createdAt: 1 });
  mkdirSync(join(root, 'sources', 'notes'), { recursive: true }); mkdirSync(join(root, 'notes'));
  writeFileSync(join(root, 'sources', 'notes', 'config.json'), JSON.stringify({ id: 'notes', slug: 'notes', name: 'notes', enabled: true, type: 'local', provider: 'local', local: { format: 'filesystem', path: join(root, 'notes') } }));
  f.metadata.sources = ['unselected-remote', 'notes'];
  f.metadata.taskModes = [{ id: 'read', label: 'Read', description: 'Read', kind: 'focus', primarySkillSlugs: [], requiredSourceSlugs: ['notes'] }];
  const mode = assertDurableWorkflowAgentMetadata(f.metadata, 'read')!;
  const options = { ...f.options, enabledSourceSlugs: ['notes'], launchReceipt: { taskMode: {
    schemaVersion: 1, id: mode.id, label: mode.label, definitionRevision: mode.definitionRevision, selectionSource: 'workflow', primarySkills: [], adjacentSkills: [], fullMode: false,
  } } } as unknown as Partial<CreateSessionOptions>;
  expect(() => assertDurableWorkflowSourcesBeforeComposition(root, f.metadata, 'read')).not.toThrow();
  expect(f.resolve('w', 'reader', options, 'read').localSources?.map(source => source.slug)).toEqual(['notes']);
  expect(() => f.resolve('w', 'reader', { ...options, enabledSourceSlugs: [] }, 'read')).toThrow('unsupported-durable-agent-bundle');
});


test('precomposition ignores usable optional MCP sources not selected by a skill-free mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'durable-mode-optional-')); roots.push(root);
  mkdirSync(join(root, 'sources', 'remote'), { recursive: true });
  writeFileSync(join(root, 'sources', 'remote', 'config.json'), JSON.stringify({ id: 'remote', slug: 'remote', name: 'Remote', enabled: true,
    type: 'mcp', provider: 'custom', isAuthenticated: true, mcp: { transport: 'http', url: 'https://example.invalid/mcp', authType: 'none' } }));
  const f = fixture();
  f.metadata.optionalSources = ['remote'];
  f.metadata.taskModes = [{ id: 'read', label: 'Read', description: 'Read only', kind: 'focus', primarySkillSlugs: [], optionalSourceSlugs: ['remote'] }];
  expect(() => assertDurableWorkflowSourcesBeforeComposition(root, f.metadata, 'read')).not.toThrow();
  f.metadata.taskModes[0]!.requiredSourceSlugs = ['remote'];
  expect(() => assertDurableWorkflowSourcesBeforeComposition(root, f.metadata, 'read')).toThrow('unsupported-durable-agent-bundle');
});
