import { createHash } from 'node:crypto';
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

export function computeApprovalDigest(action, browserPlan) {
  const canonical = JSON.stringify(canonicalize({ action, browserPlan }));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
      const item = value[key];
      return item === undefined ? [] : [[key, canonicalize(item)]];
    }));
  }
  return value;
}

/** Bind action previews to both their fields and the bytes of every upload. */
export function bindDryRunApproval(result) {
  if (result?.status !== 'dry_run' || !result.action || !result.browserPlan) return result;
  const media = mediaFiles(result.action);
  const action = media.length
    ? { ...result.action, mediaApproval: media.map(fingerprintMedia) }
    : result.action;
  return { ...result, action, approvalDigest: computeApprovalDigest(action, result.browserPlan) };
}

/** Called before delegation or replay; paths alone do not authorize new bytes. */
export function verifyApprovedMedia(action) {
  const media = mediaFiles(action);
  if (!media.length && action.mediaApproval === undefined) return;
  if (!Array.isArray(action.mediaApproval) || action.mediaApproval.length !== media.length) {
    throw approvalError('Approved media fingerprints are missing. Generate a fresh dry-run.', 'MEDIA_APPROVAL_REQUIRED');
  }
  for (let index = 0; index < media.length; index++) {
    const expected = action.mediaApproval[index];
    const current = fingerprintMedia(media[index]);
    if (expected?.path !== current.path || expected.sha256 !== current.sha256 || expected.bytes !== current.bytes) {
      throw approvalError('Media changed after the dry-run. Review a fresh preview before executing.', 'MEDIA_APPROVAL_MISMATCH');
    }
  }
}

function mediaFiles(action) {
  const media = action?.payload?.media;
  if (media === undefined) return [];
  if (!Array.isArray(media) || media.some(file => typeof file !== 'string' || !file)) {
    throw approvalError('Action media must contain exact file paths.', 'INVALID_MEDIA_APPROVAL');
  }
  return media;
}

function fingerprintMedia(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error('Media is not a file');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (BigInt(bytes) !== before.size || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw approvalError('Media changed while preparing its approval. Generate a fresh preview.', 'MEDIA_APPROVAL_MISMATCH');
    }
    return { path, sha256: hash.digest('hex'), bytes };
  } catch (error) {
    if (error.code === 'MEDIA_APPROVAL_MISMATCH') throw error;
    throw approvalError('Could not read approved media. Restore the file or create a fresh preview.', 'MEDIA_APPROVAL_UNAVAILABLE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function approvalError(message, code) {
  return Object.assign(new Error(message), { code });
}
