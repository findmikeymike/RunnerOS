import { digest } from '../../../shared/src/durable-execution/index.ts';

/** Host-owned identity of one persisted scheduled work attempt. */
export interface DurableWorkflowOccurrence {
  workOrderId: string;
  attemptId: string;
  workflowSlug: string;
  workflowDigest: string;
}

export function durableWorkflowOccurrenceIdentity(workspaceId: string, occurrence: DurableWorkflowOccurrence) {
  if (!workspaceId.trim() || !occurrence || ['workOrderId', 'attemptId', 'workflowSlug', 'workflowDigest'].some(key =>
    typeof occurrence[key as keyof DurableWorkflowOccurrence] !== 'string' || !occurrence[key as keyof DurableWorkflowOccurrence].trim())) {
    throw new Error('invalid-durable-workflow-occurrence');
  }
  // Definition changes must collide with the same attempt, then fail the command check.
  const hash = digest(['scheduled-work-v1', workspaceId, occurrence.workOrderId, occurrence.attemptId]);
  const runId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { runId, commandId: `scheduled-start:${digest([workspaceId, occurrence.workOrderId, occurrence.attemptId, occurrence.workflowSlug, occurrence.workflowDigest])}` };
}
