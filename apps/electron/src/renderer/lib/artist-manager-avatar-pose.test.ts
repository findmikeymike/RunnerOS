import { describe, expect, test } from 'bun:test'
import { Bone, Mesh, Object3D } from 'three'
import { createAvatarPlayback } from './artist-manager-avatar-playback'
import { bindAvatar } from './mikey-avatar/bind-avatar.mjs'
import { MORPH_NAMES } from './mikey-avatar/facial-controller.mjs'
import { sampleMikeyPose, type MikeyAvatarState } from './mikey-avatar/pose'

function fixture() {
  let now = 1000
  const bridge = createAvatarPlayback(() => now)
  const mesh = new Mesh()
  mesh.name = 'face'
  mesh.morphTargetDictionary = Object.fromEntries(MORPH_NAMES.map((name, index) => [name, index]))
  mesh.morphTargetInfluences = MORPH_NAMES.map(() => 0)
  const root = new Object3D()
  root.add(mesh)
  for (const name of ['eyeLeft', 'eyeRight']) { const eye = new Bone(); eye.name = name; root.add(eye) }
  const rig = bindAvatar(root)
  return {
    bridge,
    advance: (milliseconds: number) => { now += milliseconds },
    draw: (state: MikeyAvatarState = 'speaking') => rig.apply(sampleMikeyPose(state, bridge.sample(), now, false)),
    weight: (name: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]!],
    speechWeights: () => MORPH_NAMES.filter(name => name.startsWith('viseme_')).map(name => mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]!]),
  }
}

describe('playback frames through the rendered avatar binding', () => {
  test('crossfaded consonants and vowels replace previous mouth shapes on every draw', () => {
    const avatar = fixture()
    const emit = avatar.bridge.begin()
    emit({ active: true, level: 0.2, visemes: [{ symbol: 'bmp', weight: 0.75 }, { symbol: 'o', weight: 0.25 }] })
    avatar.draw()
    expect(avatar.weight('viseme_PP')).toBe(0.75)
    expect(avatar.weight('viseme_O')).toBe(0.25)
    emit({ active: true, level: 0.2, visemes: [{ symbol: 'fv', weight: 1 }] })
    avatar.draw()
    expect(avatar.weight('viseme_PP')).toBe(0)
    expect(avatar.weight('viseme_O')).toBe(0)
    expect(avatar.weight('viseme_FF')).toBe(1)
    emit({ active: true, level: 0.2, visemes: [] })
    avatar.draw()
    expect(avatar.speechWeights().every(weight => weight === 0)).toBe(true)
    emit({ active: true, level: 0.2 })
    avatar.draw()
    expect(avatar.weight('viseme_aa')).toBeGreaterThan(0)
    expect(avatar.weight('viseme_FF')).toBe(0)
  })

  test('interruption, inactive calls, stale producers and restarted sessions leave no old consonants', () => {
    const avatar = fixture()
    const old = avatar.bridge.begin()
    const speaking = { active: true, level: 0.2, visemes: [{ symbol: 'bmp', weight: 1 }] }
    old(speaking)
    avatar.draw()
    expect(avatar.weight('viseme_PP')).toBe(1)
    avatar.bridge.clear()
    avatar.draw('listening')
    expect(avatar.speechWeights().every(weight => weight === 0)).toBe(true)
    old(speaking)
    avatar.draw('idle')
    expect(avatar.speechWeights().every(weight => weight === 0)).toBe(true)
    avatar.draw()
    expect(avatar.weight('viseme_PP')).toBe(1)
    avatar.advance(201)
    avatar.draw()
    expect(avatar.speechWeights().every(weight => weight === 0)).toBe(true)
    avatar.bridge.reset()
    const next = avatar.bridge.begin()
    next({ active: true, level: 0.2, visemes: [{ symbol: 'o', weight: 1 }] })
    old(speaking)
    avatar.draw()
    expect(avatar.weight('viseme_O')).toBe(1)
    expect(avatar.weight('viseme_PP')).toBe(0)
    next({ active: false, level: 0, visemes: [] })
    avatar.draw()
    expect(avatar.speechWeights().every(weight => weight === 0)).toBe(true)
  })
})
