import { useCallback, useEffect, useRef, useState } from 'react'
import type { VisualBoardSnapshot } from '@craft-agent/shared/visual-board'
import type { OutputManifestDTO } from './useOutputs'
import { getBoardDraft } from '@/components/visual-surfaces/board-draft'

interface VisualBoardResult {
  output: OutputManifestDTO
  board: VisualBoardSnapshot
}

interface UseVisualBoardResult {
  output: OutputManifestDTO | null
  board: VisualBoardSnapshot | null
  loading: boolean
  error: string | null
  available: boolean
  refresh: () => Promise<void>
  saveBoard: (snapshot: VisualBoardSnapshot) => Promise<VisualBoardResult>
}

type VisualBoardElectronAPI = typeof window.electronAPI & {
  getVisualBoard?: (workspaceId: string, sessionId: string) => Promise<VisualBoardResult>
  saveVisualBoard?: (
    workspaceId: string,
    sessionId: string,
    snapshot: VisualBoardSnapshot,
  ) => Promise<VisualBoardResult>
}

export function useVisualBoard(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): UseVisualBoardResult {
  const electronAPI = window.electronAPI as VisualBoardElectronAPI
  const available = typeof electronAPI.getVisualBoard === 'function'
    && typeof electronAPI.saveVisualBoard === 'function'
  const [output, setOutput] = useState<OutputManifestDTO | null>(null)
  const [board, setBoard] = useState<VisualBoardSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scopeAbortRef = useRef(new AbortController())
  const readAbortRef = useRef<AbortController | null>(null)
  const scope = JSON.stringify([workspaceId, sessionId])
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    const controller = new AbortController()
    scopeAbortRef.current = controller
    setOutput(null)
    setBoard(null)
    setError(null)
    setLoading(false)
    return () => {
      controller.abort()
      readAbortRef.current?.abort()
    }
  }, [scope])

  const refresh = useCallback(async () => {
    readAbortRef.current?.abort()
    const request = new AbortController()
    readAbortRef.current = request
    const signal = scopeAbortRef.current.signal
    const isCurrent = () => !signal.aborted && !request.signal.aborted && scopeRef.current === scope
    if (!workspaceId || !sessionId || !available || typeof electronAPI.getVisualBoard !== 'function') {
      setOutput(null)
      setBoard(null)
      setError(workspaceId && sessionId ? 'Visual board API is unavailable.' : null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // A panel may return while its previous instance is still saving.
      await getBoardDraft(workspaceId, sessionId).waitForSave()
      if (!isCurrent()) return
      const result = await electronAPI.getVisualBoard(workspaceId, sessionId)
      if (!isCurrent()) return
      setOutput(result.output)
      setBoard(result.board)
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [available, electronAPI, sessionId, workspaceId, scope])

  useEffect(() => {
    refresh()
  }, [refresh])

  const saveBoard = useCallback(async (snapshot: VisualBoardSnapshot) => {
    if (!workspaceId || !sessionId || typeof electronAPI.saveVisualBoard !== 'function') {
      throw new Error('Visual board API is unavailable.')
    }
    // A read started before this save must never replace the saved board later.
    if (scopeRef.current === scope && !scopeAbortRef.current.signal.aborted) {
      readAbortRef.current?.abort()
      setLoading(false)
    }
    const signal = scopeAbortRef.current.signal
    const result = await electronAPI.saveVisualBoard(workspaceId, sessionId, snapshot)
    if (!signal.aborted && scopeRef.current === scope) setOutput(result.output)
    return result
  }, [electronAPI, sessionId, workspaceId, scope])

  return {
    output,
    board,
    loading,
    error,
    available,
    refresh,
    saveBoard,
  }
}
