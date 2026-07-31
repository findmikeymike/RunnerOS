import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_ARTIST_INTEL_SOURCES,
  artistIntelConfigMetadata,
  createQueuedIntelRun,
  createIntelRunPrompt,
  createIntelQueueWorkAction,
  createScheduledIntelRunPrompt,
  emptyArtistIntelConfig,
  emptyArtistIntelReport,
  isValidYouTubeChannelUrl,
  parseArtistIntelConfigDocResult,
  parseArtistIntelReportDocResult,
  serializeArtistIntelConfigBody,
} from './artist-intel'

function makeDoc(body: string) {
  return {
    slug: 'artist-intel-config',
    metadata: artistIntelConfigMetadata(),
    body,
    path: '/tmp/context/artist-intel-config',
    workspaceRootPath: '/tmp/workspace',
  }
}

describe('artist-intel', () => {
  test('seeds the old artist-management YouTube channels', () => {
    const config = emptyArtistIntelConfig()
    expect(config.enabled).toBe(false)
    expect(config.sources.map((source) => source.name)).toEqual([
      'Managers Playbook',
      'Viral VSN',
      'No Labels Necessary',
      'Neighborhood Art Supply',
      'Its21Master',
    ])
  })

  test('round-trips config through a context doc body', () => {
    const config = {
      ...emptyArtistIntelConfig(),
      enabled: true,
      maxPerChannel: 4,
      sinceDays: 10,
      sources: DEFAULT_ARTIST_INTEL_SOURCES.slice(0, 2),
    }

    const result = parseArtistIntelConfigDocResult(makeDoc(serializeArtistIntelConfigBody(config)))

    expect(result.ok).toBe(true)
    expect(result.config.enabled).toBe(true)
    expect(result.config.maxPerChannel).toBe(1)
    expect(result.config.sinceDays).toBe(10)
    expect(result.config.sources).toHaveLength(2)
  })

  test('builds a bounded run prompt with configured channels', () => {
    const prompt = createIntelRunPrompt(emptyArtistIntelConfig(), 'Artist HQ')

    expect(prompt).toContain('Run the HQ YouTube Intel Pulse')
    expect(prompt).toContain('Managers Playbook')
    expect(prompt).toContain('No Labels Necessary')
    expect(prompt).toContain('only the newest upload')
    expect(prompt).toContain('only when that newest video ID is not already recorded')
    expect(prompt).toContain('youtube-intel JSON block')
    expect(prompt).toContain('Do not publish, comment, upload')
  })

  test('builds a scheduled prompt that reads current config at runtime', () => {
    const prompt = createScheduledIntelRunPrompt('Artist HQ')

    expect(prompt).toContain('context/artist-intel-config/CONTEXT.md')
    expect(prompt).toContain('exactly one HQ report Output')
    expect(prompt).toContain('context/artist-intel-state/CONTEXT.md')
    expect(prompt).toContain('no-new-videos report is a valid completion')
    expect(prompt).toContain('scheduler handles deduplication state, dashboard, and agent-context routing')
    expect(prompt).toContain('enabled is false')
  })

  test('builds hidden weekly work with a required report and routing postprocessor', () => {
    const action = createIntelQueueWorkAction('Artist HQ', createScheduledIntelRunPrompt('Artist HQ'))

    expect(action.calendarVisibility).toBe('hidden')
    expect(action.execution).toMatchObject({
      type: 'agent-task',
      agentSlug: 'youtube-intelligence-agent',
      permissionMode: 'safe',
      expectedOutput: { requirement: 'required', kind: 'report', title: 'Weekly YouTube Intelligence Report' },
      postProcess: 'youtube-intelligence',
    })
  })

  test('validates YouTube channel URLs', () => {
    expect(isValidYouTubeChannelUrl('https://www.youtube.com/@managersplaybook')).toBe(true)
    expect(isValidYouTubeChannelUrl('https://www.youtube.com/@managersplaybook/videos')).toBe(true)
    expect(isValidYouTubeChannelUrl('https://youtube.com/channel/UCabc123')).toBe(true)
    expect(isValidYouTubeChannelUrl('https://youtu.be/abc123')).toBe(false)
    expect(isValidYouTubeChannelUrl('https://example.com/@channel')).toBe(false)
  })

  test('adds queued runs without dropping history', () => {
    const report = createQueuedIntelRun(emptyArtistIntelReport(), {
      sessionId: 's1',
      sourceCount: 4,
      generatedAt: '2026-07-01T00:00:00.000Z',
    })
    const next = createQueuedIntelRun(report, {
      sessionId: 's2',
      sourceCount: 5,
      generatedAt: '2026-07-02T00:00:00.000Z',
    })

    expect(next.status).toBe('queued')
    expect(next.sessionId).toBe('s2')
    expect(next.runs).toHaveLength(2)
    expect(next.runs[0].sessionId).toBe('s2')
    expect(next.runs[1].sessionId).toBe('s1')
  })

  test('retains processed video counts in completed report history', () => {
    const result = parseArtistIntelReportDocResult(makeDoc([
      '```json',
      JSON.stringify({
        version: 1,
        status: 'ready',
        sourceCount: 5,
        videoCount: 4,
        nuggetCount: 9,
        runs: [{
          id: 'run-1',
          status: 'ready',
          generatedAt: '2026-07-30T00:00:00.000Z',
          videoCount: 4,
          nuggetCount: 9,
        }],
        updatedAt: '2026-07-30T00:00:00.000Z',
      }),
      '```',
    ].join('\n')))

    expect(result.ok).toBe(true)
    expect(result.report.videoCount).toBe(4)
    expect(result.report.runs[0]?.videoCount).toBe(4)
  })
})
