import { describe, expect, test } from 'bun:test'
import { buildHqStateContextDoc } from '@craft-agent/shared/hq-state'
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
  test('preserves the real generated brief, missing facts, stale source and operational warnings', () => {
    const source = fixture()
    const expectedBrief = buildManagerBriefPromptSectionFromDocs([source])
    const prompt = buildVoiceFocusPrompt([source], 'sharp', conversationTime)
    expect(prompt).toContain(expectedBrief)
    expect(prompt).toContain('Artist: Test Artist')
    expect(prompt).toContain('artist-profile: stale')
    expect(prompt).toContain('Scheduled Work JSON is malformed.')
    expect(prompt).toContain('unavailable')
    expect(prompt).toContain('sound')
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
    expect(tail).toContain('at most 60 words')
    expect(tail).toContain('cannot perform actions')
    expect(prompt).toContain('must open Manager chat')
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
