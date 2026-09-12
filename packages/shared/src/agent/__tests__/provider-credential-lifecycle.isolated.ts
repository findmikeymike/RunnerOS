import { afterAll, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CredentialId, StoredCredential } from '../../credentials/types.ts';
import { credentialIdToAccount } from '../../credentials/types.ts';

const profile = mkdtempSync(join(tmpdir(), 'provider-lifecycle-'));
const priorEnv = { ...process.env };
process.env.CRAFT_CONFIG_DIR = profile;
const connections = ['account-a', 'account-b'].map(slug => ({ slug, name: slug,
  providerType: 'anthropic', authType: 'api_key', baseUrl: `https://${slug}.invalid`,
  defaultModel: 'claude-sonnet-4-5', createdAt: 1 }));
writeFileSync(join(profile, 'config.json'), JSON.stringify({ workspaces: [], llmConnections: connections,
  defaultLlmConnection: 'account-a' }));
const store = new Map<string, { id: CredentialId; credential: StoredCredential }>();
const { getCredentialManager } = await import('../../credentials/index.ts');
const manager = getCredentialManager();
const backend = {
  get: async (id: CredentialId) => store.get(credentialIdToAccount(id))?.credential ?? null,
  set: async (id: CredentialId, credential: StoredCredential) => { store.set(credentialIdToAccount(id), { id, credential }); },
  delete: async (id: CredentialId) => store.delete(credentialIdToAccount(id)),
  list: async (filter: Partial<CredentialId>) => [...store.values()].map(x => x.id)
    .filter(id => Object.entries(filter).every(([key, value]) => id[key as keyof CredentialId] === value)),
};
Object.assign(manager, { initialized: true, backends: [backend], writeBackend: backend });
// Preserve production env construction, but never repair the user's ~/.claude.json.
const optionsModule = await import('../options.ts');
mock.module('../options.ts', () => ({ ...optionsModule,
  getDefaultOptions: (env: Record<string, string>) => ({ env: optionsModule.buildClaudeSubprocessEnv(env) }),
}));
const sdk = await import('@anthropic-ai/claude-agent-sdk');
const sdkCalls: any[] = [];
mock.module('@anthropic-ai/claude-agent-sdk', () => ({ ...sdk,
  query: ({ options }: any) => {
    sdkCalls.push(options);
    return (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'fixture' }] } };
      yield { type: 'result', subtype: 'success', result: 'fixture', usage: {} };
    })();
  },
}));
let refresh!: () => Promise<{ access: string; refresh: string; expires: number }>;
mock.module('@earendil-works/pi-ai/providers/github-copilot', () => ({
  githubCopilotProvider: () => ({ auth: { oauth: { refresh: () => refresh() } } }),
}));
const { ClaudeAgent } = await import('../claude-agent.ts');
const { PiAgent } = await import('../pi-agent.ts');
afterAll(() => {
  for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
  Object.assign(process.env, priorEnv);
  rmSync(profile, { recursive: true, force: true });
});
function config(slug: string): any {
  return { provider: 'anthropic', connectionSlug: slug, isHeadless: true, skipConfigWatcher: true,
    model: 'claude-sonnet-4-5', miniModel: 'claude-sonnet-4-5',
    workspace: { id: slug, name: slug, rootPath: profile },
    session: { id: slug, workingDirectory: profile, workspaceRootPath: profile },
    envOverrides: { CRAFT_WORKSPACE_PATH: profile } };
}
for (const operation of ['chat', 'mini', 'query'] as const) {
  test(`Claude ${operation} retains its own auth after another connection initializes`, async () => {
    await manager.setLlmApiKey('account-a', 'fixture-key-a');
    await manager.setLlmApiKey('account-b', 'fixture-key-b');
    const a = new ClaudeAgent(config('account-a')) as any;
    const b = new ClaudeAgent(config('account-b'));
    try {
      expect((await a.postInit()).authInjected).toBe(true);
      expect((await b.postInit()).authInjected).toBe(true);
      sdkCalls.length = 0;
      if (operation === 'chat') {
        a.keepBackgroundTasksAlive = true;
        a.beginPersistentTurn = (_prompt: unknown, options: any) => {
          sdkCalls.push(options); return (async function* () {})();
        };
        for await (const _event of a.chatImpl('fixture')) { /* capture production options only */ }
      } else if (operation === 'mini') await a.runMiniCompletion('fixture');
      else await a.queryLlm({ prompt: 'fixture' });
      expect(sdkCalls).toHaveLength(1);
      expect(sdkCalls[0].env.ANTHROPIC_API_KEY).toBe('fixture-key-a');
      expect(sdkCalls[0].env.ANTHROPIC_BASE_URL).toBe('https://account-a.invalid');
    } finally { a.destroy(); b.destroy(); }
  });
}
for (const change of ['logout', 'replace'] as const) {
  test(`Copilot late refresh cannot overwrite ${change}`, async () => {
    const slug = `copilot-${change}`;
    await manager.setLlmOAuth(slug, { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 });
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    refresh = async () => { started(); await gate; return { access: 'obsolete-access', refresh: 'obsolete-refresh', expires: Date.now() + 60_000 }; };
    const agent = new PiAgent({ ...config(slug), provider: 'pi', authType: 'oauth', runtime: { piAuthProvider: 'github-copilot' } } as any) as any;
    try {
      const pending = agent.refreshAndPushTokens();
      await entered;
      if (change === 'logout') await manager.deleteLlmCredentials(slug);
      else await manager.setLlmOAuth(slug, { accessToken: 'new-account', refreshToken: 'new-refresh', expiresAt: 2 });
      release();
      await pending;
      const stored = await manager.getLlmOAuth(slug);
      if (change === 'logout') expect(stored).toBeNull();
      else expect(stored?.accessToken).toBe('new-account');
    } finally { release?.(); agent.destroy(); }
  });
}

