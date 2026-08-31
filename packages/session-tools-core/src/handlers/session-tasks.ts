import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export type UpdateTasksOperation = 'init' | 'start' | 'done' | 'append' | 'drop' | 'reopen' | 'view';
export type SessionTaskRejectionCode =
  | 'duplicate-content'
  | 'empty-content'
  | 'multiple-in-progress'
  | 'unknown-task-id'
  | 'terminal-item'
  | 'list-cap-exceeded'
  | 'stale-revision'
  | 'delegation-required'
  | 'invalid-operation'
  | 'task-update-failed';

export interface UpdateTasksToolInput {
  op: UpdateTasksOperation;
  items?: string[];
  taskId?: string;
  content?: string;
}

const PUBLIC_REJECTION_CODES: Record<string, SessionTaskRejectionCode> = {
  'duplicate-content': 'duplicate-content',
  'empty-content': 'empty-content',
  'multiple-in-progress': 'multiple-in-progress',
  'task-not-found': 'unknown-task-id',
  'terminal-task': 'terminal-item',
  'too-many-items': 'list-cap-exceeded',
  'stale-revision': 'stale-revision',
  'missing-delegation': 'delegation-required',
  'invalid-list': 'invalid-operation',
  'invalid-task': 'invalid-operation',
  'invalid-transition': 'invalid-operation',
};

export async function handleUpdateTasks(
  ctx: SessionToolContext,
  input: UpdateTasksToolInput,
): Promise<ToolResult> {
  if (!ctx.updateSessionTasks) return errorResponse('update_tasks is not available in this context.');
  try {
    const result = await ctx.updateSessionTasks(input);
    return successResponse(JSON.stringify(result ?? null, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session tasks.';
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    const code = PUBLIC_REJECTION_CODES[rawCode] ?? 'task-update-failed';
    return errorResponse(JSON.stringify({ code, message }));
  }
}
