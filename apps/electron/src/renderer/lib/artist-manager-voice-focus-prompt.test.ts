import { describe, expect, test } from 'bun:test'
import { buildHqStateContextDoc, parseHqStateOfPlay } from '@craft-agent/shared/hq-state'
import { buildManagerBriefPromptSectionFromDocs } from '@craft-agent/shared/agent-prompt'
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
  test('keeps a near-limit valid brief intact without overflowing the voice session budget', () => {
    const source = fixture()
    const state = parseHqStateOfPlay(source.body)
    if (state?.version !== 2) throw new Error('Expected version 2 fixture')
    state.managerBrief.operatingState.blockers = ['x']
    source.body = '```json hq-state-of-play\n' + JSON.stringify(state) + '\n```'
    const baseLength = buildManagerBriefPromptSectionFromDocs([source]).length
    state.managerBrief.operatingState.blockers = ['x'.repeat(7_991 - baseLength)]
    source.body = '```json hq-state-of-play\n' + JSON.stringify(state) + '\n```'
    const brief = buildManagerBriefPromptSectionFromDocs([source])
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
    expect(prompt).toContain(buildManagerBriefPromptSectionFromDocs([source]))
    expect(prompt).toContain('not by itself a request to leave the conversation')
    expect(prompt).toContain('only opens an unsent draft')
    expect(prompt.length).toBeLessThan(12_000)
  })

  test('preserves the real generated brief, missing facts, stale source and operational warnings', () => {
    const source = fixture()
    const expectedBrief = buildManagerBriefPromptSectionFromDocs([source])
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

  test('refuses missing, disabled, and malformed brief instead of inventing context', () => {
    const valid = fixture()
    for (const docs of [[], [{ ...valid, metadata: { ...valid.metadata, enabled: false } }], [{ ...valid, body: 'not a valid generated brief' }]]) {
      expect(() => buildVoiceFocusPrompt(docs, 'laid-back', conversationTime)).toThrow('brief is not ready')
    }
  })
})
