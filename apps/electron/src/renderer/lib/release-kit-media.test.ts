import { expect, test } from 'bun:test'
import { isReleaseKitAudioAsset, releaseKitAudioUrl, supportsReleaseKitSocialPost } from './release-kit-media'
test('master paths preserve filename characters instead of treating them as URL syntax', () => {
  expect(releaseKitAudioUrl('/music/0 Homebody #1?%.wav')).toBe('file:///music/0%20Homebody%20%231%3F%25.wav')
  expect(releaseKitAudioUrl('C:\\music\\master.wav')).toBe('file:///C:/music/master.wav')
  expect(() => releaseKitAudioUrl('relative.wav')).toThrow()
})
test('social-post controls belong to images and videos only', () => {
  for (const category of ['images', 'artwork', 'video']) expect(supportsReleaseKitSocialPost(category)).toBe(true)
  for (const category of ['audio', 'documents', 'other']) expect(supportsReleaseKitSocialPost(category)).toBe(false)
})

test('Vault audio picker excludes documents and images, including misleading filenames', () => {
  expect(isReleaseKitAudioAsset({ mimeType: 'audio/wav' })).toBe(true)
  expect(isReleaseKitAudioAsset({ relativePath: 'masters/song.FLAC' })).toBe(true)
  expect(isReleaseKitAudioAsset({ mimeType: 'application/octet-stream', absolutePath: '/music/song.mp3' })).toBe(true)
  expect(isReleaseKitAudioAsset({ mimeType: 'application/pdf', relativePath: 'song.wav' })).toBe(false)
  expect(isReleaseKitAudioAsset({ relativePath: 'lyrics.pdf' })).toBe(false)
  expect(isReleaseKitAudioAsset({ mimeType: 'image/png' })).toBe(false)
  expect(isReleaseKitAudioAsset({})).toBe(false)
})
