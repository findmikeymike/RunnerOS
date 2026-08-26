import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifiedCopyFileSync } from '../verified-copy.ts';

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('verified file copy', () => {
  it('copies a stable regular file into an exclusive destination', () => {
    const sourceRoot = makeDir('verified-copy-source-');
    const destinationRoot = makeDir('verified-copy-destination-');
    const source = join(sourceRoot, 'nested', 'source.txt');
    const destination = join(destinationRoot, 'nested', 'destination.txt');
    mkdirSync(join(sourceRoot, 'nested'));
    writeFileSync(source, 'stable data', 'utf-8');

    verifiedCopyFileSync(source, destination, { sourceRootPath: sourceRoot, destinationRootPath: destinationRoot });

    expect(readFileSync(destination, 'utf-8')).toBe('stable data');
  });

  it('refuses a source reached through a symbolic-link parent', () => {
    const sourceRoot = makeDir('verified-copy-source-');
    const outside = makeDir('verified-copy-outside-');
    const destinationRoot = makeDir('verified-copy-destination-');
    writeFileSync(join(outside, 'private.txt'), 'private', 'utf-8');
    symlinkSync(outside, join(sourceRoot, 'linked'), 'dir');

    expect(() => verifiedCopyFileSync(
      join(sourceRoot, 'linked', 'private.txt'),
      join(destinationRoot, 'copy.txt'),
      { sourceRootPath: sourceRoot, destinationRootPath: destinationRoot },
    )).toThrow('symbolic links');
  });

  it('never overwrites an existing destination', () => {
    const sourceRoot = makeDir('verified-copy-source-');
    const destinationRoot = makeDir('verified-copy-destination-');
    const source = join(sourceRoot, 'source.txt');
    const destination = join(destinationRoot, 'destination.txt');
    writeFileSync(source, 'new data', 'utf-8');
    writeFileSync(destination, 'existing data', 'utf-8');

    expect(() => verifiedCopyFileSync(source, destination, {
      sourceRootPath: sourceRoot,
      destinationRootPath: destinationRoot,
    })).toThrow();
    expect(readFileSync(destination, 'utf-8')).toBe('existing data');
  });
});
