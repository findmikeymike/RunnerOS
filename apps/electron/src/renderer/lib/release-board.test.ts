import { describe, expect, test } from 'bun:test'
import { STARTER_AGENTS } from '@craft-agent/shared/agent-definitions/starter-templates'
import { RELEASE_MANAGER_AGENT_SLUG } from '@craft-agent/shared/agent-definitions/defaults'
import { STARTER_WORKFLOWS } from '@craft-agent/shared/workflows/starter-templates'
import {
  buildReleaseBoardItemActionPrompt,
  buildReleaseBoardWorkflowInputs,
  buildDefaultReleaseBoard,
  findReleaseBoardWorkerSession,
  getReleaseBoardActionLabel,
  getBoardTotals,
  getReleaseBoardItemAction,
  linkReleaseBoardItemSession,
  linkReleaseBoardItemToolReview,
  linkReleaseBoardItemWorkflowRun,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  parseReleaseBoardDocResult,
  serializeReleaseBoardBody,
  setReleaseBoardItemIncluded,
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
    expect(getBoardTotals(board)).toEqual({ done: 0, total: 21 })
    expect(board.categories.find((category) => category.id === 'music')?.label).toBe('Foundation')
    expect(board.categories.find((category) => category.id === 'music')?.items.map((item) => item.label)).toEqual([
      'Master File',
      'Lyrics',
      'Creative World',
      'Branding',
      'Clean Version',
      'Instrumental',
      'Stems',
      'Record Doctor Review',
    ])
    expect(board.categories.find((category) => category.id === 'content')?.items.map((item) => item.label)).toEqual([
      'Idea Generation',
      'Lyric Clips',
      'Performance Clips',
      'Viral Clips',
      'UGC Clips',
      'Merch Clips',
      'Video Extras',
      'Memes',
    ])
    expect(board.categories.find((category) => category.id === 'setup')?.items.map((item) => item.label)).toEqual([
      'Distributor Upload',
      'Pre-Save Link',
      'Credits & Metadata',
      'Social Rollout',
      'Rights & Splits',
      'Final Release QA',
      'DSP Pitch',
      'EPK / Press Kit',
    ])
  })

  test('counts only core and explicitly activated optional items', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const withUgc = setReleaseBoardItemIncluded(board, 'content', 'ugc-clips', true)
    const withoutUgc = setReleaseBoardItemIncluded(withUgc, 'content', 'ugc-clips', false)

    expect(getBoardTotals(board)).toEqual({ done: 0, total: 21 })
    expect(getBoardTotals(withUgc)).toEqual({ done: 0, total: 22 })
    expect(getBoardTotals(withoutUgc)).toEqual({ done: 0, total: 21 })
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

  test('migrates newly introduced core items as honestly needed while preserving completed options', () => {
    const removedNewCoreIds = new Set(['performance-clips', 'rights-splits', 'release-qa'])
    const legacyBoard = buildDefaultReleaseBoard('workspace-1')
    legacyBoard.categories = legacyBoard.categories.map((category) => ({
      ...category,
      items: category.items
        .filter((item) => !removedNewCoreIds.has(item.id))
        .map((item) => {
          const legacy = { ...item } as Partial<typeof item>
          delete legacy.tier
          delete legacy.included
          legacy.status = item.id === 'ugc-clips' ? 'done' : 'needed'
          return legacy as typeof item
        }),
    }))

    const parsed = parseReleaseBoardDoc({
      slug: 'release-board',
      metadata: { name: 'Release Board', routing: { mode: 'broadcast' }, enabled: true },
      body: serializeReleaseBoardBody(legacyBoard),
      path: '/tmp/context/release-board',
      workspaceRootPath: '/tmp/workspace',
    } as ContextDocDTO)

    expect(parsed).not.toBeNull()
    expect(itemStatus(parsed!, 'content', 'ugc-clips')).toBe('done')
    expect(parsed!.categories.find((category) => category.id === 'content')?.items.find((item) => item.id === 'ugc-clips')?.included).toBe(true)
    expect(parsed!.categories.find((category) => category.id === 'promotion')?.items.find((item) => item.id === 'influencer-campaign')?.included).toBe(false)
    expect(itemStatus(parsed!, 'content', 'performance-clips')).toBe('needed')
    expect(itemStatus(parsed!, 'setup', 'rights-splits')).toBe('needed')
    expect(itemStatus(parsed!, 'setup', 'release-qa')).toBe('needed')
    expect(getBoardTotals(parsed!)).toEqual({ done: 1, total: 22 })
  })

  test('preserves an explicit timestamped N/A decision during migration', () => {
    const skipped = updateReleaseBoardItemStatus(
      buildDefaultReleaseBoard('workspace-1'),
      'setup',
      'rights-splits',
      'skipped',
    )

    const parsed = parseReleaseBoardDoc({
      slug: 'release-board',
      metadata: { name: 'Release Board', routing: { mode: 'broadcast' }, enabled: true },
      body: serializeReleaseBoardBody(skipped),
      path: '/tmp/context/release-board',
      workspaceRootPath: '/tmp/workspace',
    } as ContextDocDTO)

    expect(itemStatus(parsed!, 'setup', 'rights-splits')).toBe('skipped')
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

  test('does not treat a generic press document as a completed press list', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('press-doc'))

    expect(itemStatus(merged, 'promotion', 'press-list')).toBe('needed')
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

  test('persists the worker chat linked to an in-progress item', () => {
    const linked = linkReleaseBoardItemSession(
      buildDefaultReleaseBoard('workspace-1'),
      'content',
      'lyric-clips',
      'session-lyric-clips',
    )
    const body = serializeReleaseBoardBody(linked)
    const parsed = parseReleaseBoardDoc({ body })
    const item = parsed?.categories
      .find((category) => category.id === 'content')
      ?.items.find((candidate) => candidate.id === 'lyric-clips')

    expect(item?.status).toBe('in-progress')
    expect(item?.linkedSessionId).toBe('session-lyric-clips')
  })

  test('persists workflow runs and tool reviews at the status they actually reached', () => {
    const withRun = linkReleaseBoardItemWorkflowRun(
      buildDefaultReleaseBoard('workspace-1'),
      'content',
      'idea-generation',
      'run-content-mastermind',
    )
    const withReview = linkReleaseBoardItemToolReview(
      withRun,
      'music',
      'lyrics',
      'audio-master-1',
    )
    const parsed = parseReleaseBoardDoc({ body: serializeReleaseBoardBody(withReview) })
    const workflowItem = parsed?.categories
      .find((category) => category.id === 'content')
      ?.items.find((candidate) => candidate.id === 'idea-generation')
    const toolItem = parsed?.categories
      .find((category) => category.id === 'music')
      ?.items.find((candidate) => candidate.id === 'lyrics')

    expect(workflowItem).toMatchObject({
      status: 'in-progress',
      linkedWorkflowRunId: 'run-content-mastermind',
    })
    expect(toolItem).toMatchObject({
      status: 'review',
      linkedToolReviewAssetId: 'audio-master-1',
    })
  })

  test('recovers the newest matching legacy worker chat without crossing campaigns', () => {
    const sessions = [
      { id: 'wrong-campaign', workspaceId: 'workspace-1', spawnedFromAgent: { agentSlug: 'lyric-video-agent', agentName: 'Lyric Visuals' }, preview: 'Create Lyric Clips for the Midnight campaign.', createdAt: 400 },
      { id: 'old-match', workspaceId: 'workspace-1', spawnedFromAgent: { agentSlug: 'lyric-video-agent', agentName: 'Lyric Visuals' }, preview: 'Create the Lyric Clips deliverable for the Angelina campaign.', createdAt: 100 },
      { id: 'new-match', workspaceId: 'workspace-1', spawnedFromAgent: { agentSlug: 'lyric-video-agent', agentName: 'Lyric Visuals' }, preview: 'I want to work on Lyric Clips for my Angelina campaign.', createdAt: 200 },
      { id: 'wrong-worker', workspaceId: 'workspace-1', spawnedFromAgent: { agentSlug: 'content-genius', agentName: 'Content Genius' }, preview: 'I want to work on Lyric Clips for my Angelina campaign.', createdAt: 500 },
    ]

    expect(findReleaseBoardWorkerSession({
      sessions,
      workspaceId: 'workspace-1',
      agentSlug: 'lyric-video-agent',
      campaignTitle: 'Angelina',
      itemLabel: 'Lyric Clips',
    })).toBe('new-match')
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
    for (const itemId of ['distributor', 'presave', 'metadata', 'rights-splits', 'release-qa', 'dsp-pitch']) {
      expect(getReleaseBoardItemAction('setup', itemId)).toMatchObject({
        kind: 'agent',
        targetSlug: RELEASE_MANAGER_AGENT_SLUG,
      })
    }
    expect(getReleaseBoardItemAction('content', 'viral-clips')?.targetSlug).toBe('scroll-stopper')
    expect(getReleaseBoardItemAction('content', 'performance-clips')?.targetSlug).toBe('raw-video-editor')
    expect(getReleaseBoardItemAction('content', 'idea-generation')).toMatchObject({
      kind: 'workflow',
      targetSlug: 'content-mastermind',
    })
    expect(getReleaseBoardItemAction('promotion', 'press-list')).toMatchObject({
      kind: 'agent',
      targetSlug: 'industry-hunter',
    })
    expect(getReleaseBoardItemAction('promotion', 'playlist-targets')?.targetSlug).toBe('playlisting-power-up')
    expect(getReleaseBoardActionLabel(getReleaseBoardItemAction('music', 'lyrics')!)).toBe('Transcribe')
    expect(getReleaseBoardActionLabel(getReleaseBoardItemAction('content', 'idea-generation')!)).toBe('Run workflow')
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

  test('builds a collaborative, campaign-scoped kickoff instead of a blind work order', () => {
    const action = getReleaseBoardItemAction('content', 'lyric-clips')
    expect(action).not.toBeNull()

    const prompt = buildReleaseBoardItemActionPrompt({
      campaignTitle: 'Angelina',
      categoryLabel: 'Content',
      itemLabel: 'Lyric Clips',
      action: action!,
    })

    expect(prompt).toContain('I want to work on "Lyric Clips" for my "Angelina" campaign.')
    expect(prompt).toContain('strongest possible lyric-led visuals')
    expect(prompt).toContain('existing Artist HQ and campaign context')
    expect(prompt).toContain("Let's get a great plan together before we create anything.")
    expect(prompt).toContain('Start by talking the direction through with me.')
    expect(prompt).toContain('Ask any key guidance questions that would help us make it great.')
    expect(prompt).toContain("Once we agree on the direction, let's begin.")
    expect(prompt).toContain('Do not start producing the deliverable before that.')
    expect(prompt).toContain('without my exact approval')
    expect(prompt).not.toContain('Create the "Lyric Clips" deliverable')
    expect(prompt).not.toContain('Release Board lane')
    expect(prompt).not.toContain('durable, reviewable Runner Output')
    expect(prompt).not.toContain('marked done')
  })

  test('frames every worker and workflow lane as artist intent', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    for (const category of board.categories) {
      for (const item of category.items) {
        const action = getReleaseBoardItemAction(category.id, item.id)
        if (!action || action.kind === 'tool') continue
        const prompt = buildReleaseBoardItemActionPrompt({
          campaignTitle: 'Angelina',
          categoryLabel: category.label,
          itemLabel: item.label,
          action,
        })
        expect(action.instruction.startsWith('I want')).toBe(true)
        expect(prompt.startsWith(`I want to work on "${item.label}"`)).toBe(true)
        expect(prompt).toContain("Let's get a great plan together before we create anything.")
        expect(prompt).toContain('Start by talking the direction through with me.')
        expect(prompt).toContain('Do not start producing the deliverable before that.')
      }
    }
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
