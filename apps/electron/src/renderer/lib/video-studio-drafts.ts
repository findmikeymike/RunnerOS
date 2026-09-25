export interface VideoStudioDraft {
  version: 1
  workspaceId: string
  outputId: string
  baseText: string
  rawText: string
  projectText: string
  updatedAt: string
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function videoDraftKey(workspaceId: string, outputId: string): string {
  return `artist-os:video-draft:v1:${JSON.stringify([workspaceId, outputId])}`
}
export function readVideoDraft(storage: DraftStorage, workspaceId: string, outputId: string): VideoStudioDraft | null {
  const text = storage.getItem(videoDraftKey(workspaceId, outputId))
  if (!text) return null
  try {
    const draft = JSON.parse(text)
    if (draft.version !== 1 || draft.workspaceId !== workspaceId || draft.outputId !== outputId
      || typeof draft.baseText !== 'string' || typeof draft.rawText !== 'string' || typeof draft.projectText !== 'string') return null
    return draft
  } catch { return null }
}
export function writeVideoDraft(storage: DraftStorage, draft: VideoStudioDraft): void {
  storage.setItem(videoDraftKey(draft.workspaceId, draft.outputId), JSON.stringify(draft))
}
export function clearVideoDraft(storage: DraftStorage, workspaceId: string, outputId: string, expectedRawText?: string): boolean {
  if (expectedRawText !== undefined && readVideoDraft(storage, workspaceId, outputId)?.rawText !== expectedRawText) return false
  storage.removeItem(videoDraftKey(workspaceId, outputId))
  return true
}
export function videoDraftConflicts(draft: VideoStudioDraft, diskText: string): boolean {
  // Exact base is retained for the server's optimistic save contract.
  return draft.baseText !== diskText
}