test('Claude initialization leaves host provider authentication unchanged', async () => {
  process.env.ANTHROPIC_API_KEY = 'parent-key';
  process.env.ANTHROPIC_BASE_URL = 'https://parent.invalid';
  const agent = new ClaudeAgent(config('account-a'));
  try {
    await agent.postInit();
    expect(process.env.ANTHROPIC_API_KEY).toBe('parent-key');
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://parent.invalid');
  } finally { agent.destroy(); }
});

test('Claude next utility reads replacement credentials and refuses a deleted account', async () => {
  await manager.setLlmApiKey('account-a', 'first-key');
  const agent = new ClaudeAgent(config('account-a'));
  try {
    await agent.runMiniCompletion('first');
    expect(sdkCalls.at(-1).env.ANTHROPIC_API_KEY).toBe('first-key');
    await manager.setLlmApiKey('account-a', 'replacement-key');
    await agent.queryLlm({ prompt: 'second' });
    expect(sdkCalls.at(-1).env.ANTHROPIC_API_KEY).toBe('replacement-key');
    // Remove the configured endpoint too: local keyless endpoints are valid,
    // but a normal Anthropic account must not use the parent's unrelated key.
    const { updateLlmConnection } = await import('../../config/storage.ts');
    updateLlmConnection('account-a', { baseUrl: '' });
    await manager.deleteLlmCredentials('account-a');
    await expect(agent.runMiniCompletion('third')).rejects.toThrow('No API key');
  } finally { agent.destroy(); }
});

function piConfig(slug: string): any {
  return { ...config(slug), provider: 'pi', authType: 'api_key', runtime: { piAuthProvider: 'anthropic' } };
}

test('Pi next chat retires changed credentials only after an earlier utility settles', async () => {
  const slug = 'pi-idle';
  await manager.setLlmApiKey(slug, 'old-key');
  const agent = new PiAgent(piConfig(slug)) as any;
  const events: string[] = [];
  agent.subprocessCredentials = await agent.credentialFingerprint();
  agent.killSubprocess = () => { events.push('retired'); };
  agent.ensureSubprocess = async () => { events.push(`started:${await manager.getLlmApiKey(slug)}`); };
  let release!: () => void;
  const previousUtility = new Promise<void>(resolve => { release = resolve; });
  agent.utilityOperations.add(previousUtility);
  await manager.setLlmApiKey(slug, 'new-key');
  const admission = agent.ensureCurrentChatSubprocess();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(events).toEqual([]);
  release();
  await admission;
  expect(events).toEqual(['retired', 'started:new-key']);
  agent.destroy();
});

