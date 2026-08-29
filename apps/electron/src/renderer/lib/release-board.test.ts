import { describe, expect, test } from 'bun:test'
import { STARTER_AGENTS } from '@craft-agent/shared/agent-definitions/starter-templates'
import { STARTER_WORKFLOWS } from '@craft-agent/shared/workflows/starter-templates'
import {
  buildReleaseBoardItemActionPrompt,
  buildReleaseBoardWorkflowInputs,
  buildDefaultReleaseBoard,
  getBoardTotals,
  getReleaseBoardItemAction,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  parseReleaseBoardDocResult,
  serializeReleaseBoardBody,
  toggleReleaseBoardItem,
  updateReleaseBoardItemStatus,
} from './release-board'
import type { ContextDocDTO, MissionAssetManifest } from '../../shared/types'

describe('release board utilities', () => {
  test('builds the default release board categories', () => {
    const board = buildDefaultReleaseBoard('workspace-1')

    expect(board.categories.map((category) => category.id)).toEqual([
      'music',
      'visuals',
      'content',
      'setup',
      'promotion',
    ])
    expect(getBoardTotals(board)).toEqual({ done: 0, total: 26 })
    expect(board.categories.find((category) => category.id === 'music')?.label).toBe('Foundation')
    expect(board.categories.find((category) => category.id === 'music')?.items.map((item) => item.label)).toEqual([
      'Master File',
      'Clean Version',
      'Lyrics',
      'Creative World',
      'Campaign Branding',
    ])
    expect(board.categories.find((category) => category.id === 'content')?.items.map((item) => item.label)).toEqual([
      'Idea Generation',
      'Lyric Clips',
      'Viral Clips',
      'UGC Clips',
      'Video Extras',
    ])
    expect(board.categories.find((category) => category.id === 'setup')?.items.map((item) => item.label)).toEqual([
      'Distributor Upload',
      'Pre-Save Link',
      'Credits and Metadata',
      'Social Rollout',
    ])
  })

  test('round-trips through a workspace context doc body', () => {
    const board = toggleReleaseBoardItem(buildDefaultReleaseBoard('workspace-1'), 'visuals', 'cover-art')
    const savedCoverArt = board.categories
      .find((category) => category.id === 'visuals')
      ?.items.find((item) => item.id === 'cover-art')
    if (savedCoverArt) savedCoverArt.label = 'Single art'
    const parsed = parseReleaseBoardDoc({
      slug: 'release-board',
      metadata: { name: 'Release Board', routing: { mode: 'broadcast' }, enabled: true },
      body: serializeReleaseBoardBody(board),
      path: '/tmp/context/release-board',
      workspaceRootPath: '/tmp/workspace',
    } as ContextDocDTO)

    const visuals = parsed?.categories.find((category) => category.id === 'visuals')
    expect(visuals?.items.find((item) => item.id === 'cover-art')?.status).toBe('done')
    expect(visuals?.items.find((item) => item.id === 'cover-art')?.label).toBe('Single Art')
  })

  test('preserves persisted freshness and rejects a missing timestamp', () => {
    const board = { ...buildDefaultReleaseBoard('workspace-1'), updatedAt: '2026-04-03T00:00:00.000Z' }
    const parsed = parseReleaseBoardDocResult({ body: serializeReleaseBoardBody(board) })
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.board.updatedAt).toBe('2026-04-03T00:00:00.000Z')

    const missing = parseReleaseBoardDocResult({
      body: '```json\n{"version":1,"workspaceId":"workspace-1","categories":[]}\n```',
    })
    expect(missing.ok).toBe(false)
    expect(missing.ok || missing.error).toContain('updatedAt')
  })

  test('adds new tasks as not applicable when loading an existing campaign', () => {
    const addedItemIds = new Set([
      'song-world',
      'release-identity',
      'announcement',
      'social-schedule',
      'video-production',
      'paid-campaign',
      'college-radio',
      'influencer-campaign',
      'ig-trending',
      'artist-playlist',
    ])
    const legacyBoard = buildDefaultReleaseBoard('workspace-1')
    legacyBoard.categories = legacyBoard.categories.map((category) => ({
      ...category,
      items: category.items
        .filter((item) => !addedItemIds.has(item.id))
        .map((item) => ({ ...item, status: 'done' as const })),
    }))

    const parsed = parseReleaseBoardDoc({
      slug: 'release-board',
      metadata: { name: 'Release Board', routing: { mode: 'broadcast' }, enabled: true },
      body: serializeReleaseBoardBody(legacyBoard),
      path: '/tmp/context/release-board',
      workspaceRootPath: '/tmp/workspace',
    } as ContextDocDTO)

    expect(parsed).not.toBeNull()
    expect(getBoardTotals(parsed!)).toEqual({ done: 17, total: 17 })
    expect(itemStatus(parsed!, 'music', 'song-world')).toBe('skipped')
    expect(itemStatus(parsed!, 'promotion', 'college-radio')).toBe('skipped')
    expect(parsed!.categories.find((category) => category.id === 'setup')?.items.some((item) => item.id === 'announcement')).toBe(false)
  })

  test('marks asset-backed items done when matching files exist', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('master', 'approved-lyrics', 'cover-art'))

    expect(itemStatus(merged, 'music', 'master')).toBe('done')
    expect(itemStatus(merged, 'music', 'lyrics')).toBe('done')
    expect(itemStatus(merged, 'visuals', 'cover-art')).toBe('done')
    expect(itemStatus(merged, 'promotion', 'ad-creatives')).toBe('needed')
    expect(getBoardTotals(merged).done).toBe(3)
  })

  test('does not mark lyrics done until lyrics are approved', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const generic = mergeReleaseBoardWithAssets(board, manifestWith('lyrics'))
    const reviewNeeded = mergeReleaseBoardWithAssets(board, manifestWith('review-needed-lyrics'))

    expect(itemStatus(generic, 'music', 'lyrics')).toBe('needed')
    expect(itemStatus(reviewNeeded, 'music', 'lyrics')).toBe('needed')
  })

  test('does not mark generated deliverables done from generic media files', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('raw-video', 'final-video'))

    expect(itemStatus(merged, 'visuals', 'canvas')).toBe('needed')
    expect(itemStatus(merged, 'content', 'viral-clips')).toBe('needed')
    expect(itemStatus(merged, 'content', 'lyric-clips')).toBe('needed')
  })

  test('does not override skipped items from asset auto-fill', () => {
    const board = updateReleaseBoardItemStatus(buildDefaultReleaseBoard('workspace-1'), 'visuals', 'cover-art', 'skipped')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('cover-art'))

    expect(itemStatus(merged, 'visuals', 'cover-art')).toBe('skipped')
  })

  test('toggles items between needed and done', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const done = toggleReleaseBoardItem(board, 'setup', 'presave')
    const needed = toggleReleaseBoardItem(done, 'setup', 'presave')

    expect(itemStatus(done, 'setup', 'presave')).toBe('done')
    expect(itemStatus(needed, 'setup', 'presave')).toBe('needed')
  })

  test('restores a skipped item to needed before it can be completed', () => {
    const skipped = updateReleaseBoardItemStatus(buildDefaultReleaseBoard('workspace-1'), 'promotion', 'college-radio', 'skipped')
    const restored = toggleReleaseBoardItem(skipped, 'promotion', 'college-radio')

    expect(itemStatus(restored, 'promotion', 'college-radio')).toBe('needed')
  })

  test('routes only in-app deliverables to the right workers', () => {
    expect(getReleaseBoardItemAction('music', 'master')).toBeNull()
    expect(getReleaseBoardItemAction('music', 'song-notes')).toBeNull()
    expect(getReleaseBoardItemAction('music', 'lyrics')).toMatchObject({
      kind: 'tool',
      targetSlug: 'transcribe-lyrics',
    })
    expect(getReleaseBoardItemAction('music', 'song-world')?.targetSlug).toBe('world-builder')
    expect(getReleaseBoardItemAction('visuals', 'cover-art')?.targetSlug).toBe('art-director')
    expect(getReleaseBoardItemAction('visuals', 'canvas')?.targetSlug).toBe('hypermotion-agent')
    expect(getReleaseBoardItemAction('setup', 'metadata')).toMatchObject({
      kind: 'agent',
      targetSlug: 'comms-agent',
    })
    expect(getReleaseBoardItemAction('content', 'viral-clips')?.targetSlug).toBe('scroll-stopper')
    expect(getReleaseBoardItemAction('content', 'idea-generation')).toMatchObject({
      kind: 'workflow',
      targetSlug: 'content-mastermind',
    })
    expect(getReleaseBoardItemAction('promotion', 'playlist-targets')).toMatchObject({
      kind: 'agent',
      targetSlug: 'industry-hunter',
    })
    expect(getReleaseBoardItemAction('promotion', 'press-list')).toMatchObject({
      kind: 'agent',
      targetSlug: 'industry-hunter',
    })
  })

  test('keeps every release-board action wired to an installed target', () => {
    const agentSlugs = new Set(STARTER_AGENTS.map((agent) => agent.slug))
    const workflowSlugs = new Set(STARTER_WORKFLOWS.map((workflow) => workflow.slug))
    const board = buildDefaultReleaseBoard('workspace-1')

    for (const category of board.categories) {
      for (const item of category.items) {
        const action = getReleaseBoardItemAction(category.id, item.id)
        if (action?.kind === 'agent') expect(agentSlugs.has(action.targetSlug)).toBe(true)
        if (action?.kind === 'workflow') expect(workflowSlugs.has(action.targetSlug)).toBe(true)
      }
    }
  })

  test('builds a campaign-scoped, non-public worker brief', () => {
    const action = getReleaseBoardItemAction('visuals', 'cover-art')
    expect(action).not.toBeNull()

    const prompt = buildReleaseBoardItemActionPrompt({
      campaignTitle: 'Coming Home',
      categoryLabel: 'Visuals',
      itemLabel: 'Single Art',
      action: action!,
    })

    expect(prompt).toContain('Coming Home')
    expect(prompt).toContain('Single Art')
    expect(prompt).toContain('existing Artist HQ and campaign context')
    expect(prompt).toContain('Do not publish')
  })

  test('builds required workflow inputs from campaign context', () => {
    const contentAction = getReleaseBoardItemAction('content', 'idea-generation')
    const radioAction = getReleaseBoardItemAction('promotion', 'college-radio')
    const paidAction = getReleaseBoardItemAction('promotion', 'paid-campaign')

    expect(buildReleaseBoardWorkflowInputs(contentAction!, 'Campaign brief')).toMatchObject({
      campaign_brief: 'Campaign brief',
      locked_elements: expect.any(String),
      production_context: expect.any(String),
    })
    expect(buildReleaseBoardWorkflowInputs(radioAction!, 'Release brief')).toEqual({
      release_brief: 'Release brief',
    })
    expect(buildReleaseBoardWorkflowInputs(paidAction!, 'Campaign brief')).toEqual({
      campaign_brief: 'Campaign brief',
    })
  })
})

