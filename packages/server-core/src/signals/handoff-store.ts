import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { signalEntryReferenceSchema, type SignalEntryReference } from '@craft-agent/shared/shared-intel';

const FILE_NAME = 'signal-handoff.json';
const MAX_BYTES = 4096;

export function signalHandoffKey(reference: SignalEntryReference): string {
  return JSON.stringify([reference.hqWorkspaceId, reference.outputId, reference.contentHash, reference.entryId]);
}

export function hasSignalHandoff(sessionDirectory: string): boolean {
  try { lstatSync(join(sessionDirectory, FILE_NAME)); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('Cannot inspect the Signals draft reference.');
  }
}

function parseReference(value: unknown): SignalEntryReference {
  const result = signalEntryReferenceSchema.safeParse(value);
  if (!result.success) throw new Error('Invalid Signals draft reference.');
  return result.data;
}

export interface SignalHandoffState { reference: SignalEntryReference; acceptedMessageId?: string }

export function readSignalHandoffState(sessionDirectory: string): SignalHandoffState | null {
  let fd: number;
  try {
    fd = openSync(join(sessionDirectory, FILE_NAME), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Cannot read the Signals draft reference. Review or discard the research handoff before sending.');
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid reference file.');
    const data = JSON.parse(readFileSync(fd, 'utf8'));
    if (data?.version !== 1) throw new Error('Invalid reference version.');
    if (data.acceptedMessageId !== undefined && (typeof data.acceptedMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.acceptedMessageId))) throw new Error('Invalid acceptance receipt.');
    return { reference: parseReference(data.reference), ...(data.acceptedMessageId ? { acceptedMessageId: data.acceptedMessageId } : {}) };
  } catch {
    throw new Error('The Signals draft reference is damaged. Review or discard the research handoff before sending.');
  } finally {
    closeSync(fd);
  }
}

export function readSignalHandoff(sessionDirectory: string): SignalEntryReference | null {
  return readSignalHandoffState(sessionDirectory)?.reference ?? null;
}

export function writeSignalHandoff(sessionDirectory: string, reference: SignalEntryReference): void {
  writeState(sessionDirectory, { reference });
}

export function acceptSignalHandoff(sessionDirectory: string, reference: SignalEntryReference, messageId: string): void {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(messageId)) throw new Error('Invalid Signals acceptance receipt.');
  const current = readSignalHandoffState(sessionDirectory);
  if (!current || signalHandoffKey(current.reference) !== signalHandoffKey(reference)) throw new Error('The research draft binding changed before Send was accepted.');
  writeState(sessionDirectory, { reference, acceptedMessageId: messageId });
}

function writeState(sessionDirectory: string, { reference, acceptedMessageId }: SignalHandoffState): void {
  const canonical = parseReference(reference);
  const temp = join(sessionDirectory, `.${FILE_NAME}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, reference: canonical, ...(acceptedMessageId ? { acceptedMessageId } : {}) }), { mode: 0o600, flag: 'wx' });
    renameSync(temp, join(sessionDirectory, FILE_NAME));
  } finally {
    try { unlinkSync(temp); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function clearSignalHandoff(sessionDirectory: string): void {
  try { unlinkSync(join(sessionDirectory, FILE_NAME)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not discard the Signals draft reference.');
  }
}
