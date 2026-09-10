import { useEffect, useRef, useState } from 'react'
import type { WorkflowRunDTO } from '../../shared/types'
import { createWorkflowRefreshLifecycle } from '../lib/workflow-request-lifecycle'

/** A cached LIST cannot override a failed current authorization check. */
export function useWorkflowRunHydration(workspaceId: string, runId: string, listRevision: number, notFound: string) {
  const key = JSON.stringify([workspaceId, runId])
  const [state, setState] = useState<{ key: string; run: WorkflowRunDTO | null; error: string | null }>({ key, run: null, error: null })
  const owner = useRef<ReturnType<typeof createWorkflowRefreshLifecycle<WorkflowRunDTO | null>>>()
  useEffect(() => {
    const requests = createWorkflowRefreshLifecycle(() => window.electronAPI.getWorkflowRun(workspaceId, runId), run => {
      setState({ key, run, error: run ? null : notFound })
    }, error => setState({ key, run: null, error: error instanceof Error ? error.message : String(error) }))
    owner.current = requests
    return () => { requests.dispose(); if (owner.current === requests) owner.current = undefined }
  }, [key, workspaceId, runId, notFound])
  useEffect(() => { void owner.current?.refresh() }, [key, listRevision, notFound])
  return state.key === key ? state : { key, run: null, error: null }
}
