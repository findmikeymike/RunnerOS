import type { AvatarPlayback, AvatarViseme } from './mikey-avatar/pose'

/** Bounded visual observation only. Never owns audio or advances a speech clock. */
export function createAvatarPlayback(now: () => number = () => performance.now()) {
  let epoch = 0
  let current: AvatarPlayback = { active: false, level: 0, updatedAt: 0 }
  const clear = () => { current = { active: false, level: 0, updatedAt: now() } }
  return {
    begin() {
      const owner = ++epoch
      clear()
      return (frame: { active: boolean; level: number; visemes?: readonly AvatarViseme[] }) => {
        if (owner !== epoch) return
        const level = Number.isFinite(frame.level) ? Math.min(1, Math.max(0, frame.level)) : 0
        current = { active: frame.active && level > 0, level: frame.active ? level : 0, updatedAt: now() }
        if (Array.isArray(frame.visemes) && frame.visemes.length <= 8
          && frame.visemes.every(v => v && typeof v.symbol === 'string' && v.symbol.length <= 32 && Number.isFinite(v.weight))) {
          const poses = frame.visemes.map(v => ({ symbol: v.symbol, weight: Math.max(0, Math.min(1, v.weight)) }))
          const total = poses.reduce((sum, pose) => sum + pose.weight, 0)
          current.visemes = poses.map(pose => ({ ...pose, weight: pose.weight / Math.max(1, total) }))
          // Provider PCM can contain a silent lip closure. The SDK supplies timed
          // weights only while consuming PCM and sends [] on underrun/clear.
          if (poses.some(pose => pose.weight > 0)) current.active = true
        }
      }
    },
    clear,
    reset() { epoch++; clear() },
    sample() {
      // A suspended, crashed, or delayed producer must never leave the mouth open.
      if (now() - current.updatedAt > 200) return { active: false, level: 0, updatedAt: current.updatedAt }
      return { ...current, ...(current.visemes === undefined ? {} : { visemes: current.visemes.map(v => ({ ...v })) }) }
    },
  }
}