function itemStatus(
  board: ReturnType<typeof buildDefaultReleaseBoard>,
  categoryId: string,
  itemId: string,
) {
  return board.categories
    .find((category) => category.id === categoryId)
    ?.items.find((item) => item.id === itemId)
    ?.status
}

type ManifestFixtureKind = MissionAssetManifest['files'][number]['kind'] | 'approved-lyrics' | 'review-needed-lyrics'

function manifestWith(...kinds: ManifestFixtureKind[]): MissionAssetManifest {
  return {
    version: 1,
    workspaceId: 'workspace-1',
    assetsRoot: '/tmp/assets',
    storageMode: 'copied',
    updatedAt: new Date().toISOString(),
    files: kinds.map((fixtureKind, index) => {
      const kind = fixtureKind === 'approved-lyrics' || fixtureKind === 'review-needed-lyrics' ? 'lyrics' : fixtureKind
      return {
        id: `${kind}-${index}`,
        kind,
        label: kind,
        source: 'copy',
        status: 'available',
        usableByAgents: true,
        lyrics: fixtureKind === 'approved-lyrics'
          ? { text: 'approved line', reviewRequired: false, status: 'approved' }
          : fixtureKind === 'review-needed-lyrics'
            ? { text: 'draft line', reviewRequired: true, status: 'machine' }
            : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }),
  }
}
