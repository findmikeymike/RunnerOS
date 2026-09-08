import { VISEME_MAP } from './facial-controller.mjs'

export type MikeyAvatarState = 'idle' | 'listening' | 'waiting' | 'speaking'
export interface AvatarViseme { symbol: string; weight: number }
/** updatedAt uses performance.now(), sampled from actual speaker playback. */
export interface AvatarPlayback { active: boolean; level: number; updatedAt: number; visemes?: readonly AvatarViseme[] }

export function sampleMikeyPose(state: MikeyAvatarState, playback: AvatarPlayback, now: number, reducedMotion: boolean) {
  const fresh = Number.isFinite(playback.updatedAt) && now >= playback.updatedAt && now - playback.updatedAt <= 200
  const audible = state === 'speaking' && playback.active && fresh && Number.isFinite(playback.level) && playback.level >= 0
  // Missing timing retains the existing amplitude fallback. An empty timed pose
  // explicitly means silence, so it must not fall back to an open vowel.
  const mouth = audible ? Math.min(0.65, Math.max(0, playback.level - 0.008) * 2.8) : 0
  const morphs: Record<string, number> = { viseme_aa: 0 }
  if (audible && playback.visemes !== undefined) {
    for (const { symbol, weight } of playback.visemes) {
      if (!Object.hasOwn(VISEME_MAP, symbol) || !Number.isFinite(weight)) continue
      for (const [name, strength] of Object.entries(VISEME_MAP[symbol]!)) {
        morphs[name] = Math.min(1, (morphs[name] ?? 0) + Math.max(0, Math.min(1, weight)) * strength)
      }
    }
    // The generated jaw opens broadly at1; keep Mikey's delivery restrained.
    morphs.viseme_aa *= 0.75
  } else morphs.viseme_aa = mouth
  const seconds = now / 1000
  const blink = reducedMotion ? 0 : Math.max(0, 1 - Math.abs(seconds % 5.7 - 4.4) / 0.12)
  const face: Record<string, number> = {
    ...morphs,
    blinkLeft: blink, blinkRight: blink,
    browInnerUp: state === 'listening' ? 0.08 : state === 'waiting' ? 0.04 : 0,
  }
  return {
    morphs: face,
    // Eye axes are retained in the portable binding for future calibration.
    // Rest gaze stays centered until those axes have been visually verified.
    gaze: { x: 0, y: 0 },
    turn: reducedMotion ? 0 : Math.sin(seconds * 0.27) * 0.008,
    tilt: reducedMotion ? 0 : Math.sin(seconds * 0.39) * 0.004,
  }
}