test('Pi changed-account utility gets an unshared transport while the active turn remains alive', async () => {
  const slug = 'pi-busy';
  await manager.setLlmApiKey(slug, 'old-key');
  const agent = new PiAgent(piConfig(slug)) as any;
  agent.subprocessCredentials = await agent.credentialFingerprint();
  agent._isProcessing = true;
  let retired = false;
  agent.killSubprocess = () => { retired = true; };
  await manager.setLlmApiKey(slug, 'new-key');
  const prototype = PiAgent.prototype as any;
  const original = prototype.runMiniCompletionOnSubprocess;
  let utility: any;
  prototype.runMiniCompletionOnSubprocess = async function () {
    utility = this;
    return (await this.getPiAuth()).credential.key;
  };
  try {
    expect(await agent.runMiniCompletion('fixture')).toBe('new-key');
    expect(utility).not.toBe(agent);
    expect(utility.config.session).toBeUndefined();
    expect(utility.config.mcpPool).toBeUndefined();
    expect(retired).toBe(false);
  } finally { prototype.runMiniCompletionOnSubprocess = original; agent.destroy(); }
});

test('Pi saved CLI secret changes invalidate the next idle operation', async () => {
  const agent = new PiAgent(piConfig('pi-secret')) as any;
  await manager.setLlmApiKey('pi-secret', 'stable-provider-key');
  await manager.setUserSecret('ARTIST_OS_FIXTURE_CLI_KEY', 'old-secret');
  agent.subprocessCredentials = await agent.credentialFingerprint();
  let retired = 0;
  agent.killSubprocess = () => { retired++; };
  agent.ensureSubprocess = async () => {};
  try {
    await manager.deleteUserSecret('ARTIST_OS_FIXTURE_CLI_KEY');
    await agent.ensureCurrentChatSubprocess();
    expect(retired).toBe(1);
  } finally { agent.destroy(); }
});

test('Copilot refresh cannot replace a logout and identical-token re-login', async () => {
  const slug = 'copilot-same-bytes';
  const original = { accessToken: 'same-access', refreshToken: 'same-refresh', expiresAt: 1 };
  await manager.setLlmOAuth(slug, original);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  refresh = async () => { started(); await gate; return { access: 'obsolete', refresh: 'obsolete', expires: 20 }; };
  const agent = new PiAgent({ ...config(slug), provider: 'pi', authType: 'oauth', runtime: { piAuthProvider: 'github-copilot' } } as any) as any;
  try {
    const pending = agent.refreshAndPushTokens();
    await entered;
    await manager.deleteLlmCredentials(slug);
    await manager.setLlmOAuth(slug, original);
    release();
    await pending;
    expect((await manager.getLlmOAuth(slug))?.accessToken).toBe('same-access');
  } finally { release?.(); agent.destroy(); }
});

test('Pi same-slug endpoint replacement reaches new utilities while active transport stays pinned', async () => {
  const { addLlmConnection, updateLlmConnection, deleteLlmConnection } = await import('../../config/storage.ts');
  const slug = 'pi-routing';
  expect(addLlmConnection({ slug, name: slug, providerType: 'pi_compat', piAuthProvider: 'openai',
    authType: 'api_key', baseUrl: 'https://old-endpoint.invalid', customEndpoint: { api: 'openai-completions' },
    defaultModel: 'fixture-model', createdAt: 1 } as any)).toBe(true);
  await manager.setLlmApiKey(slug, 'original-key');
  const agent = new PiAgent(piConfig(slug)) as any;
  agent.config = agent.currentConnectionConfig();
  agent.subprocessCredentials = await agent.credentialFingerprint();
  agent._isProcessing = true;
  const prototype = PiAgent.prototype as any;
  const original = prototype.queryLlmOnSubprocess;
  prototype.queryLlmOnSubprocess = async function () {
    return { text: this.config.runtime.baseUrl, model: (await this.getPiAuth()).credential.key };
  };
  try {
    updateLlmConnection(slug, { baseUrl: 'https://new-endpoint.invalid' });
    await manager.setLlmApiKey(slug, 'replacement-key');
    expect(await agent.queryLlm({ prompt: 'fixture' })).toEqual({
      text: 'https://new-endpoint.invalid', model: 'replacement-key',
    });
    expect(agent.config.runtime.baseUrl).toBe('https://old-endpoint.invalid');
    deleteLlmConnection(slug);
    await expect(agent.queryLlm({ prompt: 'removed' })).rejects.toThrow('Connection not found');
  } finally { prototype.queryLlmOnSubprocess = original; agent.destroy(); }
});

