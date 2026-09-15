import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createStore, Provider } from 'jotai'
import type { ContextDocDTO } from '../../shared/types'
import { shouldRefreshWorkspaceContext, useWorkspaceContext, type UseWorkspaceContextResult } from './useWorkspaceContext'

describe('useWorkspaceContext refresh policy', () => {
  test('refreshes when hot reload resets the atom to loading even if the workspace key was cached', () => {
    expect(shouldRefreshWorkspaceContext({ docs: [], loading: true, error: null }, true)).toBe(true)
  })

  test('does not refetch a settled cached workspace only because it has no documents', () => {
    expect(shouldRefreshWorkspaceContext({ docs: [], loading: false, error: null }, true)).toBe(false)
  })

  test('refreshes a workspace that has never loaded', () => {
    expect(shouldRefreshWorkspaceContext({ docs: [], loading: false, error: null }, false)).toBe(true)
  })
})

const originalWindow = globalThis.window
afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
  else globalThis.window = originalWindow
})
function probe(workspaceId: string) {
  const store = createStore()
  let result: UseWorkspaceContextResult
  function Probe() { result = useWorkspaceContext(workspaceId); return null }
  return () => {
    renderToString(createElement(Provider, { store }, createElement(Probe)))
    return result!
  }
}
const doc = (body: string) => ({ slug: 'artist-spotify-snapshot', metadata: { name: 'Spotify' }, body } as ContextDocDTO)

test('publication during an older fetch queues a fresh read and never applies the stale response', async () => {
  let resolveOld!: (docs: ContextDocDTO[]) => void
  let resolveFresh!: (docs: ContextDocDTO[]) => void
  const read = mock(() => new Promise<ContextDocDTO[]>(resolve => {
    if (!resolveOld) resolveOld = resolve
    else resolveFresh = resolve
  }))
  globalThis.window = { electronAPI: { listWorkspaceContextDocs: read } } as unknown as Window & typeof globalThis
  const render = probe('pulse-race')
  const initial = render().refresh()
  const changed = render().refresh(true)
  const changedAgain = render().refresh(true)
  resolveOld([doc('old')])
  await Promise.resolve()
  expect(read).toHaveBeenCalledTimes(2)
  expect(render().docs).toEqual([])
  resolveFresh([doc('fresh')])
  await Promise.all([initial, changed, changedAgain])
  expect(render().docs.map(entry => entry.body)).toEqual(['fresh'])
  expect(render().loading).toBe(false)
})

test('queued refresh stays with its workspace when another workspace loads', async () => {
  let resolveA!: (docs: ContextDocDTO[]) => void
  let aReads = 0
  const read = mock((workspaceId: string) => {
    if (workspaceId === 'pulse-A' && ++aReads === 1) return new Promise<ContextDocDTO[]>(resolve => { resolveA = resolve })
    return Promise.resolve([doc(workspaceId)])
  })
  globalThis.window = { electronAPI: { listWorkspaceContextDocs: read } } as unknown as Window & typeof globalThis
  const renderA = probe('pulse-A')
  const renderB = probe('pulse-B')
  const firstA = renderA().refresh()
  const changedA = renderA().refresh(true)
  await renderB().refresh()
  resolveA([doc('old A')])
  await Promise.all([firstA, changedA])
  expect(renderA().docs[0]?.body).toBe('pulse-A')
  expect(renderB().docs[0]?.body).toBe('pulse-B')
  expect(read.mock.calls.map(([workspaceId]) => workspaceId)).toEqual(['pulse-A', 'pulse-B', 'pulse-A'])
})
