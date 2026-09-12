import { expect, test } from 'bun:test';
import { readStableLlmConnection, withLlmConnectionMutation } from '../connection-lifecycle.ts';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('connection readers wait for the complete endpoint/key update', async () => {
  const finish = gate();
  let endpoint = 'old', key = 'old';
  const write = withLlmConnectionMutation('pair-fixture', async () => { endpoint = 'new'; await finish.promise; key = 'new'; });
  const read = readStableLlmConnection('pair-fixture', async () => [endpoint, key]);
  finish.resolve();
  await write;
  expect(await read).toEqual(['new', 'new']);
});

test('a write overtaking asynchronous resolution reruns only the read', async () => {
  const started = gate(), finish = gate();
  let value = 'old', calls = 0;
  const read = readStableLlmConnection('overtaken-fixture', async () => {
    const captured = value;
    if (++calls === 1) { started.resolve(); await finish.promise; }
    return captured;
  });
  await started.promise;
  await withLlmConnectionMutation('overtaken-fixture', async () => { value = 'new'; });
  finish.resolve();
  expect(await read).toBe('new');
  expect(calls).toBe(2);
});

test('failed mutations do not poison later setup or reads', async () => {
  await expect(withLlmConnectionMutation('failure-fixture', async () => { throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
  await withLlmConnectionMutation('failure-fixture', async () => {});
  expect(await readStableLlmConnection('failure-fixture', async () => 'ready')).toBe('ready');
});
