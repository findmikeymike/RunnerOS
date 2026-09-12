import { describe, expect, test } from 'bun:test'
import { buildHqStateContextDoc, parseHqStateOfPlay, buildCampaignManagerBrief, buildManagerBrief, serializeCampaignManagerBrief } from '@craft-agent/shared/hq-state'
import { ARTIST_OS_TEAM_MISSION, ARTIST_MANAGER_BREAKTHROUGH_GUIDANCE, buildManagerBriefPromptSectionFromDocs } from '@craft-agent/shared/agent-prompt'
import type { ContextDocDTO } from '../../shared/types'
import { buildVoiceFocusPrompt } from './artist-manager-voice-focus-prompt'

const snapshotTime = new Date('2026-09-07T12:00:00.000Z')
const conversationTime = new Date('2026-09-08T12:00:00.000Z')
function doc(slug: string, body: string): ContextDocDTO {
  return { slug, body, metadata: { name: slug, enabled: true, routing: { mode: 'broadcast' } }, path: `/tmp/context/${slug}`, workspaceRootPath: '/tmp' }
}
function fixture(): ContextDocDTO {
  const built = buildHqStateContextDoc({
    workspaceId: 'artist-hq', relatedCampaigns: [], now: snapshotTime,
    docs: [doc('artist-profile', `\`\`\`json\n${JSON.stringify({ version: 1, artistName: 'Test Artist', updatedAt: '2025-01-01T00:00:00.000Z' })}\n\`\`\``)],
    operational: {
      generatedAt: snapshotTime.toISOString(), scope: { type: 'hq' }, active: [], approvals: [], failures: [], recentOutputs: [],
      sourceHealth: [{ source: 'scheduled-work', status: 'degraded', checkedAt: snapshotTime.toISOString(), itemCount: 0, message: 'Scheduled Work JSON is malformed.' }],
    },
  })
  return { ...doc(built.slug, built.body), metadata: built.metadata }
}

