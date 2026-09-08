export type MikeyAvatarState = 'idle' | 'listening' | 'waiting' | 'speaking'
/** updatedAt uses performance.now(), sampled from actual speaker playback. */
export interface AvatarPlayback { active: boolean; level: number; updatedAt: number }

export function sampleMikeyPose(state: MikeyAvatarState, playback: AvatarPlayback, now: number, reducedMotion: boolean) {
  const fresh = Number.isFinite(playback.updatedAt) && now >= playback.updatedAt && now - playback.updatedAt <= 200
  const audible = state === 'speaking' && playback.active && fresh && Number.isFinite(playback.level)
  // An amplitude fallback, not a phoneme estimate. Silence closes immediately.
  const mouth = audible ? Math.min(0.65, Math.max(0, playback.level - 0.008) * 2.8) : 0
  const seconds = now / 1000
  const blink = reducedMotion ? 0 : Math.max(0, 1 - Math.abs(seconds % 5.7 - 4.4) / 0.12)
  return {
    morphs: {
      viseme_aa: mouth,
      blinkLeft: blink, blinkRight: blink,
      browInnerUp: state === 'listening' ? 0.08 : state === 'waiting' ? 0.04 : 0,
    },
    // Eye axes are retained in the portable binding for future calibration.
    // Rest gaze stays centered until those axes have been visually verified.
    gaze: { x: 0, y: 0 },
    turn: reducedMotion ? 0 : Math.sin(seconds * 0.27) * 0.008,
    tilt: reducedMotion ? 0 : Math.sin(seconds * 0.39) * 0.004,
  }
}
