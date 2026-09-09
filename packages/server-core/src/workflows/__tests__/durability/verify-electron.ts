/** Explicit probe, outside normal test discovery. `bun <this file>`; no downloads or app restart. */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fixtureKey, fixtureRoot, startProcess } from './process-support.ts';

const repo = resolve(import.meta.dir, '../../../../../..');
const root = fixtureRoot();
const appPath = join(root, 'Durability Fixture.app');
const key = fixtureKey();
try {
  const runtime = join(repo, 'node_modules/electron/dist/Electron.app');
  if (!existsSync(runtime)) throw new Error('Canonical installed Electron runtime unavailable');
  // Copy only the installed Electron runtime. No production application resources/config are included.
  cpSync(runtime, appPath, { recursive: true });
  const resources = join(appPath, 'Contents/Resources');
  rmSync(join(resources, 'default_app.asar'), { force: true });
  const appDir = join(resources, 'app'); mkdirSync(appDir);
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'artist-os-durability-fixture', version: '0.0.0', main: 'probe.cjs' }));
  await build({ entryPoints: [join(import.meta.dir, 'storage-probe.electron.ts')], outfile: join(appDir, 'probe.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const executable = join(appPath, 'Contents/MacOS/Durability Fixture');
  renameSync(join(appPath, 'Contents/MacOS/Electron'), executable);
  for (const [field, value] of Object.entries({ CFBundleExecutable: 'Durability Fixture', CFBundleName: 'Durability Fixture', CFBundleIdentifier: 'local.artist-os.durability-fixture' })) {
    const changed = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${field} ${value}`, join(appPath, 'Contents/Info.plist')]);
    if (changed.status !== 0) throw new Error(changed.stderr.toString());
  }
  const env = { DURABILITY_FIXTURE_ROOT: root, DURABILITY_FIXTURE_KEY: key.toString('hex'), ELECTRON_RUN_AS_NODE: '' };
  const first = startProcess([], { ...env, DURABILITY_FIXTURE_STAGE: 'write' }, executable);
  try {
    await first.line(line => line.includes('"barrier":"electron-committed"'));
    first.child.kill('SIGKILL');
    const killed = await first.done;
    if (killed.signal !== 'SIGKILL') throw new Error('Expected real Electron SIGKILL');
  } finally { first.child.kill('SIGKILL'); await first.done; }
  const second = await startProcess([], { ...env, DURABILITY_FIXTURE_STAGE: 'verify' }, executable).done;
  if (second.code !== 0) throw new Error(second.stderr + second.stdout);
  console.log(second.stdout.trim());
} finally { rmSync(root, { recursive: true, force: true }); }
