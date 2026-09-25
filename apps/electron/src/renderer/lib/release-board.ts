import { isReleaseBoardItemIncluded, type ReleaseBoard } from '@craft-agent/shared/artist-context'
import type { SessionMeta } from '@/atoms/sessions'

export {
  RELEASE_BOARD_CONTEXT_SLUG,
  buildDefaultReleaseBoard,
  buildReleaseBoardItemActionPrompt,
  buildReleaseBoardWorkflowInputs,
  getReleaseBoardActionLabel,
  getBoardTotals,
  getCategoryProgress,
  getReleaseBoardItemAction,
  isReleaseBoardItemIncluded,
  linkReleaseBoardItemSession,
  linkReleaseBoardItemToolReview,
  linkReleaseBoardItemWorkflowRun,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  parseReleaseBoardDocResult,
  releaseBoardMetadata,
  serializeReleaseBoardBody,
  setReleaseBoardItemIncluded,
  toggleReleaseBoardItem,
  updateReleaseBoardItemStatus,
  type ReleaseBoard,
  type ReleaseBoardCategory,
  type ReleaseBoardItem,
  type ReleaseBoardItemAction,
  type ReleaseBoardItemTier,
  type ReleaseBoardItemStatus,
  type ReleaseBoardParseResult,
} from '@craft-agent/shared/artist-context'

export function findReleaseBoardWorkerSession(input: {
  sessions: Iterable<SessionMeta>
  workspaceId: string
  agentSlug: string
  campaignTitle: string
  itemLabel: string
}): string | null {
  const campaignNeedle = input.campaignTitle.trim().toLocaleLowerCase()
  const itemNeedle = input.itemLabel.trim().toLocaleLowerCase()
  return [...input.sessions]
    .filter((session) => {
      if (session.workspaceId !== input.workspaceId) return false
      if (session.spawnedFromAgent?.agentSlug !== input.agentSlug) return false
      const preview = session.preview?.toLocaleLowerCase() ?? ''
      return preview.includes(campaignNeedle) && preview.includes(itemNeedle)
    })
    .sort((left, right) => (right.createdAt ?? right.lastMessageAt ?? 0) - (left.createdAt ?? left.lastMessageAt ?? 0))[0]?.id ?? null
}

/** Surface reviews and existing work first, preserving board order within each status. */
export function getNextReleaseEssentials(board: ReleaseBoard) {
  const priority = { review: 0, 'in-progress': 1, needed: 2, done: 3, skipped: 4 }
  return board.categories
    .flatMap((category) => category.items.map((item) => ({ category, item })))
    .filter(({ item }) => isReleaseBoardItemIncluded(item) && item.status !== 'done' && item.status !== 'skipped')
    .sort((a, b) => priority[a.item.status] - priority[b.item.status])
    .slice(0, 3)
}
