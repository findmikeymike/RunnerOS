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
  test('uses the authored consonant and vowel shapes from consumed phonemes', () => {
    const playback = { ...playing, visemes: [{ symbol: 'bmp', weight: 0.75 }, { symbol: 'o', weight: 0.25 }] }
    const pose = sampleMikeyPose('speaking', playback, 1050, false)
    expect(pose.morphs['viseme_PP']).toBe(0.75)
    expect(pose.morphs['viseme_O']).toBe(0.25)
    expect(pose.morphs.viseme_aa).toBe(0)
    expect(sampleMikeyPose('speaking', { ...playback, level: 0 }, 1050, false).morphs.viseme_PP).toBe(0.75)
    expect(sampleMikeyPose('speaking', { ...playing, visemes: [{ symbol: 'aei', weight: 1 }] }, 1050, false).morphs.viseme_aa).toBe(0.75)
    expect(sampleMikeyPose('speaking', { ...playing, visemes: [] }, 1050, false).morphs.viseme_aa).toBe(0)
    expect(sampleMikeyPose('speaking', { ...playing, visemes: [{ symbol: 'unknown', weight: 1 }] }, 1050, false).morphs.viseme_aa).toBe(0)
    expect(sampleMikeyPose('listening', playback, 1050, false).morphs['viseme_PP'] ?? 0).toBe(0)
    expect(sampleMikeyPose('speaking', playback, 1201, false).morphs['viseme_PP'] ?? 0).toBe(0)
  })
})
