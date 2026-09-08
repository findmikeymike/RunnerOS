import { describe, expect, test } from 'bun:test'
import { finishTaskModeSelection, syncTaskModeSelection, type TaskModeSelectionState } from './task-mode-selection-state'

describe('session-scoped task mode acknowledgement', () => {
  test('switching sessions immediately removes the previous acknowledgement', () => {
    const selectedA = { ...syncTaskModeSelection(null, 'a'), confirmedModeId: 'visual-world' }
    const firstRenderB = syncTaskModeSelection(selectedA, 'b')
    expect(firstRenderB.confirmedModeId).toBeUndefined()
    expect(firstRenderB.request).toBeNull()
  })

  test('a delayed successful response cannot select a mode or clear a pending request in the new session', async () => {
    const requestA = { modeId: 'visual-world' }
    let state: TaskModeSelectionState = { ...syncTaskModeSelection(null, 'a'), request: requestA }
    let resolve!: () => void
    const response = new Promise<void>((done) => { resolve = done }).then(() => {
      state = finishTaskModeSelection(state, 'a', requestA, true)
    })
    const requestB = { modeId: 'brand-audit' }
    state = { ...syncTaskModeSelection(state, 'b'), request: requestB }
    resolve()
    await response
    expect(state.sessionId).toBe('b')
    expect(state.confirmedModeId).toBeUndefined()
    expect(state.request).toBe(requestB)
    state = finishTaskModeSelection(state, 'b', requestB, true)
    expect(state.confirmedModeId).toBe('brand-audit')
    expect(state.request).toBeNull()
  })

  test('switching back does not let the old request overwrite a newer choice', () => {
    const oldRequest = { modeId: 'visual-world' }
    let state: TaskModeSelectionState = { ...syncTaskModeSelection(null, 'a'), request: oldRequest }
    state = syncTaskModeSelection(state, 'b')
    state = syncTaskModeSelection(state, 'a')
    const newRequest = { modeId: 'brand-audit' }
    state = { ...state, request: newRequest }
    expect(finishTaskModeSelection(state, 'a', oldRequest, true)).toBe(state)
    expect(finishTaskModeSelection(state, 'a', oldRequest, false)).toBe(state)
  })

  test('receipt updates preserve the in-flight request; a failure preserves the recorded choice', () => {
    const request = { modeId: 'visual-world' }
    let state: TaskModeSelectionState = { ...syncTaskModeSelection(null, 'a', 'brand-audit'), request }
    state = syncTaskModeSelection(state, 'a', 'visual-world')
    expect(state.request).toBe(request)
    state = finishTaskModeSelection(state, 'a', request, false)
    expect(state.confirmedModeId).toBe('visual-world')
    expect(state.request).toBeNull()
  })
})
