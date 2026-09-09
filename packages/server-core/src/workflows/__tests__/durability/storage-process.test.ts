import { describe, test, expect } from 'bun:test';
import { copyFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureJournal, canonical, newRun, openDatabase } from './fixture-journal.ts';
import { fixtureRoot, fixtureKey, killAt, worker } from './process-support.ts';

describe('P-01 disposable journal: actual subprocess boundaries', () => {
  test('admission rolls back a partial open transaction and persists once after SIGKILL (25 each)', async () => {
    const root = fixtureRoot(), key = fixtureKey();
    try {
      for (let i = 0; i < 25; i++) {
        const before = 'before-' + i, after = 'after-' + i;
        await killAt(root, key, 'admit-inside', before, '', 'inside-admit');
        await killAt(root, key, 'admit', after, '', 'after-admit');
        const j = new FixtureJournal(root, key);
        try {
          expect(() => j.read(before)).toThrow('run-not-found');
          expect(j.db.prepare('SELECT count(*) n FROM events WHERE run_id=?').get(before).n).toBe(0);
          expect(j.db.prepare('SELECT count(*) n FROM outbox WHERE run_id=?').get(before).n).toBe(0);
          expect(j.read(after).id).toBe(after);
          expect(j.db.prepare('SELECT count(*) n FROM outbox WHERE run_id=?').get(after).n).toBe(1);
        } finally { j.close(); }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  test('two live claimants have one winner; killed owner can be reclaimed with a new epoch', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    const id = 'claim'; j.admit(newRun(id));
    const one = worker(root, key, 'claim', id, '', 'claimed');
    try {
      await one.line(line => line.includes('"barrier":"claimed"'));
      const two = await worker(root, key, 'claim', id).done;
      expect(two.code).toBe(1); expect(two.stderr).toContain('owner-active');
      const oldEpoch = j.row(id, 'fixture').epoch;
      one.child.kill('SIGKILL'); await one.done;
      const epoch = j.claim(id);
      expect(epoch).toBe(oldEpoch + 1);
      expect(() => j.update(id, 'fixture', oldEpoch, 'stale', run => { run.state = 'succeeded'; })).toThrow('stale-owner');
      expect(j.read(id).state).toBe('running');
      j.release(id, epoch);
    } finally { one.child.kill('SIGKILL'); await one.done; j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('busy lock times out, actual SQLite full failure rolls back without losing previous run', async () => {
    const root = fixtureRoot(), key = fixtureKey(), j = new FixtureJournal(root, key);
    j.admit(newRun('kept'));
    const lock = worker(root, key, 'lock', 'kept', '', 'locked');
    try {
      await lock.line(line => line.includes('"barrier":"locked"'));
      const start = Date.now();
      expect(() => j.admit(newRun('locked-out'))).toThrow();
      expect(Date.now() - start).toBeLessThan(1500);
      lock.child.kill('SIGKILL'); await lock.done;
      const pages = j.db.prepare('PRAGMA page_count').get().page_count;
      j.db.exec('PRAGMA max_page_count=' + pages);
      expect(() => j.admit(newRun('too-large', { account: 'x'.repeat(1_000_000) }))).toThrow(/full/i);
      expect(j.read('kept').id).toBe('kept');
      expect(() => j.read('too-large')).toThrow('run-not-found');
    } finally { lock.child.kill('SIGKILL'); await lock.done; j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('encrypted WAL/database/backup contain no synthetic private payload; key loss fails closed', () => {
    const root = fixtureRoot(), key = fixtureKey();
    const j = new FixtureJournal(root, key);
    try {
      j.admit(newRun('privacy', { account: 'SYNTHETIC_PRIVATE_MARKER_83' }));
      j.backup(join(root, 'backup.sqlite'));
      for (const file of readdirSync(root).filter(name => name !== 'fixture-only')) {
        expect(readFileSync(join(root, file)).includes(Buffer.from('SYNTHETIC_PRIVATE_MARKER_83'))).toBe(false);
        expect(statSync(join(root, file)).mode & 0o777).toBe(0o600);
      }
      const wrong = new FixtureJournal(root, fixtureKey());
      try { expect(() => wrong.claim('privacy')).toThrow(); } finally { wrong.close(); }
      expect(j.read('privacy').account).toBe('SYNTHETIC_PRIVATE_MARKER_83');
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test('coherent backup restores disabled; future schema and unsafe modes refuse writes', () => {
    const root = fixtureRoot(), restored = fixtureRoot(), key = fixtureKey();
    const j = new FixtureJournal(root, key);
    try {
      j.admit(newRun('backup')); j.backup(join(root, 'backup.sqlite'));
      copyFileSync(join(root, 'backup.sqlite'), join(restored, 'journal.sqlite'));
      const r = new FixtureJournal(restored, key);
      try { expect(r.read('backup').id).toBe('backup'); expect(() => r.claim('backup')).toThrow('restore-dispatch-disabled'); } finally { r.close(); }
      const reopened = new FixtureJournal(restored, key);
      try { expect(() => reopened.claim('backup')).toThrow('restore-dispatch-disabled'); } finally { reopened.close(); }
      j.db.exec('PRAGMA synchronous=OFF');
      expect(() => j.admit(newRun('unsafe'))).toThrow('unsafe-storage-mode');
      j.db.exec('PRAGMA user_version=99');
      expect(() => new FixtureJournal(root, key)).toThrow('unsupported-schema');
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); rmSync(restored, { recursive: true, force: true }); }
  });

  test('cross-workspace commands fail; canonical order is stable and unsupported values fail', () => {
    const root = fixtureRoot(), j = new FixtureJournal(root, fixtureKey());
    try {
      j.admit(newRun('scope'));
      expect(() => j.command('scope', 'other-workspace', 'cancel', 'cancel')).toThrow('run-not-found');
      expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
      for (const value of [undefined, NaN, Infinity, new Date(), [undefined], new Array(2)]) expect(() => canonical(value)).toThrow();
    } finally { j.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
