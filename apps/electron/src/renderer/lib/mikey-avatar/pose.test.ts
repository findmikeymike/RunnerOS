import { describe, expect, test } from 'bun:test'
import { sampleMikeyPose } from './pose'

describe('Mikey speaker-driven mouth', () => {
  const playing = { active: true, level: 0.15, updatedAt: 1000 }
  test('responds to fresh actual playback, with bounded amplitude', () => {
    expect(sampleMikeyPose('speaking', playing, 1100, false).morphs.viseme_aa).toBeGreaterThan(0)
    expect(sampleMikeyPose('speaking', { ...playing, level: 100 }, 1100, false).morphs.viseme_aa).toBe(0.65)
  })
  test('closes on stop, stale progress, silence, bad timestamps and non-speaking states', () => {
    for (const sample of [
      { ...playing, active: false }, { ...playing, updatedAt: 0 },
      { ...playing, level: 0 }, { ...playing, level: -1 }, { ...playing, level: NaN },
      { ...playing, level: Infinity }, { ...playing, updatedAt: 1200 }, { ...playing, updatedAt: NaN },
    ]) expect(sampleMikeyPose('speaking', sample, 1100, false).morphs.viseme_aa).toBe(0)
    for (const state of ['idle', 'listening', 'waiting'] as const) {
      expect(sampleMikeyPose(state, playing, 1100, false).morphs.viseme_aa).toBe(0)
    }
    expect(sampleMikeyPose('speaking', playing, 1201, false).morphs.viseme_aa).toBe(0)
  })
  test('never invents phoneme shapes from elapsed time', () => {
    const first = sampleMikeyPose('speaking', playing, 1050, false)
    const second = sampleMikeyPose('speaking', playing, 1150, false)
    expect(first.morphs.viseme_aa).toBe(second.morphs.viseme_aa)
    expect(Object.keys(first.morphs).filter(key => key.startsWith('viseme_'))).toEqual(['viseme_aa'])
  })
  test('reduced motion removes ambient movement while preserving speaker feedback', () => {
    const pose = sampleMikeyPose('speaking', { ...playing, updatedAt: 4400 }, 4400, true)
    expect(pose.turn).toBe(0); expect(pose.tilt).toBe(0)
    expect(pose.morphs.blinkLeft).toBe(0); expect(pose.morphs.blinkRight).toBe(0)
    expect(pose.morphs.viseme_aa).toBeGreaterThan(0)
  })
})
