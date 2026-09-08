import { RUNTIME_IDENTITY } from '../../config/runtime-identity.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedSkillRuntime, type ManagedSkillRuntimeRecord } from './managed-skill-runtime.ts';
import { TestAgent, createMockBackendConfig, createMockWorkspace, createMockSession, createMockSource, collectEvents } from '../__tests__/test-utils.ts';
import { getSessionScopedToolCallbacks } from '../session-scoped-tool-callback-registry.ts';
const roots: string[] = [];
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
class PrivateBoundaryAgent extends TestAgent {
  selected = true;
  get privatePrompt() { return this.privateSkillSystemPrompt; }
  get pin() { return this.managedSkillRuntime?.get('boundary-test'); }
  setSources(usable: boolean) { this.sourceManager.setAllSources([createMockSource({ slug: 'monid', enabled: usable, mcp: { url: 'https://unused.invalid', transport: 'http', authType: 'none' } })]); }
  inProviderTurn(message: string) { this.setCurrentTurnUserMessage(message); }
  protected extractSkillPaths(message: string) {
    const pinned = this.managedSkillRuntime?.get('boundary-test');
    return { skillPaths: new Map(this.selected && pinned ? [['boundary-test', join(pinned.path, 'SKILL.md')]] : []), cleanMessage: message, missingSkills: [] };
  }
}
function setup(requiredSources?: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'private-agent-boundary-')); roots.push(root);
  const sessionId = randomUUID(); const sessionPath = join(root, 'sessions', sessionId); mkdirSync(sessionPath, { recursive: true });
  const body = 'Private stock recipe, revision one.';
  const record: ManagedSkillRuntimeRecord = { slug: 'boundary-test', id: 'artist-os:skill:boundary-test', revision: hash(body), content: body, path: '', metadata: { name: 'Boundary test', requiredSources }, personalInstructions: [], personalRevision: hash(''), files: [
    { path: 'SKILL.md', content: body, sha256: hash(body), kind: 'instruction' },
    { path: 'references/detail.md', content: 'Reference revision one.', sha256: hash('Reference revision one.'), kind: 'instruction' },
  ] };
  const snapshot = new ManagedSkillRuntime(sessionPath); snapshot.beginRun('original-run'); snapshot.pin(record.slug, () => record);
  const agent = new PrivateBoundaryAgent(createMockBackendConfig({ workspace: createMockWorkspace({ rootPath: root }), session: createMockSession({ id: sessionId, workspaceRootPath: root }), agentSkillSlugs: ['boundary-test'] }));
  return { agent, sessionId, root };
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe.skipIf(RUNTIME_IDENTITY.variant !== 'artist-os')('provider-neutral private loading', () => {
  test('restores pinned primary recipe before discovery and keeps it out of the user message', async () => {
    const { agent, sessionId } = setup();
    await collectEvents(agent.chat('Help with the release.', undefined, { managedSkillRunId: 'original-run', resumeManagedSkillRun: true }));
    expect(agent.privatePrompt).toContain('Private stock recipe, revision one.');
    expect(agent.chatCalls[0]?.message).toBe('Help with the release.');
    const callbacks = getSessionScopedToolCallbacks(sessionId)!;
    expect(await callbacks.useSkillFn!('boundary-test')).toContain('already available');
    expect(await callbacks.readSkillReferenceFn!('boundary-test', 'references/detail.md')).toContain('Reference revision one.');
    agent.resetPrerequisiteState();
    await expect(callbacks.readSkillReferenceFn!('boundary-test', 'references/detail.md')).rejects.toThrow('parent skill');
    expect(await callbacks.useSkillFn!('boundary-test')).toContain('Private stock recipe, revision one.');
  });
  test('personal instruction mutations cannot bypass team role authorization', async () => {
    const { agent, sessionId, root } = setup();
    await collectEvents(agent.chat('Help.', undefined, { managedSkillRunId: 'original-run', resumeManagedSkillRun: true }));
    writeFileSync(join(root, 'config.json'), JSON.stringify({ id: sessionId, name: 'Unjoined team', slug: 'team-test', createdAt: Date.now(), updatedAt: Date.now(), storage: { mode: 'shared-folder' }, team: { enabled: true, teamId: 'test-team', members: [] } }));
    const callbacks = getSessionScopedToolCallbacks(sessionId)!;
    await expect(callbacks.saveSkillPersonalInstructionsFn!('monid', 'workspace', 'change')).rejects.toThrow('Team permission denied');
    await expect(callbacks.deleteSkillPersonalInstructionsFn!('monid', 'workspace')).rejects.toThrow('Team permission denied');
  });
  test('on-demand prerequisites require usable connection and schedule the existing source restart', async () => {
    const { agent, sessionId } = setup(['monid']); agent.selected = false;
    await collectEvents(agent.chat('Research next.', undefined, { managedSkillRunId: 'original-run', resumeManagedSkillRun: true }));
    const callbacks = getSessionScopedToolCallbacks(sessionId)!;
    agent.setSources(false); let activations = 0;
    agent.onSourceActivationRequest = async () => { activations++; return true; };
    await expect(callbacks.useSkillFn!('boundary-test')).rejects.toThrow('Connect and enable monid');
    expect(activations).toBe(0);
    await expect(callbacks.readSkillReferenceFn!('boundary-test', 'references/detail.md')).rejects.toThrow('parent skill');
    agent.setSources(true); agent.inProviderTurn('Research next.');
    expect(await callbacks.useSkillFn!('boundary-test')).toContain('Private stock recipe');
    expect(agent.consumePendingSourceActivationRestart()).toEqual({ sourceSlug: 'monid', userMessage: 'Research next.' });
  });
});
