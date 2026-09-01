import type { OutputManifest } from '@craft-agent/shared/outputs'
import type { WorkflowRunSnapshot } from '@craft-agent/shared/workflows'

export function findExactWorkflowStepOutput(
  outputs: OutputManifest[],
  run: WorkflowRunSnapshot,
  stepId: string,
  title: string,
): OutputManifest | undefined {
  const step = run.steps.find((candidate) => candidate.id === stepId)
  if (step?.state !== 'succeeded' || !step.sessionId) return undefined
  return outputs.find((output) => (
    output.kind === 'report'
    && output.origin.source === 'workflow'
    && output.origin.workflowSlug === run.workflowSlug
    && output.origin.stepId === stepId
    && output.origin.sessionId === step.sessionId
    && output.title.trim() === title
  ))
}
