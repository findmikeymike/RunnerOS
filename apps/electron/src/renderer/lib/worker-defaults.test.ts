import { describe, expect, test } from 'bun:test'
import { defaultWorkerSlugs } from './worker-defaults'

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
})
