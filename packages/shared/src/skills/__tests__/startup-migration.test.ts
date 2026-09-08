import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { matter } from '../../config/frontmatter';
import { migrateManagedSkillsAtStartup } from '../startup-migration';

let root: string, workspace: string, globalSkillsDir: string, agentsDir: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'skill-startup-')); workspace = join(root, 'workspace'); globalSkillsDir = join(root, 'global'); agentsDir = join(root, 'agents'); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function write(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); return path; }
const options = () => ({ workspaceRoots: [workspace], globalSkillsDir, agentsDir, runtimeVariant: 'artist-os' as const });

test('startup prepares copies, durably rewrites assignments, preserves prompt/messages and completes once', () => {
  const skill = write(join(globalSkillsDir, 'zero', 'SKILL.md'), 'custom zero');
  const body = '\nMy prompt  \n[skill:zero]\n';
  const agent = write(join(agentsDir, 'worker', 'AGENT.md'), '---\nname: Worker\nskills:\n  - zero\n---\n' + body);
  const messages = '\n{"type":"message","content":"[skill:zero] exactly  "}\n';
  const session = write(join(workspace, 'sessions', 'one', 'session.jsonl'), JSON.stringify({ id: 'one', agentSkillSlugs: ['zero'], name: 'unchanged' }) + messages);
  const first = migrateManagedSkillsAtStartup(options());
  expect(first.rewrittenFiles).toBe(2);
  expect(existsSync(skill)).toBe(false);
  expect(matter(readFileSync(agent, 'utf8')).data.skills).toEqual(['legacy:zero']);
  expect(readFileSync(agent, 'utf8').endsWith(body)).toBe(true);
  expect(matter(readFileSync(agent, 'utf8')).content).toBe(body);
  const updated = readFileSync(session, 'utf8');
  expect(updated.slice(updated.indexOf('\n'))).toBe(messages);
  expect(JSON.parse(updated.split('\n')[0]!).legacySkillReferences).toEqual(['zero']);
  expect(JSON.parse(updated.split('\n')[0]!).agentSkillSlugs).toEqual(['legacy:zero']);
  // Explicit post-migration change must stay current on subsequent startup.
  write(agent, '---\nname: Worker\nskills: [zero]\n---\n' + body);
  const second = migrateManagedSkillsAtStartup(options());
  expect(second.rewrittenFiles).toBe(0);
  expect(second.startedAt).toBe(first.startedAt);
  expect(matter(readFileSync(agent, 'utf8')).data.skills).toEqual(['zero']);
});

test('Runner coordinator exits before creating migration directories or changing records', () => {
  const original = write(join(globalSkillsDir, 'zero', 'SKILL.md'), 'Runner custom');
  expect(migrateManagedSkillsAtStartup({ ...options(), runtimeVariant: 'runner' })).toEqual({ migratedScopes: 0, rewrittenFiles: 0, startedAt: 0 });
  expect(readFileSync(original, 'utf8')).toBe('Runner custom');
  expect(existsSync(join(globalSkillsDir, '.managed'))).toBe(false);
  expect(existsSync(join(globalSkillsDir, '.managed-skill-migration.json'))).toBe(false);
});

