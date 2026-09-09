/** Launched only in a subprocess with a disposable config root; never reads user credentials. */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts';
import { durableCredentialIdentity } from '../../../../shared/src/protocol/durable-execution.ts';
import { getCredentialManager } from '../../../../shared/src/credentials/manager.ts';
import { DurableReadRunner, type DurableReadBinding } from '../durable-read-runner.ts';

const root = process.env.DURABLE_HOST_FIXTURE_ROOT!;
if (!root || readFileSync(join(root, '.synthetic-host-fixture'), 'utf8') !== 'synthetic-only' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-fixture-root-required');
const fixtureKey = 'synthetic-durable-host-key';
const manager = getCredentialManager();
manager.getLlmApiKey = async slug => { if (slug !== 'host-fixture') throw new Error('unexpected-credential-read'); return fixtureKey; };
const requests: any[] = [];
const inputPath = join(root, 'fixture.txt');
writeFileSync(inputPath, 'REAL_HOST_NATIVE_READ');
const server = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${fixtureKey}`) throw new Error('incorrect-fixture-auth');
  let raw = ''; for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw); requests.push(input);
  const done = input.messages.some((message: any) => message.role === 'tool');
  const delta = done ? { role: 'assistant', content: 'HOST_FACTORY_READ_COMPLETED' }
    : { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'host-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: inputPath }) } }] };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (value: object, finish: string | null) => ({ id: 'host-fixture', object: 'chat.completion.chunk', created: 1, model: 'host-fixture-model', choices: [{ index: 0, delta: value, finish_reason: finish }] });
  response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, done ? 'stop' : 'tool_calls'))}\n\n`);
  response.end('data: [DONE]\n\n');
});
let journal: DurableJournal | undefined;
try {
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const serverFolder = join(root, 'app', 'packages', 'pi-agent-server', 'dist');
  mkdirSync(serverFolder, { recursive: true });
  // Resolve through the normal host-runtime path. Bun executes the source import without touching the app build.
  writeFileSync(join(serverFolder, 'index.js'), `import ${JSON.stringify(resolve(import.meta.dir, '../../../../pi-agent-server/src/index.ts'))};\n`);
  const binding: DurableReadBinding = { credentialIdentity: await durableCredentialIdentity({ provider: 'custom-endpoint', credential: { type: 'api_key', key: fixtureKey } }),
    workspace: { id: 'host-workspace', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'host-fixture-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false },
      connection: { slug: 'host-fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', piAuthProvider: 'openai',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, customEndpoint: { api: 'openai-completions' }, models: ['host-fixture-model'], createdAt: 1 } } };
  journal = new DurableJournal({ configRoot: join(root, 'config'), key: randomBytes(32) });
  const runner = new DurableReadRunner({ journal, hostRuntime: { appRootPath: join(root, 'app'), isPackaged: false, nodeRuntimePath: process.execPath }, resolveBinding: () => binding });
  const result = await runner.startWorkflow({ slug: 'fixture', source: 'global', path: root, body: '', metadata: { name: 'Fixture', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read the fixture file.' }] } },
    { runId: randomUUID(), commandId: randomUUID(), workspaceId: binding.workspace.id, connectionSlug: 'host-fixture', model: 'host-fixture-model', resolvedAgentSlug: 'reader',
      systemPrompt: 'Read the supplied local fixture with the read tool, then report completion.', allowedTools: ['read'], maxOutputTokens: 256, maxModelAttempts: 3,
      deadlineAt: Date.now() + 30000, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } });
  if (result.status !== 'succeeded' || requests.length !== 2 || !JSON.stringify(requests[1]).includes('REAL_HOST_NATIVE_READ')) throw new Error(`host-fixture-incomplete:${result.status}:${requests.length}`);
  console.log('DURABLE_HOST_RESULT:' + JSON.stringify({ status: result.status, providerRequests: requests.length, modelAttempts: result.modelAttempts, nativeReadRecorded: JSON.stringify(result.turns).includes('REAL_HOST_NATIVE_READ') }));
} finally {
  journal?.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
}
