import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = await mkdtemp(join(tmpdir(), 'artist-os-pi-oauth-'));
const outfile = join(scratch, 'bundled-oauth-entry.js');

try {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'fixtures', 'bundled-oauth-entry.ts')],
    outdir: scratch,
    target: 'bun',
    format: 'esm',
  });
  if (!result.success) {
    throw new Error(result.logs.map(log => log.message).join('\n'));
  }

  const child = Bun.spawn(['bun', outfile], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Bundled OAuth initialization failed. stdout: ${stdout}\nstderr: ${stderr}`);
  }
  if (!stdout.includes('Bundled OAuth auth derived')) {
    throw new Error(`Bundled OAuth smoke returned unexpected output: ${stdout}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log('Bundled OAuth smoke passed');
