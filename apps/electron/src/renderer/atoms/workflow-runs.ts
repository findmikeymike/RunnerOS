import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { WorkflowRunDTO } from '../../shared/types'

export interface WorkflowRunsState {
  runs: WorkflowRunDTO[]
  loading: boolean
  hasLoaded: boolean
  listRevision: number
  error: string | null
}

export const initialWorkflowRunsState: WorkflowRunsState = {
  runs: [],
  loading: true,
  hasLoaded: false,
  listRevision: 0,
  error: null,
}

export const workflowRunsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<WorkflowRunsState>(initialWorkflowRunsState),
  (a, b) => a === b,
)
