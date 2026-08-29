import type { SharedEntityMeta } from '../records/types.ts';

export interface AgendaTaskComment {
  id: string;
  body: string;
  authorMachineId: string;
  authorName: string;
  createdAt: string;
}

export interface AgendaTaskThread extends SharedEntityMeta, Record<string, unknown> {
  taskId: string;
  comments: AgendaTaskComment[];
}

export interface AddAgendaTaskCommentInput {
  commentId: string;
  body: string;
}
