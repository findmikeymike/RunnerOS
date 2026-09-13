import * as React from 'react'
import type { ScheduledWorkRuntimeStatus } from '@craft-agent/shared/scheduled-work'
import { scheduledWorkHealthMessages } from './scheduled-work-health'

export function ScheduledWorkHealth({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [statuses, setStatuses] = React.useState<ScheduledWorkRuntimeStatus[]>([])
  const idsKey = workspaces.map((workspace) => workspace.id).sort().join('\u0000')
  React.useEffect(() => {
    let cancelled = false
    let fetching = false
    setStatuses([])
    const ids = idsKey ? idsKey.split('\u0000') : []
    const refresh = async () => {
      if (fetching) return
      fetching = true
      const results = await Promise.all(ids.map(async (workspaceId): Promise<ScheduledWorkRuntimeStatus> => {
        try {
          return await window.electronAPI.getScheduledWorkRuntimeStatus(workspaceId)
        } catch {
          return { workspaceId, checkedAt: new Date().toISOString(), state: 'unavailable' }
        }
      }))
      fetching = false
      if (!cancelled) setStatuses(results)
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [idsKey])
  const messages = scheduledWorkHealthMessages(statuses, workspaces)
  if (!messages.length) return null
  return <p className="mb-3 px-1 text-[10.5px] leading-4 text-white/36">{messages.join(' · ')}</p>
}
