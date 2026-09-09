import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { FixtureJournal, manifest, newRun, digest } from './fixture-journal.ts';
import { recoverFixture } from './fixture-engine.ts';
import { approve, fixtureKey, fixtureRoot, killAt, provider, runWorker, worker } from './process-support.ts';

describe('P-01 durable synthetic turn/approval/child/effect', () => {
  let remote: Awaited<ReturnType<typeof provider>>;
  beforeAll(async () => { remote = await provider(); });
  afterAll(async () => { await remote?.stop(); });
  const boundaries = ['model-committed', 'waiting-approval', 'child-admitted', 'result:read:0', 'child-result', 'prepared:effect', 'dispatched:effect', 'response:effect', 'result:effect', 'before-success'];
  for (const boundary of boundaries) test('SIGKILL at ' + boundary + ' (25 repetitions)', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    try {
      for (let i = 0; i < 25; i++) {
        const id = boundary.replaceAll(':', '-') + '-' + i;
        j.admit(newRun(id));
        if (boundary !== 'model-committed' && boundary !== 'waiting-approval') {
          await runWorker(root, key, id, remote.endpoint); approve(j, id);
        }
        await killAt(root, key, 'recover', id, remote.endpoint, boundary);
        if (!j.read(id).approval) await runWorker(root, key, id, remote.endpoint);
        if (!j.read(id).approval!.decision) approve(j, id);
        await runWorker(root, key, id, remote.endpoint);
        const run = j.read(id), stats = await remote.stats();
        expect(run.state).toBe('succeeded');
        expect(run.child?.id).toBe(id + ':child'); expect(run.child?.joined).toBe(true);
        expect(run.approval?.consumed).toBe(true);
        expect(stats.calls.find(row => row.id === id + ':model')?.count).toBe(1);
        expect(stats.calls.find(row => row.id === id + ':read:0')?.count).toBe(1);
        expect(stats.calls.find(row => row.id === id + ':read:1')?.count).toBe(1);
        expect(stats.effects.filter(row => row.id === id + ':effect')).toHaveLength(1);
        expect(j.db.prepare("SELECT count(*) n FROM events WHERE run_id=? AND kind='child-joined'").get(id).n).toBe(1);
      }
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('provider accepts then drops connection: reconcile keyed effect; opaque outcome stops without resend', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    try {
      for (const opaque of [false, true]) {
        const id = opaque ? 'drop-opaque' : 'drop-keyed';
        j.admit(newRun(id, { contract: opaque ? manifest.opaque! : manifest.effect! }));
        await runWorker(root, key, id, remote.endpoint); approve(j, id);
        expect((await worker(root, key, 'recover', id, remote.endpoint).done).code).toBe(1);
        await runWorker(root, key, id, remote.endpoint);
        expect(j.read(id).state).toBe(opaque ? 'needs-attention' : 'succeeded');
        const stats = await remote.stats();
        expect(stats.calls.find(row => row.id === id + ':effect')?.count).toBe(1);
        expect(stats.effects.filter(row => row.id.startsWith(id + ':effect'))).toHaveLength(1);
      }
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('cancel/revoke/pause/expiry while the same owner waits blocks the next dispatch', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    try {
      for (const action of ['cancel', 'revoke', 'pause', 'expire'] as const) {
        const id = 'control-' + action; j.admit(newRun(id));
        await runWorker(root, key, id, remote.endpoint); approve(j, id);
        const proc = worker(root, key, 'recover', id, remote.endpoint, 'before-dispatch:effect');
        try {
          await proc.line(line => line.includes('"barrier":"before-dispatch:effect"'));
          if (action === 'expire') j.update(id, 'fixture', null, 'fixture-expire', run => { run.approval!.expires = Date.now() - 1; });
          else j.command(id, 'fixture', 'control', action);
          proc.child.stdin.write('continue\n');
          expect((await proc.done).code).toBe(1);
          expect((await remote.stats()).calls.some(row => row.id === id + ':effect')).toBe(false);
        } finally { proc.child.kill('SIGKILL'); await proc.done; }
      }
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('late external completion stays observed without resurrecting a cancelled run', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key), id = 'late';
    j.admit(newRun(id)); await runWorker(root, key, id, remote.endpoint); approve(j, id);
    const proc = worker(root, key, 'recover', id, remote.endpoint, 'response:effect');
    try {
      await proc.line(line => line.includes('"barrier":"response:effect"'));
      j.command(id, 'fixture', 'cancel', 'cancel'); j.command(id, 'fixture', 'cancel', 'cancel');
      proc.child.stdin.write('continue\n'); await proc.done;
      expect(j.read(id).state).toBe('cancelled'); expect(j.read(id).operations.effect!.status).toBe('succeeded');
      expect(j.read(id).output).toBeUndefined();
    } finally { proc.child.kill('SIGKILL'); await proc.done; j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('duplicate approval, changed payload/account/adapter and uncertified tools are fenced', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key), id = 'identity';
    try {
      j.admit(newRun(id)); await runWorker(root, key, id, remote.endpoint); approve(j, id); approve(j, id);
      expect(() => j.command(id, 'fixture', 'approve-' + id, 'deny', j.read(id).approval!.digest)).toThrow('command-conflict');
      expect(() => j.command(id, 'fixture', 'changed', 'approve', 'different')).toThrow('invalid-approval');
      await expect(recoverFixture(j, id, remote.endpoint, undefined, { account: 'other' })).rejects.toThrow('execution-diverged');
      await expect(recoverFixture(j, id, remote.endpoint, undefined, { contract: { ...manifest.effect!, version: 2 } })).rejects.toThrow('execution-diverged');
      expect(() => j.admit(newRun('bad', { contract: { ...manifest.effect!, tool: 'shell' } }))).toThrow('uncertified-adapter');
      j.update(id, 'fixture', null, 'fixture-change', run => { run.operations.model!.requestDigest = digest('changed-input'); });
      await expect(recoverFixture(j, id, remote.endpoint)).rejects.toThrow('execution-diverged');
      expect((await remote.stats()).calls.some(row => row.id === id + ':effect')).toBe(false);
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('first and duplicate approval cannot resume a paused run, even with a fresh command ID', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    try {
      for (const first of [true, false]) {
        const id = 'paused-approval-' + first;
        j.admit(newRun(id)); await runWorker(root, key, id, remote.endpoint);
        if (!first) approve(j, id);
        j.command(id, 'fixture', 'pause', 'pause');
        j.command(id, 'fixture', 'new-approval', 'approve', j.read(id).approval!.digest);
        expect(j.read(id).state).toBe('paused');
        expect(j.read(id).approval!.decision).toBe('approve');
        await runWorker(root, key, id, remote.endpoint);
        expect((await remote.stats()).calls.some(row => row.id === id + ':read:0')).toBe(false);
      }
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('paid attempt reservations and deadlines survive restart; unavailable run does not block another', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    try {
      j.admit(newRun('limited', { budget: 1 }));
      await runWorker(root, key, 'limited', remote.endpoint); approve(j, 'limited');
      for (let i = 0; i < 3; i++) {
        const result = await worker(root, key, 'recover', 'limited', remote.endpoint).done;
        expect(result.stderr).toContain('budget-exceeded');
      }
      expect(j.read('limited').operations.model!.reserved).toBe(1);
      expect(j.read('limited').operations.effect!.attempts).toBe(0);
      j.admit(newRun('expired', { deadline: 1 }));
      expect((await worker(root, key, 'recover', 'expired', remote.endpoint).done).stderr).toContain('deadline-exceeded');
      j.admit(newRun('offline'));
      expect((await worker(root, key, 'recover', 'offline', 'http://127.0.0.1:1').done).code).toBe(1);
      j.admit(newRun('independent'));
      await runWorker(root, key, 'independent', remote.endpoint); approve(j, 'independent');
      await runWorker(root, key, 'independent', remote.endpoint);
      expect(j.read('independent').state).toBe('succeeded');
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