describe('focused voice prompt', () => {
  test('every conversational style shares the working Manager mission while retaining voice boundaries', () => {
    for (const style of ['sharp', 'high-energy', 'laid-back'] as const) {
      const prompt = buildVoiceFocusPrompt([fixture()], style, conversationTime)
      expect(prompt.split(ARTIST_OS_TEAM_MISSION)).toHaveLength(2)
      expect(prompt.split(ARTIST_MANAGER_BREAKTHROUGH_GUIDANCE)).toHaveLength(2)
      expect(prompt).toContain('cannot inspect files, search, save, schedule, contact anyone, delegate, or execute work')
      expect(prompt).toContain('only opens an unsent draft')
      expect(prompt).not.toContain('Give one useful angle, then stop')
      expect(prompt).toContain('unless asked to explore or elaborate')
    }
  })

  test('keeps a near-limit valid brief intact without overflowing the voice session budget', () => {
    const source = fixture()
    const state = parseHqStateOfPlay(source.body)
    if (state?.version !== 2) throw new Error('Expected version 2 fixture')
    state.managerBrief.operatingState.nextMove = undefined
    state.managerBrief.operatingState.blockers = ['x']
    source.body = '```json hq-state-of-play\n' + JSON.stringify(state) + '\n```'
    const baseLength = buildManagerBriefPromptSectionFromDocs([source], { includeRecommendations: false }).length
    state.managerBrief.operatingState.blockers = ['x'.repeat(7_991 - baseLength)]
    source.body = '```json hq-state-of-play\n' + JSON.stringify(state) + '\n```'
    const brief = buildManagerBriefPromptSectionFromDocs([source], { includeRecommendations: false })
    expect(brief.length).toBeGreaterThan(7_800)
    for (const style of ['sharp', 'high-energy', 'laid-back'] as const) {
      const prompt = buildVoiceFocusPrompt([source], style, conversationTime)
      expect(prompt).toContain(brief)
      expect(prompt.length).toBeLessThanOrEqual(12_000)
    }
  })

  test('Mikey adds personality while preserving the bounded artist brief and conversational intent', () => {
    const source = fixture()
    const prompt = buildVoiceFocusPrompt([source], 'laid-back', conversationTime)
    expect(prompt).toContain('You are Mikey')
    expect(prompt).toContain(buildManagerBriefPromptSectionFromDocs([source], { includeRecommendations: false }))
    expect(prompt).toContain('not by itself a request to leave the conversation')
    expect(prompt).toContain('only opens an unsent draft')
    expect(prompt.length).toBeLessThan(12_000)
  })

  test('preserves the real generated brief, missing facts, stale source and operational warnings', () => {
    const source = fixture()
    const expectedBrief = buildManagerBriefPromptSectionFromDocs([source], { includeRecommendations: false })
    const prompt = buildVoiceFocusPrompt([source], 'sharp', conversationTime)
    expect(prompt).toContain(expectedBrief)
    expect(prompt).toContain('Artist: Test Artist')
    expect(prompt).toContain('artist-profile: stale')
    expect(prompt).toContain('Scheduled Work JSON is malformed.')
    expect(prompt).toContain('unavailable')
    expect(prompt).toContain('spoken')
    expect(prompt).toContain(`Current time: ${conversationTime.toISOString()}`)
    expect(prompt).toContain(`Snapshot generated: ${snapshotTime.toISOString()}`)
  })

  test('excludes unrelated context, skill bodies, and worker catalog while placing delivery boundaries after the snapshot', () => {
    const prompt = buildVoiceFocusPrompt([
      fixture(), doc('private-notes', 'DO_NOT_INCLUDE_PRIVATE_DOCUMENT'),
      doc('agent-catalog', 'DO_NOT_INCLUDE_WORKER_CATALOG'),
      doc('skill-scout', 'DO_NOT_INCLUDE_SKILL_PROCEDURE'),
    ], 'high-energy', conversationTime)
    expect(prompt).not.toContain('DO_NOT_INCLUDE')
    expect(prompt.length).toBeLessThan(12_000)
    const tail = prompt.slice(prompt.lastIndexOf('</artist_snapshot>'))
    expect(tail).toContain('greeting')
    expect(tail).toContain('not an audit, status recap or unsolicited plan')
    expect(tail).toContain('60 words maximum')
    expect(tail).toContain('cannot perform the work in voice')
    expect(prompt).toContain('go to Command and start there')
    expect(prompt).toContain('19 remain open')
    expect(prompt).toContain('never tell them to get with another manager')
    expect(prompt).toContain('only prepares that offer')
    expect(tail).toContain('only the work, direction and decisions actually agreed')
    expect(tail).toContain('Do not add campaign names, dates, readiness blockers or metrics')
    expect(prompt).toContain('snapshot, not live verification')
    expect(prompt).toContain('never turn a target date into a confirmed date')
  })


  test('voice omits HQ recommendations without losing campaign inventory or changing the default brief', () => {
    const source = fixture()
    const state = parseHqStateOfPlay(source.body)
    if (state?.version !== 2) throw new Error('Expected version 2 fixture')
    const recommendation = state.managerBrief.operatingState.nextMove!
    expect(recommendation.title).toBe('Complete Artist Profile')
    state.managerBrief.campaignFocus = {
      workspaceId: 'campaign-1', name: 'Upcoming Single', label: 'Current campaign', releaseDate: '2026-09-11',
      source: { workspaceId: 'campaign-1', contextSlug: 'mission-brief' },
      releaseReadiness: {
        kit: { status: 'available', categories: ['Audio', 'Single art / artwork', 'Content video', 'Content images', 'Plans'].map(label => ({ label, ready: 0, needsReview: 0, missing: 0, restricted: 0 })) },
        essentials: { status: 'available', done: 2, total: 4, omitted: 0, items: [
          { label: 'Master File', status: 'done' }, { label: 'Lyrics', status: 'done' },
          { label: 'Spotify Canvas', status: 'needed' }, { label: 'Rollout plan', status: 'in-progress' },
        ] },
      },
    }
    source.body = '```json hq-state-of-play\n' + JSON.stringify(state) + '\n```'
    const originalBody = source.body
    const ordinary = buildManagerBriefPromptSectionFromDocs([source])
    const prompt = buildVoiceFocusPrompt([source], 'laid-back', conversationTime)
    for (const value of [recommendation.title, recommendation.why, `Worker: @${recommendation.worker}`]) {
      expect(ordinary).toContain(value)
      expect(prompt).not.toContain(value)
    }
    for (const value of ['Upcoming Single', 'Audio: 0 ready', 'Content video: 0 ready', 'Content images: 0 ready', 'Plans: 0 ready', 'Marked done: Master File; Lyrics', 'Needed: Spotify Canvas', 'In progress: Rollout plan', 'HQ context gaps: artist sound', 'Scheduled Work JSON is malformed.', 'artist-profile: stale']) {
      expect(prompt).toContain(value)
      expect(ordinary).toContain(value)
    }
    expect(source.body).toBe(originalBody)
    expect(buildManagerBriefPromptSectionFromDocs([source])).toBe(ordinary)
  })

  test('campaign voice excludes the generated suggested focus while retaining campaign facts', () => {
    const brief = buildCampaignManagerBrief({
      artistWorkspaceId: 'hq',
      artistBrief: buildManagerBrief({ workspaceId: 'hq', now: snapshotTime, docs: [], relatedCampaigns: [] }),
      campaign: {
        workspaceId: 'campaign-1', name: 'Upcoming Single', primary: true, sourceHealth: [],
        releaseReadiness: {
          kit: { status: 'available', categories: [{ label: 'Content video', ready: 1, needsReview: 0, missing: 0, restricted: 0 }] },
          essentials: { status: 'available', done: 1, total: 2, omitted: 0, items: [{ label: 'Master File', status: 'done' }, { label: 'Spotify Canvas', status: 'needed' }] },
        },
      },
      now: snapshotTime,
    })
    const source = doc('campaign-state-of-play', serializeCampaignManagerBrief(brief))
    const ordinary = buildManagerBriefPromptSectionFromDocs([source])
    const prompt = buildVoiceFocusPrompt([source], 'sharp', conversationTime)
    expect(brief.operatingState.suggestedFocus).toBeTruthy()
    expect(ordinary).toContain(`Suggested focus: ${brief.operatingState.suggestedFocus}`)
    expect(prompt).not.toContain(brief.operatingState.suggestedFocus!)
    expect(prompt).toContain('Campaign: Upcoming Single')
    expect(prompt).toContain('Content video: 1 ready')
    expect(prompt).not.toContain('Blockers:')
    expect(prompt).toContain('Campaign operating gaps:')
    expect(prompt).toContain('Marked done: Master File')
    expect(prompt).toContain('Needed: Spotify Canvas')
    expect(prompt).toContain('Campaign mission is not defined.')
    expect(prompt).toContain(buildManagerBriefPromptSectionFromDocs([source], { includeRecommendations: false }))
    expect(buildManagerBriefPromptSectionFromDocs([source])).toBe(ordinary)
  })

  test('refuses missing, disabled, and malformed brief instead of inventing context', () => {
    const valid = fixture()
    for (const docs of [[], [{ ...valid, metadata: { ...valid.metadata, enabled: false } }], [{ ...valid, body: 'not a valid generated brief' }]]) {
      expect(() => buildVoiceFocusPrompt(docs, 'laid-back', conversationTime)).toThrow('brief is not ready')
    }
  })
})
