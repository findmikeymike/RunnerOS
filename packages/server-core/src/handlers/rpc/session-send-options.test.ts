import { expect, test } from 'bun:test';
import { humanSendMessageOptions } from './session-send-options.ts';

test('renderer sends cannot impersonate a migrated automation or revive old skill selections', () => {
  const options = { inputOrigin: 'system' as const, legacySkillReferences: ['monid'], skillSlugs: ['monid'], optimisticMessageId: 'message' };
  expect(humanSendMessageOptions(options)).toEqual({ inputOrigin: 'human', legacySkillReferences: [], skillSlugs: ['monid'], optimisticMessageId: 'message' });
  expect(options.legacySkillReferences).toEqual(['monid']);
  expect(humanSendMessageOptions()).toEqual({ inputOrigin: 'human', legacySkillReferences: [] });
});
