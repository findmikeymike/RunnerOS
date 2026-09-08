/** Local RPC acknowledgements belong to the session and request that produced them. */
export interface TaskModeSelectionState {
  sessionId: string
  receiptModeId?: string
  confirmedModeId?: string
  request: { modeId: string } | null
}

export function syncTaskModeSelection(
  state: TaskModeSelectionState | null,
  sessionId: string,
  receiptModeId?: string,
): TaskModeSelectionState {
  if (!state || state.sessionId !== sessionId) {
    return { sessionId, receiptModeId, confirmedModeId: receiptModeId, request: null }
  }
  if (state.receiptModeId !== receiptModeId) {
    return { ...state, receiptModeId, confirmedModeId: receiptModeId }
  }
  return state
}

export function finishTaskModeSelection(
  state: TaskModeSelectionState,
  sessionId: string,
  request: NonNullable<TaskModeSelectionState['request']>,
  succeeded: boolean,
): TaskModeSelectionState {
  if (state.sessionId !== sessionId || state.request !== request) return state
  return {
    ...state,
    confirmedModeId: succeeded ? request.modeId : state.confirmedModeId,
    request: null,
  }
}
