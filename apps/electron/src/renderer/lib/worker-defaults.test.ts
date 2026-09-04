import { describe, expect, test } from 'bun:test'
import { defaultWorkerSlugs, LAB_DEFAULT_WORKER_SLUGS } from './worker-defaults'

describe('worker page defaults', () => {
  test('College Radio appears by default in Artist HQ and Campaign workers', () => {
    expect(defaultWorkerSlugs(false)).toContain('college-radio-agent')
    expect(defaultWorkerSlugs(true)).toContain('college-radio-agent')
  })

  test('Spotify Playlist Creator appears by default in Artist HQ and Campaign workers', () => {
    expect(defaultWorkerSlugs(false)).toContain('spotify-playlist-creator')
    expect(defaultWorkerSlugs(true)).toContain('spotify-playlist-creator')
  })

  test('X Editorial appears once by default in Artist HQ and Campaign workers', () => {
    expect(defaultWorkerSlugs(false)).toContain('x-editorial')
    expect(defaultWorkerSlugs(true)).toContain('x-editorial')
    expect(defaultWorkerSlugs(true).filter((slug) => slug === 'x-editorial')).toHaveLength(1)
  })

  test('Campaign workers include the creative concept team by default', () => {
    expect(defaultWorkerSlugs(true)).toContain('scroll-stopper')
    expect(defaultWorkerSlugs(true)).toContain('anticipation-director')
    expect(defaultWorkerSlugs(true)).toContain('content-director')
  })

  test('Update System Agent is an HQ-only default worker', () => {
    expect(defaultWorkerSlugs(false)).toContain('update-system-agent')
    expect(defaultWorkerSlugs(true)).not.toContain('update-system-agent')
  })

  test('Catalog & Royalties is an HQ-only default worker', () => {
    expect(defaultWorkerSlugs(false)).toContain('catalog-royalty-agent')
    expect(defaultWorkerSlugs(true)).not.toContain('catalog-royalty-agent')
  })

  test('Lab defaults stay bounded to the songwriting roster', () => {
    expect(LAB_DEFAULT_WORKER_SLUGS).toEqual([
      'the-excavator',
      'reverse-magic',
      'hooker',
      'legendary-writer',
      'reference-master',
      'record-doctor',
    ])
  })
})
