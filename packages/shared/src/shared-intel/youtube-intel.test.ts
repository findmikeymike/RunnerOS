import { describe, expect, it } from 'bun:test'
import { buildYouTubeIntelCandidates, parseYouTubeIntelNuggets } from './youtube-intel.ts'

describe('YouTube intel report parsing', () => {
  const markdown = ['# Report', '```youtube-intel', JSON.stringify({
    version: 1,
    nuggets: [{
      category: 'content',
      title: 'Open with the unresolved tension',
      summary: 'The strongest examples delay the answer.',
      whyItMatters: 'It gives short-form posts a repeatable retention device.',
      evidence: '04:12-04:39 in the source transcript.',
      sourceUrls: ['https://youtube.com/watch?v=abc123'],
    }],
  }), '```'].join('\n')

  it('parses valid evidence-backed nuggets', () => {
    expect(parseYouTubeIntelNuggets(markdown)).toHaveLength(1)
  })

  it('routes by category and only to active agents', () => {
    const candidates = buildYouTubeIntelCandidates(parseYouTubeIntelNuggets(markdown), [
      { slug: 'content-genius', name: 'Content Genius', active: true },
      { slug: 'scroll-stopper', name: 'Scroll Stopper', active: false },
      { slug: 'social-publisher', name: 'Social Publisher', active: true },
    ])
    expect(candidates[0]?.targetAgents).toEqual(['content-genius', 'social-publisher'])
  })

  it('rejects malformed, unsupported, or unsourced nuggets', () => {
    const bad = '```youtube-intel\n{"version":1,"nuggets":[{"category":"finance","title":"x"}]}\n```'
    expect(parseYouTubeIntelNuggets(bad)).toEqual([])
  })
})
