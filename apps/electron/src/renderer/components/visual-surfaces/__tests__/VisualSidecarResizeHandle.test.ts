import { describe, expect, it } from 'bun:test'
import {
  clampVisualSidecarWidth,
  readVisualSidecarWidthPreference,
  serializeVisualSidecarWidthPreference,
  VISUAL_SIDECAR_DEFAULT_WIDTH,
  VISUAL_SIDECAR_MIN_WIDTH,
} from '../VisualSidecarResizeHandle'

describe('visual sidecar sizing', () => {
  it('keeps the canvas between its minimum and available maximum', () => {
    expect(clampVisualSidecarWidth(200, 640)).toBe(VISUAL_SIDECAR_MIN_WIDTH)
    expect(clampVisualSidecarWidth(520, 640)).toBe(520)
    expect(clampVisualSidecarWidth(800, 640)).toBe(640)
  })

  it('falls back safely for invalid stored widths', () => {
    expect(clampVisualSidecarWidth(Number.NaN, 640)).toBe(VISUAL_SIDECAR_DEFAULT_WIDTH)
    expect(clampVisualSidecarWidth(Number.POSITIVE_INFINITY, 400)).toBe(400)
  })

  it('never reports a maximum below the usable canvas minimum', () => {
    expect(clampVisualSidecarWidth(480, 120)).toBe(VISUAL_SIDECAR_MIN_WIDTH)
  })

  it('loads and merges the width without erasing other preferences', () => {
    expect(readVisualSidecarWidthPreference('{"layout":{"visualSidecarWidth":612}}')).toBe(612)
    expect(readVisualSidecarWidthPreference('not-json')).toBe(VISUAL_SIDECAR_DEFAULT_WIDTH)

    const serialized = serializeVisualSidecarWidthPreference(JSON.stringify({ name: 'Mikey', layout: { density: 'tight' } }), 511.7)
    const preferences = JSON.parse(serialized)
    expect(preferences.name).toBe('Mikey')
    expect(preferences.layout).toEqual({ density: 'tight', visualSidecarWidth: 512 })
  })
})
