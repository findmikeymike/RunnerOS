import { expect, test } from 'bun:test'
import { type VideoStudioDraft, clearVideoDraft, readVideoDraft, videoDraftConflicts, videoDraftKey, writeVideoDraft } from './video-studio-drafts'
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const draft = (workspaceId = 'workspace', outputId = 'output'): VideoStudioDraft => ({ version: 1, workspaceId, outputId, baseText: '{"version":1}\n', rawText: '{ unfinished raw JSON', projectText: '{"version":1}', updatedAt: '2026-09-25T12:00:00Z' })

test('reopening retrieves exact invalid JSON and its saved base without parsing away edits', () => {
  const disk = storage()
  writeVideoDraft(disk, draft())
  expect(readVideoDraft(disk, 'workspace', 'output')).toEqual(draft())
  expect(readVideoDraft(disk, 'workspace', 'output')?.rawText).toBe('{ unfinished raw JSON')
})
test('drafts are isolated by both workspace and output even with delimiter-like IDs', () => {
  const disk = storage()
  writeVideoDraft(disk, draft('a:b', 'c'))
  writeVideoDraft(disk, draft('a', 'b:c'))
  expect(videoDraftKey('a:b', 'c')).not.toBe(videoDraftKey('a', 'b:c'))
  expect(readVideoDraft(disk, 'a:b', 'c')?.workspaceId).toBe('a:b')
  expect(readVideoDraft(disk, 'a', 'b:c')?.workspaceId).toBe('a')
  expect(readVideoDraft(disk, 'a', 'c')).toBeNull()
})
test('newer disk content cannot become the restored draft base silently', () => {
  const saved = draft()
  expect(videoDraftConflicts(saved, saved.baseText)).toBe(false)
  expect(videoDraftConflicts(saved, '{"version":2}\n')).toBe(true)
  expect(saved.baseText).toBe('{"version":1}\n')
})
test('successful save clears only the exact saved draft, preserving newer edits', () => {
  const disk = storage()
  writeVideoDraft(disk, draft())
  expect(clearVideoDraft(disk, 'workspace', 'output', 'older text')).toBe(false)
  expect(readVideoDraft(disk, 'workspace', 'output')).not.toBeNull()
  expect(clearVideoDraft(disk, 'workspace', 'output', draft().rawText)).toBe(true)
  expect(readVideoDraft(disk, 'workspace', 'output')).toBeNull()
})
test('explicit discard removes only its project draft', () => {
  const disk = storage()
  writeVideoDraft(disk, draft())
  writeVideoDraft(disk, draft('another'))
  clearVideoDraft(disk, 'workspace', 'output')
  expect(readVideoDraft(disk, 'workspace', 'output')).toBeNull()
  expect(readVideoDraft(disk, 'another', 'output')).not.toBeNull()
})
test('malformed storage and wrong-identity records are not restored', () => {
  const disk = storage()
  disk.setItem(videoDraftKey('workspace', 'output'), '{broken')
  expect(readVideoDraft(disk, 'workspace', 'output')).toBeNull()
  disk.setItem(videoDraftKey('workspace', 'output'), JSON.stringify(draft('wrong')))
  expect(readVideoDraft(disk, 'workspace', 'output')).toBeNull()
})
test('quota failure is surfaced rather than falsely reporting a durable draft', () => {
  const disk = storage()
  expect(() => writeVideoDraft({ ...disk, setItem: () => { throw new Error('quota') } }, draft())).toThrow('quota')
})
