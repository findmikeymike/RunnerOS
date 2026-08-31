import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useWorkflows } from '@/hooks/useWorkflows'
import { RunStateDot } from './WorkflowsListPage'
import type { WorkflowAttentionDTO } from '../../shared/types'

interface Props {
  workspaceId: string
}

export default function RecentRunsPage({ workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { runs, loading, error } = useWorkflowRuns(workspaceId)
  const { allWorkflows } = useWorkflows(workspaceId)
  const [attention, setAttention] = React.useState<WorkflowAttentionDTO[]>([])

  React.useEffect(() => {
    let mounted = true
    void window.electronAPI.listWorkflowAttention(workspaceId).then((items) => {
      if (mounted) setAttention(items)
    }).catch(() => {})
    const cleanup = window.electronAPI.onWorkflowAttentionUpdated((changedWorkspaceId, changed) => {
      if (changedWorkspaceId !== workspaceId) return
      setAttention((current) => changed.status === 'pending'
        ? [...current.filter((item) => item.id !== changed.id), changed]
        : current.filter((item) => item.id !== changed.id))
    })
    return () => { mounted = false; cleanup() }
  }, [workspaceId])

  const nameBySlug = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const wf of allWorkflows) map.set(wf.slug, wf.metadata.name)
    return map
  }, [allWorkflows])

  // Phase 1 has no pagination; cap at 100 newest to keep render predictable.
  const top = React.useMemo(() => runs.slice(0, 100), [runs])

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="runneros-page-wrap">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-white/42" />
              <h1 className="runneros-page-title">{t('sidebar.workflows.recentRuns')}</h1>
            </div>
            <p className="runneros-page-subtitle">{t('workflows.recentRuns.subtitle')}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-white/50">{t('common.loading')}</div>
        ) : error ? (
          <div className="rounded-[14px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
        ) : top.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-white/48">{t('workflows.recentRuns.empty')}</div>
        ) : (
          <div className="grid gap-2">
            {top.map((r) => {
              const startedMs = r.createdAt ? Date.parse(r.createdAt) : 0
              const completedMs = r.completedAt ? Date.parse(r.completedAt) : 0
              const durationMs = startedMs && completedMs ? Math.max(0, completedMs - startedMs) : 0
              const attentionCount = attention.filter((item) => item.workflowRunId === r.id).length
              return (
                <button
                  key={r.id}
                  type="button"
                  className="runneros-card runneros-card-hover flex items-center justify-between gap-3 px-3 py-2.5 text-left"
                  onClick={() => navigate(routes.view.workflowRun(r.id))}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {nameBySlug.get(r.workflowSlug) ?? r.workflowSlug}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-white/42">
                      {r.trigger.type} · {r.createdAt}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {attentionCount > 0 && <span className="rounded-full bg-orange-400/12 px-2 py-0.5 text-[10px] text-orange-200/80">Needs decision</span>}
                    <span className="font-mono text-[11px] text-white/42">{r.id.slice(0, 8)}</span>
                    <RunStateDot state={r.state} />
                    <span className="w-10 text-right text-[11px] text-white/42">
                      {durationMs ? `${Math.round(durationMs / 1000)}s` : '-'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
