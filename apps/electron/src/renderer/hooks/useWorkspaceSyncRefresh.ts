import { useEffect, useRef } from 'react'
import type { WorkspaceSyncArea } from '@craft-agent/shared/workspaces'

/** Re-read canonical workspace data when files arrive from a shared-folder provider. */
export function useWorkspaceSyncRefresh(
  workspaceId: string | null | undefined,
  areas: readonly WorkspaceSyncArea[],
  refresh: () => void | Promise<void>,
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const areaKey = [...areas].sort().join('|')

  useEffect(() => {
    if (!workspaceId || typeof window.electronAPI.onWorkspaceSyncChanged !== 'function') return
    const accepted = new Set<WorkspaceSyncArea>(areaKey.split('|').filter(Boolean) as WorkspaceSyncArea[])
    let running = false
    let queued = false
    let disposed = false
    const drain = async () => {
      if (running) {
        queued = true
        return
      }
      running = true
      try {
        do {
          queued = false
          await refreshRef.current()
          // An existing request may have read pre-sync state. Trail it once after it settles.
          if (!disposed) await refreshRef.current()
        } while (queued && !disposed)
      } catch (error) {
        console.error('[workspace-sync] Failed to refresh shared workspace data:', error)
      } finally {
        running = false
      }
    }
    const cleanup = window.electronAPI.onWorkspaceSyncChanged((change) => {
      if (change.workspaceId !== workspaceId || !change.areas.some((area) => accepted.has(area))) return
      void drain()
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [areaKey, workspaceId])
}
