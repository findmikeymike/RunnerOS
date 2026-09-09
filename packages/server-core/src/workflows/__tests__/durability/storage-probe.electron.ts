/** Bundled only into the disposable probe .app; never launches Artist OS or its profile. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { FixtureJournal, newRun } from './fixture-journal.ts';
const { app } = require('electron') as typeof import('electron');
const root = process.env.DURABILITY_FIXTURE_ROOT!;
app.setName('Artist OS Durability Fixture');
app.setPath('userData', join(root, 'electron-user-data'));
app.setPath('sessionData', join(root, 'electron-session-data'));
app.dock?.hide();
void app.whenReady().then(async () => {
  let journal: FixtureJournal | undefined;
  try {
    assert.equal(app.isPackaged, true, 'Must exercise a packaged Electron main process');
    assert.ok(process.versions.electron);
    assert.equal(process.versions.bun, undefined);
    journal = new FixtureJournal(root, Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex'));
    if (process.env.DURABILITY_FIXTURE_STAGE === 'write') {
      journal.admit(newRun('electron'));
      const epoch = journal.claim('electron');
      journal.update('electron', 'fixture', epoch, 'sqlite-main-process', run => { run.account = 'SYNTHETIC_ELECTRON_PAYLOAD'; });
      console.log(JSON.stringify({ barrier: 'electron-committed' }));
      setTimeout(() => app.exit(91), 30_000); // Supervisor SIGKILLs the process before graceful cleanup.
      return;
    }
    assert.equal(journal.read('electron').account, 'SYNTHETIC_ELECTRON_PAYLOAD');
    const epoch = journal.claim('electron');
    assert.equal(epoch, 2);
    journal.release('electron', epoch);
    const contender = new FixtureJournal(root, Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex'));
    let contentionMs = 0;
    try {
      journal.db.exec('BEGIN IMMEDIATE');
      try {
        const started = performance.now();
        assert.throws(() => contender.admit(newRun('electron-contention')), /busy|locked/i);
        contentionMs = performance.now() - started;
        assert.ok(contentionMs < 1500, 'SQLite busy handler must return within a bounded interval');
      } finally { journal.db.exec('ROLLBACK'); }
      contender.admit(newRun('electron-contention'));
      assert.equal(contender.read('electron-contention').id, 'electron-contention');
    } finally { contender.close(); }
    journal.backup(join(root, 'electron-backup.sqlite'));
    console.log(JSON.stringify({ result: 'pass', packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node, sqlite: journal.db.prepare('SELECT sqlite_version() version').get().version, epoch, contentionMs, recoveredWrite: true, execPath: process.execPath, root }));
    journal.close();
    app.exit(0);
  } catch (error) { console.error(error); journal?.close(); app.exit(1); }
});
