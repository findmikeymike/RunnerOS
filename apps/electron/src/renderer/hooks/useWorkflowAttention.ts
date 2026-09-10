import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import type { WorkflowAttentionDTO } from '../../shared/types'
import { createWorkflowRefreshLifecycle } from '../lib/workflow-request-lifecycle'

/** Refresh on saved progress and fence list replies that predate a decision/push. */
export function useWorkflowAttention(workspaceId: string, runId: string | undefined, revision: string | number) {
  const key = JSON.stringify([workspaceId, runId])
  const [state, setState] = useState<{ key: string; items: WorkflowAttentionDTO[] }>({ key, items: [] })
  const owner = useRef<{ key: string; requests: ReturnType<typeof createWorkflowRefreshLifecycle<WorkflowAttentionDTO[]>> }>()
  const replace = useCallback((items: SetStateAction<WorkflowAttentionDTO[]>) => {
    if (owner.current?.key !== key) return
    owner.current.requests.invalidate()
    setState(current => ({ key, items: typeof items === 'function' ? items(current.key === key ? current.items : []) : items }))
  }, [key])
  useEffect(() => {
    const requests = createWorkflowRefreshLifecycle(() => window.electronAPI.listWorkflowAttention(workspaceId, runId),
      items => setState({ key, items }), () => setState({ key, items: [] }))
    owner.current = { key, requests }
    const unsubscribe = window.electronAPI.onWorkflowAttentionUpdated((changedWorkspaceId, changed) => {
      if (changedWorkspaceId !== workspaceId || runId !== undefined && changed.workflowRunId !== runId) return
      requests.invalidate()
      setState(current => ({ key, items: changed.status === 'pending'
        ? [...(current.key === key ? current.items : []).filter(item => item.id !== changed.id), changed]
        : (current.key === key ? current.items : []).filter(item => item.id !== changed.id) }))
    })
    return () => { requests.dispose(); unsubscribe(); if (owner.current?.requests === requests) owner.current = undefined }
  }, [workspaceId, runId, key])
  useEffect(() => { void owner.current?.requests.refresh() }, [key, revision])
  return { attention: state.key === key ? state.items : [], setAttention: replace }
}
