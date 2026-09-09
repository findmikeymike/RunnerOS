import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../../../shared/src/durable-execution/index.ts';
import type { DurableOperationIntent, DurableOperationOutcome } from '../../../shared/src/durable-execution/operation-types.ts';
import { durableLocalArtifactCredential, type DurableEffectAdapter } from './durable-effect-runner.ts';

/** A host-owned, existing private directory. No model-selected paths or overwrite behavior. */
export function createDurableArtifactAdapter(root: string, assertAuthority: () => void): DurableEffectAdapter {
  const canonicalRoot = realpathSync(root);
  const identity = lstatSync(canonicalRoot);
  if (!identity.isDirectory()) throw new Error('durable-artifact-root-invalid');
  const authorize = () => {
    assertAuthority();
    const current = lstatSync(canonicalRoot);
    if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino || realpathSync(root) !== canonicalRoot) throw new Error('durable-artifact-root-changed');
  };
  const binding = (intent: Readonly<DurableOperationIntent>) => {
    const input = intent.input as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.content !== 'string' || Buffer.byteLength(input.content) > 1024 * 1024 || Buffer.from(input.content, 'utf8').toString('utf8') !== input.content) throw new Error('durable-artifact-input-invalid');
    const file = `${digest(intent.idempotencyKey)}.txt`;
    return { file, path: join(canonicalRoot, file), content: input.content, contentDigest: digest(input.content) };
  };
  const output = (item: ReturnType<typeof binding>) => ({ file: item.file, contentDigest: item.contentDigest });
  const reconcile = async (intent: Readonly<DurableOperationIntent>): Promise<DurableOperationOutcome> => {
    authorize();
    const item = binding(intent);
    let fd: number;
    try { fd = openSync(item.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'not-applied', reason: 'artifact-absent' } : { kind: 'unknown', reason: 'artifact-unreadable' };
    }
    try {
      if (readFileSync(fd, 'utf8') !== item.content) return { kind: 'failed', reason: 'artifact-content-conflict' };
      fsyncSync(fd);
      const dir = openSync(canonicalRoot, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
      return { kind: 'succeeded', output: output(item) };
    } finally { closeSync(fd); }
  };
  return {
    id: 'local-immutable-artifact', version: '1', credentialIdentity: durableLocalArtifactCredential(canonicalRoot, identity), effectClass: 'idempotent-write',
    outputSchema: { id: 'local-artifact-receipt', version: '1', validate(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 &&
        typeof value.file === 'string' && /^[a-f0-9]{64}\.txt$/.test(value.file) && typeof value.contentDigest === 'string' && /^[a-f0-9]{64}$/.test(value.contentDigest);
    } },
    authorize(intent) { authorize(); binding(intent); },
    async invoke(intent) {
      authorize(); const item = binding(intent);
      let fd: number;
      try { fd = openSync(item.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return reconcile(intent); throw error; }
      try { writeFileSync(fd, item.content, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
      const dir = openSync(canonicalRoot, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
      return { kind: 'succeeded', output: output(item) };
    },
    reconcile,
  };
}
