import { expect, test } from 'bun:test';
import { setQueryModel } from './set-query-model';

test('strict model selection disposes and refuses to proceed on setModel failure', async () => {
  let disposed = false;
  const session = { setModel: async () => { throw new Error('model unavailable'); }, dispose: () => { disposed = true; } };
  await expect(setQueryModel(session, 'requested', true)).rejects.toThrow('model unavailable');
  expect(disposed).toBe(true);
});

test('ordinary utility behavior remains unchanged, successful selection is accepted', async () => {
  let disposed = false;
  expect(await setQueryModel({ setModel: async () => { throw new Error(); }, dispose: () => { disposed = true; } }, 'requested', false)).toBe(false);
  expect(disposed).toBe(false);
  expect(await setQueryModel({ setModel: async () => {}, dispose: () => {} }, 'requested', true)).toBe(true);
});
