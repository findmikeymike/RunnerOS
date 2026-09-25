import { describe, expect, test } from 'bun:test'
import type { VideoClip } from '@craft-agent/shared/video'
import { previewMediaTime, previewTimelineTime, previewPlaybackRate, videoCompositionFingerprint, renderedPreviewFreshness, sourceInAfterLeadingTrim, clipPlaybackSpeed, previewClipSourceTime, timelineMsFromPreviewVideoTime, splitVideoClip, videoProjectFingerprint, isExternalVideoProjectChange, nextPreviewClip, requireVideoProjectWrite } from './video-studio-editing'

const clip = (speed = 1): VideoClip => ({ id: 'a', type: 'video', startMs: 1000, durationMs: 4000, sourceInMs: 500, sourceOutMs: 10500, speed })

describe('Video Studio editor safety', () => {
  test('unrelated output events and own in-flight save do not create conflicts', () => {
    const saved = videoProjectFingerprint('{"id":"a","version":1}')
    const pending = videoProjectFingerprint('{"id":"a","version":2}')
    expect(isExternalVideoProjectChange('{ "id": "a", "version": 1 }', saved, pending)).toBe(false)
    expect(isExternalVideoProjectChange('{"id":"a","version":2}', saved, pending)).toBe(false)
    expect(isExternalVideoProjectChange('{"id":"a","version":3}', saved, pending)).toBe(true)
  })
  test('missing or unsuccessful save bridge fails without continuing', async () => {
    await expect(requireVideoProjectWrite(undefined)).rejects.toThrow('unavailable')
    await expect(requireVideoProjectWrite(async () => false)).rejects.toThrow('not saved')
    await expect(requireVideoProjectWrite(async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    await expect(requireVideoProjectWrite(async () => true)).resolves.toBeUndefined()
  })
  test.each([0.5, 1, 2, 4])('split preserves source continuity at %s speed', (speed) => {
    const original = clip(speed)
    const [left, right] = splitVideoClip(original, 2000, 'b')
    expect(left.sourceOutMs).toBe(500 + 1000 * speed)
    expect(right.sourceInMs).toBe(left.sourceOutMs)
    expect(right.sourceOutMs).toBe(original.sourceOutMs)
    expect(left.durationMs + right.durationMs).toBe(original.durationMs)
    expect(right.startMs).toBe(left.startMs + left.durationMs)
    expect(previewClipSourceTime(right, 2000)).toBe(previewClipSourceTime(original, 2000))
  })
  test.each([0.5, 1, 2, 4])('preview seeking and playhead round-trip at %s speed', (speed) => {
    const current = clip(speed)
    const sourceSeconds = previewClipSourceTime(current, 2750)
    expect(sourceSeconds).toBe((500 + 1750 * speed) / 1000)
    expect(timelineMsFromPreviewVideoTime(current, sourceSeconds)).toBe(2750)
  })
  test('touching next clips are not skipped during handoff', () => {
    const next = { clip: { startMs: 5000 } }
    const later = { clip: { startMs: 7000 } }
    expect(nextPreviewClip([next, later], 5000)).toBe(next)
    expect(nextPreviewClip([next, later], 5001)).toBe(later)
  })
  test('invalid speeds use safe normal playback and boundary splits fail', () => {
    expect(clipPlaybackSpeed({ speed: 0 })).toBe(1)
    expect(clipPlaybackSpeed({ speed: NaN })).toBe(1)
    expect(() => splitVideoClip(clip(), 1000, 'b')).toThrow('inside')
    expect(() => splitVideoClip(clip(), 5000, 'b')).toThrow('inside')
  })
})

test('leading trim consumes source time at playback speed in both directions', () => {
  expect(sourceInAfterLeadingTrim({ speed: 2 }, 3000, 500)).toBe(4000)
  expect(sourceInAfterLeadingTrim({ speed: 0.5 }, 3000, 500)).toBe(3250)
  expect(sourceInAfterLeadingTrim({ speed: 2 }, 3000, -500)).toBe(2000)
  expect(sourceInAfterLeadingTrim({ speed: 2 }, 3000, -2000)).toBe(0)
})


describe('Video Studio rendered result review', () => {
  test('rendered video uses its own clock and normal rate instead of applying source speed twice', () => {
    const spedUp = clip(2)
    expect(previewMediaTime('source', spedUp, 2500)).toBe(3.5)
    expect(previewMediaTime('rendered', spedUp, 2500)).toBe(2.5)
    expect(previewTimelineTime('source', spedUp, 3.5)).toBe(2500)
    expect(previewTimelineTime('rendered', spedUp, 3.5)).toBe(3500)
    expect(previewPlaybackRate('source', spedUp)).toBe(2)
    expect(previewPlaybackRate('rendered', spedUp)).toBe(1)
    expect(previewMediaTime('rendered', null, 2500)).toBe(2.5)
  })
  test('render freshness ignores save/export bookkeeping but detects composition edits', () => {
    const project = { title: 'Cut', settings: { width: 1920 }, timeline: { tracks: [clip()] }, versions: [], exports: [], updatedAt: 'before' }
    const rendered = videoCompositionFingerprint(JSON.stringify(project))
    expect(renderedPreviewFreshness(JSON.stringify({ ...project, versions: ['save'], exports: ['result'], updatedAt: 'after' }), rendered)).toBe('current')
    expect(renderedPreviewFreshness(JSON.stringify({ ...project, timeline: { tracks: [clip(2)] } }), rendered)).toBe('edited')
    expect(renderedPreviewFreshness(JSON.stringify({ ...project, settings: { width: 1080 } }), rendered)).toBe('edited')
    expect(renderedPreviewFreshness('{unfinished', rendered)).toBe('edited')
    expect(renderedPreviewFreshness(JSON.stringify(project), null)).toBe('unknown')
  })
})
