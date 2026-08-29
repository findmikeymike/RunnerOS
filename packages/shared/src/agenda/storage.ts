import {
  baselineForRecord,
  deleteSharedRecord,
  readSharedRecord,
  readSharedRecordBaseline,
  writeSharedRecord,
} from '../records/index.ts';
import type { AgendaTaskComment, AgendaTaskThread } from './types.ts';

const THREADS_COLLECTION = 'agenda/task-threads';
const MAX_COMMENT_LENGTH = 4_000;
const MAX_THREAD_COMMENTS = 500;

function cleanBody(body: string): string {
  const value = body.trim();
  if (!value) throw new Error('Comment cannot be empty.');
  if (value.length > MAX_COMMENT_LENGTH) throw new Error(`Comment must be ${MAX_COMMENT_LENGTH.toLocaleString()} characters or fewer.`);
  return value;
}

export function readAgendaTaskThread(workspaceRootPath: string, taskId: string): AgendaTaskThread | null {
  const thread = readSharedRecord<AgendaTaskThread>(workspaceRootPath, THREADS_COLLECTION, taskId);
  return thread?.deletedAt ? null : thread;
}

export function addAgendaTaskComment(
  workspaceRootPath: string,
  machineId: string,
  authorName: string,
  taskId: string,
  input: Pick<AgendaTaskComment, 'id' | 'body'>,
): AgendaTaskThread {
  const comment: AgendaTaskComment = {
    id: input.id,
    body: cleanBody(input.body),
    authorMachineId: machineId,
    authorName: authorName.trim() || 'Team member',
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const baseline = readSharedRecordBaseline<AgendaTaskThread>(workspaceRootPath, THREADS_COLLECTION, taskId);
    const current = baseline?.entity;
    if (current?.comments.some((item) => item.id === comment.id)) return current;
    const comments = [...(current?.comments ?? []), comment].slice(-MAX_THREAD_COMMENTS);
    const result = writeSharedRecord(
      workspaceRootPath,
      THREADS_COLLECTION,
      taskId,
      { taskId, comments },
      { machineId, baseline: baseline ?? undefined },
    );
    if (result.status === 'written') return result.entity as AgendaTaskThread;
  }

  throw new Error('The discussion changed on another machine. Refresh and try again.');
}

export function deleteAgendaTaskThread(workspaceRootPath: string, machineId: string, taskId: string): void {
  const current = readAgendaTaskThread(workspaceRootPath, taskId);
  if (!current) return;
  const result = deleteSharedRecord(workspaceRootPath, THREADS_COLLECTION, taskId, {
    machineId,
    baseline: baselineForRecord(current),
  });
  if (result.status === 'conflict') throw new Error('The discussion changed on another machine. Refresh and try again.');
}
