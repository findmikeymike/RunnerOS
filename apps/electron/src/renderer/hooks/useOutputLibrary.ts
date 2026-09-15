import { useCallback, useEffect, useRef, useState } from 'react'
import { coerceSummary, type OutputSummaryDTO } from './useOutputs'
import { isVisibleLibraryOutput, outputLibraryKey, outputLibraryPlan, createOutputLibraryLoadGate, releaseKitOutputKeys, type OutputLibraryWorkspace } from '../lib/output-library'

export function useOutputLibrary({ workspaces, activeWorkspaceId, scopeWorkspaceId, remoteActive = false }: {
  workspaces: OutputLibraryWorkspace[]
  activeWorkspaceId: string | null
  scopeWorkspaceId?: string
  remoteActive?: boolean
}) {
  const targetKey = JSON.stringify(outputLibraryPlan(workspaces, activeWorkspaceId, scopeWorkspaceId, remoteActive))
  const [state, setState] = useState<{ key: string; outputs: OutputSummaryDTO[]; loading: boolean; error: string | null; finalOutputKeys: Set<string>; unavailableWorkspaceIds: string[] }>({ key: '', outputs: [], loading: true, error: null, finalOutputKeys: new Set(), unavailableWorkspaceIds: [] })
  const gate = useRef(createOutputLibraryLoadGate())
  const refresh = useCallback(async () => {
    const plan = JSON.parse(targetKey) as ReturnType<typeof outputLibraryPlan>
    const outputIds = new Set(plan.outputs.map((workspace) => workspace.id))
    const kitIds = new Set(plan.kits.map((workspace) => workspace.id))
    const targets = [...new Map([...plan.outputs, ...plan.kits].map((workspace) => [workspace.id, workspace])).values()]
    setState((previous) => ({ ...previous, key: targetKey, outputs: previous.key === targetKey ? previous.outputs : [], finalOutputKeys: previous.key === targetKey ? previous.finalOutputKeys : new Set(), loading: true, error: null, unavailableWorkspaceIds: [] }))
    await gate.current.run(() => Promise.all(targets.map(async (workspace) => {
      const [outputResult, kitResult] = await Promise.allSettled([
        outputIds.has(workspace.id) ? window.electronAPI.listOutputs(workspace.id) : Promise.resolve([]),
        kitIds.has(workspace.id) ? window.electronAPI.getReleaseKit(workspace.id) : Promise.resolve(null),
      ])
      const errors: string[] = []
      const outputs: OutputSummaryDTO[] = []
      if (outputResult.status === 'fulfilled') {
        for (const raw of outputResult.value) {
          const output = coerceSummary(raw)
          if (!output) continue
          if (output.workspaceId && output.workspaceId !== workspace.id) {
            errors.push('An Output had a mismatched owner and was omitted.')
            continue
          }
          if (isVisibleLibraryOutput(output)) outputs.push({ ...output, workspaceId: workspace.id })
        }
      } else errors.push('Outputs could not be loaded.')
      if (kitResult.status === 'rejected') errors.push('Final status could not be checked.')
      return { workspace, outputs, errors, finals: kitResult.status === 'fulfilled' && kitResult.value ? releaseKitOutputKeys(workspace.id, kitResult.value.items) : [] }
    })), (results) => {
    const outputs = results.flatMap((result) => result.outputs).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
    const finalOutputKeys = new Set(results.flatMap((result) => result.finals))
    for (const output of outputs) if (output.finals?.length) finalOutputKeys.add(outputLibraryKey(output.workspaceId!, output.id))
    setState({ key: targetKey, outputs, finalOutputKeys, loading: false,
      error: results.flatMap((result) => result.errors.map((message) => `${result.workspace.name}: ${message}`)).join(' ') || null,
      unavailableWorkspaceIds: results.filter((result) => result.errors.length).map((result) => result.workspace.id),
    })
    })
  }, [targetKey])

  useEffect(() => {
    const loadGate = gate.current
    const plan = JSON.parse(targetKey) as ReturnType<typeof outputLibraryPlan>
    const ids = new Set([...plan.outputs, ...plan.kits].map((workspace) => workspace.id))
    const update = (workspaceId: string) => { if (ids.has(workspaceId)) void refresh() }
    const offOutputs = window.electronAPI.onOutputsUpdated(update)
    const offFinals = window.electronAPI.onReleaseKitChanged(update)
    void refresh()
    return () => { loadGate.invalidate(); offOutputs(); offFinals() }
  }, [targetKey, refresh])

  const current = state.key === targetKey ? state : { outputs: [], loading: true, error: null, finalOutputKeys: new Set<string>(), unavailableWorkspaceIds: [] }
  return { outputs: current.outputs, loading: current.loading, error: current.error, finalOutputKeys: current.finalOutputKeys, unavailableWorkspaceIds: current.unavailableWorkspaceIds, refresh }
}
