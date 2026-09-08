/** Bounded visual observation only. Never owns audio or advances a speech clock. */
export function createAvatarPlayback(now: () => number = () => performance.now()) {
  let epoch = 0
  let current = { active: false, level: 0, updatedAt: 0 }
  const clear = () => { current = { active: false, level: 0, updatedAt: now() } }
  return {
    begin() {
      const owner = ++epoch
      clear()
      return (frame: { active: boolean; level: number }) => {
        if (owner !== epoch) return
        const level = Number.isFinite(frame.level) ? Math.min(1, Math.max(0, frame.level)) : 0
        current = { active: frame.active && level > 0, level: frame.active ? level : 0, updatedAt: now() }
      }
    },
    clear,
    reset() { epoch++; clear() },
    sample() {
      // A suspended, crashed, or delayed producer must never leave the mouth open.
      if (now() - current.updatedAt > 200) return { active: false, level: 0, updatedAt: current.updatedAt }
      return { ...current }
    },
  }
}