test('Claude changed environment retires a persistent query only on next chat admission', async () => {
  const agent = new ClaudeAgent(config('account-b')) as any;
  let retired = 0;
  agent.persistentEnvironment = JSON.stringify({ ANTHROPIC_API_KEY: 'old-key' });
  agent.persistentInput = { push: () => {} };
  agent.currentQuery = {};
  agent.teardownPersistentQuery = () => { retired++; };
  try {
    await agent.runMiniCompletion('independent utility');
    expect(retired).toBe(0);
    agent.beginPersistentTurn({}, { env: { ANTHROPIC_API_KEY: 'new-key' } });
    expect(retired).toBe(1);
  } finally {
    agent.persistentInput = null;
    agent.currentQuery = null;
    agent.destroy();
  }
});

for (const provider of ['claude', 'pi'] as const) {
  test(`${provider} waits for endpoint and key setup to finish before admitting a utility`, async () => {
    const { withLlmConnectionMutation } = await import('../../config/connection-lifecycle.ts');
    const { addLlmConnection, updateLlmConnection } = await import('../../config/storage.ts');
    const slug = `setup-${provider}`;
    expect(addLlmConnection({ slug, name: slug, providerType: provider === 'claude' ? 'anthropic' : 'pi_compat',
      piAuthProvider: 'openai', authType: 'api_key', baseUrl: 'https://before.invalid',
      customEndpoint: { api: 'openai-completions' }, defaultModel: 'claude-sonnet-4-5', createdAt: 1 } as any)).toBe(true);
    await manager.setLlmApiKey(slug, 'before-key');
    const agent: any = provider === 'claude' ? new ClaudeAgent(config(slug)) : new PiAgent(piConfig(slug));
    const calls: any[] = [];
    if (provider === 'pi') agent.runMiniCompletionOnSubprocess = async () => {
      calls.push([agent.config.runtime.baseUrl, (await agent.getPiAuth()).credential.key]); return 'fixture';
    };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = withLlmConnectionMutation(slug, async () => {
      updateLlmConnection(slug, { baseUrl: 'https://after.invalid' });
      await gate;
      await manager.setLlmApiKey(slug, 'after-key');
    });
    sdkCalls.length = 0;
    try {
      const operation = agent.runMiniCompletion('fixture');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(calls).toHaveLength(0);
      expect(sdkCalls).toHaveLength(0);
      release(); await write; await operation;
      if (provider === 'claude') {
        expect(sdkCalls[0].env.ANTHROPIC_BASE_URL).toBe('https://after.invalid');
        expect(sdkCalls[0].env.ANTHROPIC_API_KEY).toBe('after-key');
      } else expect(calls).toEqual([['https://after.invalid', 'after-key']]);
    } finally { release(); await write; agent.destroy(); }
  });
}

test('Pi token publication never switches an active subprocess to a newer login', async () => {
  const slug = 'pi-publication';
  await manager.setLlmOAuth(slug, { accessToken: 'original', refreshToken: 'refresh' });
  const owner = await manager.captureSnapshot({ type: 'llm_oauth', connectionSlug: slug });
  const agent = new PiAgent({ ...config(slug), provider: 'pi', authType: 'oauth', runtime: { piAuthProvider: 'github-copilot' } } as any) as any;
  const sent: any[] = [];
  agent.subprocess = {};
  agent.subprocessAuthOwner = owner;
  agent.send = (message: any) => { sent.push(message); };
  try {
    await manager.compareAndSetSnapshot(owner, { value: 'rotated', refreshToken: 'refresh' });
    await agent.pushRefreshedOAuth(owner);
    expect(sent).toHaveLength(1);
    expect(sent[0].piAuth.credential.access).toBe('rotated');
    await manager.setLlmOAuth(slug, { accessToken: 'another-account', refreshToken: 'another-refresh' });
    const newer = await manager.captureSnapshot(owner.id);
    await agent.pushRefreshedOAuth(owner);
    await agent.pushRefreshedOAuth(newer);
    expect(sent).toHaveLength(1);
  } finally { agent.subprocess = null; agent.destroy(); }
});
