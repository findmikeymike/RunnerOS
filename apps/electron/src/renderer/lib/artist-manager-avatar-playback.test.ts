import { describe, expect, test } from 'bun:test'
import { createAvatarPlayback } from './artist-manager-avatar-playback'

describe('avatar playback observation', () => {
  test('silence, underrun and inactive output close even with a supplied level', () => {
    const bridge = createAvatarPlayback(() => 1)
    const update = bridge.begin()
    update({ active: true, level: 0.2 })
    expect(bridge.sample().level).toBe(0.2)
    update({ active: false, level: 0.8 })
    expect(bridge.sample().level).toBe(0)
    update({ active: true, level: 0 })
    expect(bridge.sample().active).toBe(false)
  })
  test('Stop and replacement reject delayed previous-session frames', () => {
    const bridge = createAvatarPlayback(() => 1)
    const old = bridge.begin()
    bridge.reset()
    old({ active: true, level: 1 })
    expect(bridge.sample().active).toBe(false)
    const next = bridge.begin()
    next({ active: true, level: 0.3 })
    old({ active: true, level: 1 })
    expect(bridge.sample().level).toBe(0.3)
  })
  test('producer stall and malformed level cannot freeze or poison animation', () => {
    let now = 10
    const bridge = createAvatarPlayback(() => now)
    const update = bridge.begin()
    update({ active: true, level: 0.5 })
    now = 211
    expect(bridge.sample().active).toBe(false)
    update({ active: true, level: Number.NaN })
    expect(bridge.sample().level).toBe(0)
    update({ active: true, level: 50 })
    expect(bridge.sample().level).toBe(1)
  })
  test('interruption clears immediately and sampled values cannot mutate state', () => {
    const bridge = createAvatarPlayback(() => 10)
    const update = bridge.begin()
    update({ active: true, level: 0.5 })
    bridge.sample().level = 1
    expect(bridge.sample().level).toBe(0.5)
    bridge.clear()
    expect(bridge.sample().active).toBe(false)
  })
  test('copies and bounds timed poses without converting explicit silence into fallback', () => {
    const bridge = createAvatarPlayback(() => 10)
    const update = bridge.begin()
    const visemes = [{ symbol: 'bmp', weight: 1 }, { symbol: 'aei', weight: 1 }]
    update({ active: true, level: 0.2, visemes })
    visemes[0]!.weight = 0
    expect(bridge.sample().visemes).toEqual([{ symbol: 'bmp', weight: 0.5 }, { symbol: 'aei', weight: 0.5 }])
    bridge.sample().visemes![0]!.weight = 0
    expect(bridge.sample().visemes![0]!.weight).toBe(0.5)
    update({ active: true, level: 0.2, visemes: [] })
    expect(bridge.sample().visemes).toEqual([])
    update({ active: true, level: 0.2 })
    expect(bridge.sample().visemes).toBeUndefined()
    update({ active: true, level: 0.2, visemes: [{ symbol: 'aei', weight: NaN }] })
    expect(bridge.sample().visemes).toBeUndefined()
  })
  test('timed quiet consonants survive zero RMS but a consumption stop closes them', () => {
    const bridge = createAvatarPlayback(() => 10)
    const update = bridge.begin()
    update({ active: false, level: 0, visemes: [{ symbol: 'bmp', weight: 1 }] })
    expect(bridge.sample().active).toBe(true)
    expect(bridge.sample().visemes).toEqual([{ symbol: 'bmp', weight: 1 }])
    update({ active: false, level: 0, visemes: [] })
    expect(bridge.sample().active).toBe(false)
  })
  test('stale playback and resets discard every phoneme weight', () => {
    let now = 10
    const bridge = createAvatarPlayback(() => now)
    const old = bridge.begin()
    old({ active: true, level: 0.2, visemes: [{ symbol: 'fv', weight: 1 }] })
    now = 211
    expect(bridge.sample().visemes).toBeUndefined()
    bridge.reset()
    old({ active: true, level: 0.2, visemes: [{ symbol: 'fv', weight: 1 }] })
    expect(bridge.sample().visemes).toBeUndefined()
  })
})