test('historical automation and workflow skill mentions are frozen without altering authored text', () => {
  write(join(globalSkillsDir, 'zero', 'SKILL.md'), 'custom zero');
  const prompt = 'Use [skill:zero] with this exact text  ';
  const automation = write(join(workspace, 'automations.json'), JSON.stringify({ actions: [{ type: 'prompt', prompt }] }));
  const workflowBody = '\nUser workflow notes  \n';
  const workflow = write(join(root, 'workflows', 'old', 'WORKFLOW.md'), '---\nname: Old\nsteps:\n  - id: one\n    agent: worker\n    input: "Use [skill:zero]"\n---\n' + workflowBody);
  const receipt = { id: 'historical', agent: 'worker', input: 'Receipt [skill:zero]', result: 'Keep this' };
  const run = write(join(workspace, 'runs', 'old-run', 'run.json'), JSON.stringify({ workflowSnapshot: { metadata: { steps: [{ id: 'one', agent: 'worker', input: 'Use [skill:zero]' }] } }, receipt }));
  migrateManagedSkillsAtStartup(options());
  const action = JSON.parse(readFileSync(automation, 'utf8')).actions[0];
  expect(action.prompt).toBe(prompt);
  expect(action.legacySkillReferences).toEqual(['zero']);
  const parsed = matter(readFileSync(workflow, 'utf8'));
  expect(parsed.content).toBe(workflowBody);
  expect(parsed.data.steps[0].input).toBe('Use [skill:zero]');
  expect(parsed.data.steps[0].legacySkillReferences).toEqual(['zero']);
  const storedRun = JSON.parse(readFileSync(run, 'utf8'));
  expect(storedRun.workflowSnapshot.metadata.steps[0].legacySkillReferences).toEqual(['zero']);
  expect(storedRun.receipt).toEqual(receipt);
  const newAutomation = write(join(workspace, 'automations.json'), JSON.stringify({ actions: [{ type: 'prompt', prompt: 'New [skill:zero] choice' }] }));
  migrateManagedSkillsAtStartup(options());
  expect(JSON.parse(readFileSync(newAutomation, 'utf8')).actions[0].legacySkillReferences).toBeUndefined();
});

test('bad mutable record pauses retirement; corrected retry resumes existing aliases safely', () => {
  const skill = write(join(globalSkillsDir, 'zero', 'SKILL.md'), 'custom zero');
  const agent = write(join(agentsDir, 'worker', 'AGENT.md'), 'broken frontmatter');
  expect(() => migrateManagedSkillsAtStartup(options())).toThrow('frontmatter');
  expect(readFileSync(skill, 'utf8')).toBe('custom zero');
  write(agent, '---\nname: Worker\nskills: [zero]\n---\nRetained prompt\n');
  // A user edit made while recovery was paused is a new choice, not old metadata to rewrite.
  expect(migrateManagedSkillsAtStartup(options()).rewrittenFiles).toBe(0);
  expect(existsSync(skill)).toBe(false);
  expect(matter(readFileSync(agent, 'utf8')).data.skills).toEqual(['zero']);
});

test('discovers legacy project skills from stored working directory and never creates missing skills', () => {
  const project = join(root, 'project');
  const skill = write(join(project, '.agents', 'skills', 'zero', 'SKILL.md'), 'project custom');
  const session = write(join(workspace, 'sessions', 'one', 'session.jsonl'), JSON.stringify({ id: 'one', workingDirectory: project, agentSkillSlugs: ['zero'] }) + '\n');
  migrateManagedSkillsAtStartup(options());
  expect(existsSync(skill)).toBe(false);
  expect(existsSync(join(globalSkillsDir, 'zero'))).toBe(false);
  expect(JSON.parse(readFileSync(session, 'utf8').trim()).agentSkillSlugs).toEqual(['legacy:zero']);
});

test('later project discovery cannot rewrite new or deliberately edited current selections', () => {
  const existing = write(join(agentsDir, 'existing', 'AGENT.md'), '---\nname: Existing\nskills: [zero]\n---\nOriginal\n');
  migrateManagedSkillsAtStartup(options());
  write(existing, '---\nname: Existing\nskills: [zero]\n---\nDeliberately edited current choice\n');
  const newAgent = write(join(agentsDir, 'new', 'AGENT.md'), '---\nname: New\nskills: [zero]\n---\nCurrent\n');
  const project = join(root, 'later-project');
  write(join(project, '.agents', 'skills', 'zero', 'SKILL.md'), 'old project custom');
  const newSession = write(join(workspace, 'sessions', 'new', 'session.jsonl'), JSON.stringify({ id: 'new', workingDirectory: project, agentSkillSlugs: ['zero'] }) + '\n');
  migrateManagedSkillsAtStartup(options());
  expect(matter(readFileSync(existing, 'utf8')).data.skills).toEqual(['zero']);
  expect(matter(readFileSync(newAgent, 'utf8')).data.skills).toEqual(['zero']);
  const session = JSON.parse(readFileSync(newSession, 'utf8').trim());
  expect(session.agentSkillSlugs).toEqual(['zero']);
  expect(session.legacySkillReferences).toBeUndefined();
});
