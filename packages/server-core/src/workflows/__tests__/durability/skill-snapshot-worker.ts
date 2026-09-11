import { appendFileSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { resolveDurableWorkflowSkills } from '../../durable-workflow-skills';
import { DurableJournal, loadDurableKey } from '../../../../../shared/src/durable-execution';
import { savePersonalInstruction } from '../../../../../shared/src/skills/personal-instructions';
import { setGlobalSkillEnabled } from '../../../../../shared/src/skills/storage';
import { getManagedSkillManifest } from '../../../../../shared/src/skills/managed';
const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'skill-snapshot-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-skill-fixture-required');
const slug = 'artist-belief-system', workspaceId = 'skill-fixture';
const runId = mode === 'new' ? '22222222-2222-4333-8444-555555555555' : '11111111-2222-4333-8444-555555555555';
const oldPreference = 'PRIVATE_PREFERENCE_BEFORE_ADMISSION', newPreference = 'PRIVATE_PREFERENCE_AFTER_ADMISSION';
setGlobalSkillEnabled(root, slug, true);
if (mode !== 'new') savePersonalInstruction(root, slug, { scope: 'workspace', text: mode === 'start' ? oldPreference : newPreference });
const expected = mode === 'new' ? newPreference : oldPreference;
const entry = getManagedSkillManifest().get(slug)!;
const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const workspace = { id: workspaceId, name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 }, actor = { clientId: 'fixture', workspaceId };
function saved() {
  const key = loadDurableKey(join(root, 'config'), protection);
  const journal = new DurableJournal({ configRoot: join(root, 'config'), key }); key.fill(0);
  try { return journal.get(runId, workspaceId); } finally { journal.close(); }
}
function assertPrivateSnapshot(prompt: string) {
  if (!prompt.includes(expected) || prompt.includes(mode === 'new' ? oldPreference : newPreference)
    || !prompt.includes(JSON.stringify(entry.content))
    || !entry.files.filter(file => file.path !== 'SKILL.md').every(file => prompt.includes(JSON.stringify(file.content)))) throw new Error('frozen-skill-snapshot-mismatch');
}
const host = DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
  hostRuntime: { appRootPath: root, isPackaged: false }, authorizeRun: () => {},
  resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
  createBackend: args => ({ async *chat() {
    const prompt = args.coreConfig.customSystemPrompt!;
    assertPrivateSnapshot(prompt);
    const bridge = args.coreConfig.durableExecution!;
    const started = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { systemPrompt: prompt } });
    if (started.cached === undefined) {
      appendFileSync(join(root, 'model-dispatches'), mode + '\n');
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Deliverable completed' }] } });
    }
    if (mode === 'start') { writeSync(1, JSON.stringify({ barrier: 'saved-skill-model', runId }) + '\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }),
} });
try {
  if (mode === 'recover') {
    const before = saved();
    await host.controls.control(workspaceId, runId, { commandId: 'resume-skill', expectedVersion: before.version, action: 'resume' }, actor);
    for (let attempt = 0; attempt < 200 && saved().status !== 'succeeded'; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  } else {
    const workflow = { slug: 'skill-read', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, name: 'Skill read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Produce deliverable.' }] } };
    const admitted = await host.admitWorkflowForActor(workflow, { runId, commandId: 'start-' + mode, workspaceId, connectionSlug: 'fixture', model: 'fixture', resolvedAgentSlug: 'reader', allowedTools: ['read', 'grep', 'find', 'ls'], systemPrompt: 'Read only.' + resolveDurableWorkflowSkills(root, [slug]), maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 3, costPolicy: { unit: 'model-requests', maxTotalUnits: 3, maxUnitsPerAttempt: 1 } }, actor);
    await admitted.execution;
  }
  if (saved().status !== 'succeeded') throw new Error('snapshot-run-did-not-succeed');
  const publicState = JSON.stringify(await host.runs.get(workspaceId, runId, actor));
  if ([oldPreference, newPreference, 'private-durable-skill-guidance', entry.content.slice(0, 100)].some(marker => publicState.includes(marker))) throw new Error('private-skill-guidance-exposed');
  console.log(JSON.stringify({ result: 'succeeded', mode, publicHistorySafe: true }));
} finally { await host.close(); }
