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
