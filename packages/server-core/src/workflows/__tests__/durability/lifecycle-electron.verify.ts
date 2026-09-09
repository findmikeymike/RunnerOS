/** Explicit disposable app probe: bun <this file>. Never opens production Artist OS. */
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fixtureRoot, startProcess } from './process-support.ts';
const repo = resolve(import.meta.dir, '../../../../../..');
const root = fixtureRoot();
try {
  const appPath = join(root, 'Artist OS Lifecycle Fixture.app');
  const runtime = join(repo, 'node_modules/electron/dist/Electron.app');
  if (!existsSync(runtime)) throw new Error('Installed canonical Electron runtime unavailable');
  cpSync(runtime, appPath, { recursive: true });
  const resources = join(appPath, 'Contents/Resources');
  rmSync(join(resources, 'default_app.asar'), { force: true });
  const appDir = join(resources, 'app'); mkdirSync(appDir);
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'artist-os-lifecycle-fixture', version: '0.0.0', main: 'probe.cjs' }));
  await build({ entryPoints: [join(import.meta.dir, 'lifecycle-electron.probe.ts')], outfile: join(appDir, 'probe.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'unused-provider-factory', setup(builder) { builder.onResolve({ filter: /agent\/backend\/factory\.ts$/ }, args => ({ path: args.path, external: true })); } }] });
  const executable = join(appPath, 'Contents/MacOS/Artist OS Lifecycle Fixture');
  renameSync(join(appPath, 'Contents/MacOS/Electron'), executable);
  for (const [field, value] of Object.entries({ CFBundleExecutable: 'Artist OS Lifecycle Fixture', CFBundleName: 'Artist OS Lifecycle Fixture', CFBundleIdentifier: 'local.artist-os.lifecycle-fixture' })) {
    const changed = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${field} ${value}`, join(appPath, 'Contents/Info.plist')]);
    if (changed.status !== 0) throw new Error(changed.stderr.toString());
  }
  const deadline = String(Date.now() + 120000);
  for (const stage of ['write', 'verify']) {
    const result = await startProcess([], { DURABILITY_FIXTURE_ROOT: root, DURABILITY_FIXTURE_STAGE: stage, DURABILITY_FIXTURE_DEADLINE: deadline, CRAFT_CONFIG_DIR: join(root, 'config'), ELECTRON_RUN_AS_NODE: '' }, executable, 45000).done;
    if (result.code !== 0) throw new Error(`Lifecycle probe failed (${result.code}/${result.signal}): ${result.stderr} ${result.stdout}`);
    console.log(result.stdout.trim());
  }
} finally { rmSync(root, { recursive: true, force: true }); }
