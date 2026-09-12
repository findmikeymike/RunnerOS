import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { assertOutputAssetPath } from './storage.ts';
import { isContainedPath } from './validation.ts';

/** Verify a selected local artifact without hashing its entire contents.
 * Contained symlinks are supported; links escaping the workspace are not. */
export function assertUsableOutputAsset(workspaceRootPath: string, outputId: string, assetPath: string): string {
  const requested = assertOutputAssetPath(workspaceRootPath, outputId, assetPath);
  let descriptor: number | undefined;
  try {
    const root = realpathSync(workspaceRootPath);
    const path = realpathSync(requested);
    if (!isContainedPath(root, path)) throw new Error('File resolves outside its workspace.');
    if (!statSync(path).isFile()) throw new Error('Expected a regular file.');
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(descriptor).isFile()) throw new Error('Expected a regular file.');
    // Opening alone may succeed for files whose contents cannot be read.
    // One byte proves readability while keeping this check cheap for large media.
    readSync(descriptor, Buffer.alloc(1), 0, 1, 0);
    return path;
  } catch (error) {
    throw new Error(`Output asset is unavailable: ${assetPath}. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
