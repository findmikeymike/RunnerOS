import { expect, test } from 'bun:test';
import { DurableWorkflowLifetime } from './durable-workflow-lifetime';

test('quit waits for pending startup and host drainage; new startup stays blocked', async () => {
  const lifetime = new DurableWorkflowLifetime(); let created!: () => void, drained!: () => void, closed = false;
  const startup = new Promise<void>(resolve => created = resolve), drain = new Promise<void>(resolve => drained = resolve);
  const opening = lifetime.open(async () => { await startup; return { close: async () => { await drain; closed = true; } }; });
  const closing = lifetime.close(); expect(lifetime.close()).toBe(closing);
  await expect(lifetime.open(async () => ({ close: async () => {} }))).rejects.toThrow('closing');
  created(); await opening; await Promise.resolve(); expect(closed).toBe(false);
  drained(); await closing; expect(closed).toBe(true);
});

test('failed drainage can be retried without admitting another host', async () => {
  const lifetime = new DurableWorkflowLifetime(); let calls = 0;
  await lifetime.open(async () => ({ close: async () => { if (++calls === 1) throw new Error('disk unavailable'); } }));
  await expect(lifetime.close()).rejects.toThrow('disk unavailable');
  await lifetime.close(); expect(calls).toBe(2);
  await expect(lifetime.open(async () => ({ close: async () => {} }))).rejects.toThrow('closing');
});

test('duplicate hosts are refused; failed construction does not strand quit', async () => {
  const lifetime = new DurableWorkflowLifetime();
  const opening = lifetime.open(async () => { throw new Error('keychain locked'); });
  await expect(lifetime.open(async () => ({ close: async () => {} }))).rejects.toThrow('already-owned');
  await expect(opening).rejects.toThrow('keychain locked');
  await lifetime.close(); await lifetime.close();
});
