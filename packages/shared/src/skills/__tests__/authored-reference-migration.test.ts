import { expect, test } from 'bun:test';
import { markLegacyAuthoredSkillReferences, getLegacyAuthoredSkillReferences, resolveRunLegacySkillReferences } from '../authored-reference-migration.ts';
import { PromptActionSchema } from '../../automations/schemas.ts';
import { parseWorkflowFile, serializeWorkflow } from '../../workflows/parser.ts';

test('existing authored actions retain exact prompt bytes and only affected explicit choices', () => {
  const prompt = '  Use @artist-industry-hunter with @calendar.\nKeep [skill:workspace:monid] details.  \n';
  const config = { automations: { SchedulerTick: [{ actions: [{ type: 'prompt', prompt }] }] } };
  const migrated = markLegacyAuthoredSkillReferences(config, new Set(['artist-industry-hunter', 'monid', 'zero']));
  const action = migrated.automations.SchedulerTick[0]!.actions[0]!;
  expect(action.prompt).toBe(prompt);
  expect(getLegacyAuthoredSkillReferences(action)).toEqual(['artist-industry-hunter', 'monid']);
  expect(getLegacyAuthoredSkillReferences(PromptActionSchema.parse(action))).toEqual(['artist-industry-hunter', 'monid']);
  expect(config.automations.SchedulerTick[0]!.actions[0]).toEqual({ type: 'prompt', prompt });
});

test('edited or fresh actions select current skills; startup cannot refresh an edited legacy marker', () => {
  const action = markLegacyAuthoredSkillReferences({ type: 'prompt', prompt: 'Use @monid' }, new Set(['monid']));
  const edited = { ...action, prompt: 'Use @monid for a new request' };
  expect(getLegacyAuthoredSkillReferences(edited)).toEqual([]);
  expect(getLegacyAuthoredSkillReferences(markLegacyAuthoredSkillReferences(edited, new Set(['monid'])))).toEqual([]);
  expect(getLegacyAuthoredSkillReferences({ prompt: 'Use @monid' })).toEqual([]);
  expect(markLegacyAuthoredSkillReferences({ type: 'webhook', prompt: '@monid', url: 'https://example.invalid' }, new Set(['monid']))).toEqual({ type: 'webhook', prompt: '@monid', url: 'https://example.invalid' });
});

test('workflow authored inputs preserve frozen choice through parsing and serialization', () => {
  const original = { name: 'Test workflow', description: 'A test', trigger: { type: 'manual' as const }, steps: [{ id: 'research', agent: 'researcher', input: '[skill:monid] Research.' }] };
  const migrated = markLegacyAuthoredSkillReferences(original, new Set(['monid']));
  const text = serializeWorkflow(migrated, 'Exact workflow notes.');
  const parsed = parseWorkflowFile(text);
  expect(parsed?.metadata.steps[0]?.input).toBe(original.steps[0]!.input);
  expect(getLegacyAuthoredSkillReferences(parsed!.metadata.steps[0]!)).toEqual(['monid']);
  const edited = { ...migrated, steps: migrated.steps.map(step => ({ ...step, input: 'New [skill:monid] request.' })) };
  expect(getLegacyAuthoredSkillReferences(parseWorkflowFile(serializeWorkflow(edited, 'Notes'))!.metadata.steps[0]!)).toEqual([]);
});

test('fresh choices remain current after auth/source retry and persisted process recovery', () => {
  const fresh = resolveRunLegacySkillReferences({ historical: ['monid'] });
  expect(fresh).toEqual([]);
  expect(resolveRunLegacySkillReferences({ historical: ['monid'], previousRunReferences: fresh, isRetry: true })).toEqual([]);
  expect(resolveRunLegacySkillReferences({ historical: ['monid'], previousRunId: 'fresh', previousRunReferences: fresh, replayMessageId: 'fresh' })).toEqual([]);
  expect(resolveRunLegacySkillReferences({ historical: ['monid'], replayMessageId: 'old-message' })).toEqual(['monid']);
  expect(resolveRunLegacySkillReferences({ explicit: ['monid'], historical: ['zero'] })).toEqual(['monid']);
  expect(resolveRunLegacySkillReferences({ previousRunReferences: ['monid'], isRetry: true })).toEqual(['monid']);
});
