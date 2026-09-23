import { expect, test } from 'bun:test'
import { releaseKitPlacement, releaseKitTypeForCategory } from './release-kit-placement'

test('a PNG chosen through Single Art retains artwork intent instead of becoming social imagery', () => {
  expect(releaseKitPlacement({ category: 'images', subtype: 'social-image' }, 'artwork'))
    .toEqual({ category: 'artwork', subtype: 'cover-art' })
})

test('generic add and matching sections preserve a specific inferred type', () => {
  const press = { category: 'images' as const, subtype: 'press-photo' }
  expect(releaseKitPlacement(press)).toEqual(press)
  expect(releaseKitPlacement(press, 'images')).toEqual(press)
  expect(releaseKitPlacement({ category: 'video', subtype: 'lyric-video' }, 'video'))
    .toEqual({ category: 'video', subtype: 'lyric-video' })
})

test('category changes replace auto-filled types repeatedly', () => {
  const artwork = releaseKitTypeForCategory('artwork', 'social-image', false)
  expect(artwork).toBe('cover-art')
  const video = releaseKitTypeForCategory('video', artwork, false)
  expect(video).toBe('final-video')
  expect(releaseKitTypeForCategory('images', video, false)).toBe('social-image')
})

test('a deliberately customized type survives category changes, including an intentionally blank edit', () => {
  expect(releaseKitTypeForCategory('artwork', 'alternate-front-cover', true)).toBe('alternate-front-cover')
  expect(releaseKitTypeForCategory('artwork', '', true)).toBe('')
})


test('an incompatible section never recategorizes media or implicitly replaces the audio master', () => {
  const image = { category: 'images' as const, subtype: 'social-image' }
  expect(releaseKitPlacement(image, 'audio')).toEqual(image)
  expect(releaseKitPlacement(image, 'video')).toEqual(image)
  const audio = { category: 'audio' as const, subtype: 'master' }
  expect(releaseKitPlacement(audio, 'artwork')).toEqual(audio)
  const video = { category: 'video' as const, subtype: 'lyric-video' }
  expect(releaseKitPlacement(video, 'artwork')).toEqual(video)
  expect(releaseKitPlacement(video, 'audio')).toEqual(video)
  const document = { category: 'documents' as const, subtype: 'final-document' }
  expect(releaseKitPlacement(document, 'audio')).toEqual(document)
})

test('artwork can intentionally be added as press and social imagery', () => {
  expect(releaseKitPlacement({ category: 'artwork', subtype: 'cover-art' }, 'images'))
    .toEqual({ category: 'images', subtype: 'social-image' })
})
