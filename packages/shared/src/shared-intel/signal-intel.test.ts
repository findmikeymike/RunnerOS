import { describe, expect, test } from 'bun:test'
import {
  MAX_SIGNAL_INTEL_ITEMS,
  buildSignalIntelCandidates,
  parseSignalIntelReportData,
} from './signal-intel'

const item = {
  category: 'content',
  title: 'Short video analytics changed',
  summary: 'A platform added a more useful retention view.',
  whyItMatters: 'The content team can compare opening hooks with less guesswork.',
  evidence: 'The official creator update names the new retention report.',
  sourceUrls: ['https://example.com/creator-update'],
}

function packet(lane: 'platform' | 'industry', items: unknown[]): string {
  return ['```signal-intel', JSON.stringify({ version: 1, lane, items }), '```'].join('\n')
}

describe('signal-intel', () => {
  test('parses a lane packet and enforces the retained-item ceiling', () => {
    const parsed = parseSignalIntelReportData(packet('platform', Array.from({ length: 12 }, (_, index) => ({
      ...item,
      title: `${item.title} ${index}`,
    }))), 'platform')

    expect(parsed?.lane).toBe('platform')
    expect(parsed?.items).toHaveLength(MAX_SIGNAL_INTEL_ITEMS)
  })

  test('rejects a packet from the wrong lane or without usable source evidence', () => {
    expect(parseSignalIntelReportData(packet('industry', [item]), 'platform')).toBeNull()
    expect(parseSignalIntelReportData(packet('platform', [{ ...item, sourceUrls: ['file:///tmp/report'] }]), 'platform')).toBeNull()
  })

  test('accepts an explicit no-findings packet', () => {
    expect(parseSignalIntelReportData(packet('platform', []), 'platform')).toEqual({
      lane: 'platform',
      items: [],
    })
  })

  test('routes valid items only to active matching specialists', () => {
    const parsed = parseSignalIntelReportData(packet('platform', [item]), 'platform')!
    const candidates = buildSignalIntelCandidates(parsed, [
      { slug: 'content-genius', name: 'Content Genius', active: true },
      { slug: 'social-publisher', name: 'Social Publisher', active: true },
      { slug: 'scroll-stopper', name: 'Scroll Stopper', active: false },
    ])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.targetAgents).toEqual(['content-genius', 'social-publisher'])
    expect(candidates[0]?.tags).toEqual(['weekly-signals', 'platform-intelligence', 'content'])
  })

  test('falls back to the active Signal Analyst when no category specialist is installed', () => {
    const parsed = parseSignalIntelReportData(packet('industry', [{ ...item, category: 'operations' }]), 'industry')!
    const candidates = buildSignalIntelCandidates(parsed, [
      { slug: 'signal-analyst-agent', name: 'Signal Analyst', active: true },
    ])

    expect(candidates[0]?.targetAgents).toEqual(['signal-analyst-agent'])
  })

  test('bounds stored prose and source URL counts', () => {
    const parsed = parseSignalIntelReportData(packet('industry', [{
      ...item,
      title: 'x'.repeat(500),
      summary: 'y'.repeat(1200),
      sourceUrls: Array.from({ length: 10 }, (_, index) => `https://example.com/${index}`),
    }]), 'industry')!

    expect(parsed.items[0]?.title).toHaveLength(160)
    expect(parsed.items[0]?.summary).toHaveLength(700)
    expect(parsed.items[0]?.sourceUrls).toHaveLength(6)
  })
})
