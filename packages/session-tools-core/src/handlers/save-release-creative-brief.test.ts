import { expect, test } from 'bun:test';
import type { SessionToolContext } from '../context';
import { getSessionSafeBlockedToolNames, getSessionToolDefs } from '../tool-defs';
import { handleSaveReleaseCreativeBrief, saveReleaseCreativeBriefSchema, type SaveReleaseCreativeBriefInput } from './save-release-creative-brief';

const input = { body: 'Release direction', status: 'proposed' as const, expectedBody: null };
test('requires an available campaign callback and surfaces failures honestly', async () => {
  expect((await handleSaveReleaseCreativeBrief({} as SessionToolContext, input)).isError).toBe(true);
  const failed = await handleSaveReleaseCreativeBrief({ saveReleaseCreativeBrief: async () => { throw new Error('CONTEXT_DOC_CONFLICT'); } } as unknown as SessionToolContext, input);
  expect(failed.isError).toBe(true);
  expect(failed.content[0]).toMatchObject({ text: '[ERROR] CONTEXT_DOC_CONFLICT' });
  let actual: unknown;
  const saved = await handleSaveReleaseCreativeBrief({ saveReleaseCreativeBrief: async (value: SaveReleaseCreativeBriefInput) => { actual = value; return { saved: true }; } } as unknown as SessionToolContext, input);
  expect(saved.isError).toBe(false);
  expect(actual).toEqual(input);
});

test('strict bounded schema and safe mode block prevent implicit broad writes', () => {
  for (const invalid of [{ ...input, workspaceId: 'hq' }, { ...input, path: '/tmp/other' }, { ...input, status: 'final' }, { ...input, expectedBody: undefined }, { ...input, body: ' ' }, { ...input, body: 'x'.repeat(11001) }]) {
    expect(saveReleaseCreativeBriefSchema.safeParse(invalid).success).toBe(false);
  }
  expect(getSessionSafeBlockedToolNames()).toContain('save_release_creative_brief');
  const def = getSessionToolDefs().find(tool => tool.name === 'save_release_creative_brief')!;
  expect(def.executionMode).toBe('registry');
  expect(def.safeMode).toBe('block');
});
