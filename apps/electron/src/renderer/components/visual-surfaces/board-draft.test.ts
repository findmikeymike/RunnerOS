import { expect, test } from 'bun:test'
import { createEmptyVisualBoardSnapshot, type VisualBoardSnapshot } from '@craft-agent/shared/visual-board'
import { BoardDraft, getBoardDraft } from './board-draft'

function setup() {
  const draft = new BoardDraft()
  draft.hydrate(createEmptyVisualBoardSnapshot({ workspaceId: 'w', sessionId: 'a' }))
  return draft
}

test('navigation flush saves without waiting for the debounce', async () => {
  const draft = setup()
  draft.edit(board => ({ ...board, title: 'Unsaved title' }))
  const writes: VisualBoardSnapshot[] = []
  await draft.flush(async board => { writes.push(board); return { board } })
  expect(writes.map(board => board.title)).toEqual(['Unsaved title'])
  expect(draft.getSnapshot().status).toBe('saved')
})

test('edits queued behind an in-flight save finish after navigation, in order', async () => {
  const draft = setup()
  const writes: VisualBoardSnapshot[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  draft.edit(board => ({ ...board, title: 'First' }))
  const save = async (board: VisualBoardSnapshot) => {
    writes.push(board)
    if (writes.length === 1) await gate
    return { board: { ...board, observedState: { title: board.title, cards: [] } } }
  }
  const pending = draft.flush(save)
  await Promise.resolve()
  draft.edit(board => ({ ...board, title: 'Latest' }))
  expect(draft.flush(save)).toBe(pending)
  release()
  await pending
  expect(writes.map(board => board.title)).toEqual(['First', 'Latest'])
  expect(writes[1]!.observedState?.title).toBe('First')
  expect(draft.getSnapshot().status).toBe('saved')
})

test('failed drafts survive returning to the board and retry explicitly', async () => {
  const key = crypto.randomUUID()
  const draft = getBoardDraft(key, 'a')
  draft.hydrate(createEmptyVisualBoardSnapshot({ workspaceId: key, sessionId: 'a' }))
  draft.edit(board => ({ ...board, title: 'Keep me' }))
  await draft.flush(async () => { throw new Error('offline') })
  const other = getBoardDraft(key, 'b')
  expect(other.getSnapshot().draft).toBeNull()
  const restored = getBoardDraft(key, 'a')
  expect(restored).toBe(draft)
  restored.hydrate(createEmptyVisualBoardSnapshot({ workspaceId: key, sessionId: 'a' }))
  expect(restored.getSnapshot().draft!.title).toBe('Keep me')
  expect(restored.getSnapshot().error).toBe('offline')
  restored.retry()
  await restored.flush(async board => ({ board }))
  expect(restored.getSnapshot().status).toBe('saved')
})

test('a response for the wrong board cannot replace the pending draft', async () => {
  const draft = setup()
  draft.edit(board => ({ ...board, title: 'Keep' }))
  await draft.flush(async board => ({ board: { ...board, sessionId: 'b' } }))
  expect(draft.getSnapshot().status).toBe('error')
  expect(draft.getSnapshot().draft!.sessionId).toBe('a')
  draft.discard()
  expect(draft.getSnapshot().draft).toBeNull()
  draft.hydrate(createEmptyVisualBoardSnapshot({ workspaceId: 'w', sessionId: 'a' }))
  expect(draft.getSnapshot().status).toBe('saved')
})

test('server refresh cannot overwrite edits during an in-flight save', async () => {
  const draft = setup()
  draft.edit(board => ({ ...board, title: 'Local' }))
  draft.hydrate(createEmptyVisualBoardSnapshot({ workspaceId: 'w', sessionId: 'a' }))
  expect(draft.getSnapshot().draft!.title).toBe('Local')
  await draft.flush(async board => ({ board }))
})
