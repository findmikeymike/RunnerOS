import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
const [root, id, mode, marker] = process.argv.slice(2) as [string, string, string, string];
const path = join(root, 'context', '.locks', 'outputs', `${id}.lock`);
const originalLink = fs.linkSync, originalRm = fs.rmSync;
function halt(): never {
  fs.writeFileSync(marker, 'ready');
  while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
spyOn(fs, 'linkSync').mockImplementation((source, destination) => {
  if (String(destination) === path && mode === 'before-link') halt();
  originalLink(source, destination);
  if (String(destination) === path && mode === 'after-link') halt();
});
spyOn(fs, 'rmSync').mockImplementation((target, options) => {
  if (String(target) === path && mode === 'reclaimer') halt();
  originalRm(target, options);
});
if (mode === 'legacy-ownerless') { fs.mkdirSync(path); halt(); }
const { withOutputBundleLock } = await import('./storage');
withOutputBundleLock(root, id, () => {
  if (mode === 'hold') halt();
  const sentinel = join(root, 'critical-section');
  fs.mkdirSync(sentinel);
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 35);
    fs.appendFileSync(join(root, 'completed'), 'done\n');
  } finally { originalRm(sentinel, { recursive: true }); }
});
fs.writeFileSync(marker, 'done');
