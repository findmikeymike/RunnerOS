import { FixtureJournal, newRun } from './fixture-journal.ts';
import { recoverFixture } from './fixture-engine.ts';
import { writeSync } from 'node:fs';
const [root, action, id, endpoint, stopAt] = process.argv.slice(2);
const journal = new FixtureJournal(root!, Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex'));
const barrier = async (name: string) => {
  if (name !== stopAt) return;
  console.log(JSON.stringify({ barrier: name }));
  // Supervisor may SIGKILL or continue this exact owner after issuing a control command.
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => process.exit(90), 30_000);
    process.stdin.once('data', () => { clearTimeout(timer); resolve(); });
    process.stdin.resume();
  });
  process.stdin.pause();
};
try {
  if (action === 'recover') await recoverFixture(journal, id!, endpoint!, barrier);
  else if (action === 'admit') { await barrier('before-admit'); journal.admit(newRun(id!)); await barrier('after-admit'); }
  else if (action === 'admit-inside') journal.admit(newRun(id!), () => {
    writeSync(1, JSON.stringify({ barrier: 'inside-admit' }) + '\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
    throw new Error('supervisor-did-not-kill');
  });
  else if (action === 'claim') { const epoch = journal.claim(id!); console.log(JSON.stringify({ epoch })); await barrier('claimed'); }
  else if (action === 'read') console.log(JSON.stringify(journal.read(id!)));
  else if (action === 'lock') { journal.db.exec('BEGIN IMMEDIATE'); await barrier('locked'); journal.db.exec('ROLLBACK'); }
  else throw new Error('unknown-fixture-command');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
finally { journal.close(); }
